"""Renders one planned clip and verifies the result (system-design §11, §4.12)."""

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from app.media.ffmpeg_runner import FfmpegError, FfmpegRunner
from app.media.prober import MediaProber
from app.rendering.ass import to_ass
from app.rendering.commands import render_args, thumbnail_args
from app.rendering.profile import HEIGHT, WIDTH, X264, Encoder

DURATION_TOLERANCE = 0.5


class RenderVerificationError(Exception):
    """FFmpeg exited cleanly but the file is not what the profile promises."""


@dataclass(frozen=True)
class ClipSpec:
    clip_id: str
    start: float
    end: float
    cues: list[dict] = field(default_factory=list)


@dataclass(frozen=True)
class SourceInfo:
    path: Path
    has_audio: bool
    fps: float


class ClipRenderer:
    def __init__(self, runner: FfmpegRunner, prober: MediaProber, encoder: Encoder) -> None:
        self._runner = runner
        self._prober = prober
        self.encoder = encoder

    def render(
        self,
        source: SourceInfo,
        clip: ClipSpec,
        out_dir: Path,
        *,
        subtitles: bool,
        on_progress: Callable[[float], None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> dict:
        """Writes <clip_id>.mp4 and <clip_id>.jpg into `out_dir`; returns their metadata (absolute paths)."""
        length = clip.end - clip.start
        ass = out_dir / f"{clip.clip_id}.ass" if subtitles and clip.cues else None
        if ass:
            ass.write_text(to_ass(clip.cues))
        video = out_dir / f"{clip.clip_id}.mp4"
        thumbnail = out_dir / f"{clip.clip_id}.jpg"

        def encode(encoder: Encoder) -> None:
            self._runner.run(
                render_args(
                    source.path, clip.start, clip.end, video, encoder,
                    has_audio=source.has_audio, source_fps=source.fps, subtitles=ass,
                ),
                duration=length, on_progress=on_progress, should_cancel=should_cancel,
            )

        try:
            try:
                encode(self.encoder)
            except FfmpegError:
                if self.encoder is X264:
                    raise
                encode(X264)  # NVENC passed the probe but failed now (session limit, another app): fall back once
            self._runner.run(thumbnail_args(video, length / 2, thumbnail), should_cancel=should_cancel)
            info = self._verify(video, length, source.has_audio)
        except BaseException:
            video.unlink(missing_ok=True)  # a failed clip leaves nothing behind
            thumbnail.unlink(missing_ok=True)
            raise
        finally:
            if ass:
                ass.unlink(missing_ok=True)
        return {
            "clipId": clip.clip_id,
            "file": video,
            "thumbnail": thumbnail,
            "durationSeconds": round(info.duration_seconds, 3),
            "width": info.width,
            "height": info.height,
            "sizeBytes": video.stat().st_size,
        }

    def _verify(self, video: Path, length: float, has_audio: bool):
        info = self._prober.probe(video)
        if not info.decodable:
            raise RenderVerificationError(f"the rendered file is not playable: {info.error}")
        if (info.width, info.height) != (WIDTH, HEIGHT):
            raise RenderVerificationError(f"rendered at {info.width}x{info.height}, expected {WIDTH}x{HEIGHT}")
        if abs(info.duration_seconds - length) > DURATION_TOLERANCE:
            raise RenderVerificationError(f"rendered {info.duration_seconds:.2f} s, expected {length:.2f} s")
        if has_audio and not info.has_audio:
            raise RenderVerificationError("the rendered file has no audio track")
        return info
