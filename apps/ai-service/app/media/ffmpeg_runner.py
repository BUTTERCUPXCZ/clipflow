"""The only place that starts ffmpeg/ffprobe processes (system-design §4.11: a controlled wrapper).

Commands are argument lists (never a shell string); callers pass fixed flags plus validated paths.
"""

import json
import os
import re
import select
import signal
import subprocess
import threading
from collections import deque
from collections.abc import Callable
from pathlib import Path

ProgressCallback = Callable[[float], None]  # fraction 0.0–1.0 of the input duration
CancelCheck = Callable[[], bool]


class FfmpegError(RuntimeError):
    def __init__(self, message: str, stderr_tail: str = "") -> None:
        super().__init__(f"{message}: {stderr_tail}" if stderr_tail else message)
        self.stderr_tail = stderr_tail


class FfmpegCancelled(Exception):
    """The caller asked to stop; the ffmpeg process group has been terminated."""


class FfmpegRunner:
    def __init__(
        self,
        ffmpeg: str = "ffmpeg",
        ffprobe: str = "ffprobe",
        poll_interval: float = 0.25,
        kill_grace: float = 2.0,  # SIGTERM → SIGKILL; keeps cancel under the spec's 3 s even if ffmpeg ignores SIGTERM
        probe_timeout: float = 30.0,
    ) -> None:
        self._ffmpeg = ffmpeg
        self._ffprobe = ffprobe
        self._poll_interval = poll_interval
        self._kill_grace = kill_grace
        self._probe_timeout = probe_timeout

    def probe_json(self, path: Path) -> dict:
        command = [self._ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]
        try:
            done = subprocess.run(command, capture_output=True, text=True, timeout=self._probe_timeout, check=False)
        except subprocess.TimeoutExpired as exc:
            raise FfmpegError("ffprobe timed out") from exc
        if done.returncode != 0:
            raise FfmpegError("ffprobe could not read the file", _tail(done.stderr))
        return json.loads(done.stdout)

    def run(
        self,
        args: list[str],
        *,
        duration: float | None = None,
        on_progress: ProgressCallback | None = None,
        should_cancel: CancelCheck | None = None,
    ) -> None:
        """Runs ffmpeg with `args`, reporting progress and honouring cancellation. Raises on failure."""
        command = [self._ffmpeg, "-hide_banner", "-nostdin", "-y", "-nostats", "-progress", "pipe:1", *args]
        # Own process group, so cancelling kills ffmpeg and anything it spawned.
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        stderr_tail: deque[str] = deque(maxlen=20)
        drain = threading.Thread(target=_drain, args=(process.stderr, stderr_tail), daemon=True)
        drain.start()
        try:
            self._follow_progress(process, duration, on_progress, should_cancel)
            process.wait()
        except BaseException:
            self._terminate(process)
            raise
        finally:
            drain.join(timeout=1)
        if process.returncode != 0:
            raise FfmpegError(f"ffmpeg exited with code {process.returncode}", "".join(stderr_tail).strip())

    def _follow_progress(self, process, duration, on_progress, should_cancel) -> None:
        fd = process.stdout.fileno()
        pending = b""
        while True:
            if should_cancel and should_cancel():
                raise FfmpegCancelled()
            ready, _, _ = select.select([fd], [], [], self._poll_interval)
            if not ready:
                continue
            chunk = os.read(fd, 4096)
            if not chunk:
                return  # ffmpeg closed stdout: finished or crashed; wait() tells which
            pending += chunk
            *lines, pending = pending.split(b"\n")
            for line in lines:
                key, _, value = line.decode(errors="replace").strip().partition("=")
                if key == "out_time_us" and on_progress and duration and value.isdigit():
                    on_progress(min(1.0, int(value) / 1_000_000 / duration))

    def _terminate(self, process: subprocess.Popen) -> None:
        if process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=self._kill_grace)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        except ProcessLookupError:
            pass


def _drain(stream, tail: deque[str]) -> None:
    for raw in iter(stream.readline, b""):
        tail.append(raw.decode(errors="replace"))
    stream.close()


_CONTEXT_PREFIX = re.compile(r"\[[^\]]+ @ 0x[0-9a-f]+\]\s*")


def scrub(message: str, *paths: Path) -> str:
    """User-facing form of an ffmpeg/ffprobe error: no absolute paths (only file names), no internal
    "[demuxer @ 0x...]" prefixes, one line."""
    for path in paths:
        message = message.replace(str(path), path.name)
    lines = [_CONTEXT_PREFIX.sub("", line).strip() for line in message.splitlines()]
    return "; ".join(dict.fromkeys(line for line in lines if line))[:500]


def _tail(text: str, lines: int = 20) -> str:
    return "\n".join(text.strip().splitlines()[-lines:])
