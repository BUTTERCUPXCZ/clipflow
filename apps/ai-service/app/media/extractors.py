"""Audio and frame extraction (system-design §4.3–4.4). Fixed ffmpeg flags; only paths and numbers vary."""

import json
from dataclasses import dataclass
from pathlib import Path

from app.media.ffmpeg_runner import CancelCheck, FfmpegRunner, ProgressCallback

FRAMES_INDEX = "frames.json"


class AudioExtractor:
    """Whisper-ready audio: mono, 16 kHz, 16-bit PCM WAV."""

    SAMPLE_RATE = 16_000

    def __init__(self, runner: FfmpegRunner) -> None:
        self._runner = runner

    def extract(
        self,
        source: Path,
        output: Path,
        *,
        duration: float,
        on_progress: ProgressCallback | None = None,
        should_cancel: CancelCheck | None = None,
    ) -> None:
        output.parent.mkdir(parents=True, exist_ok=True)
        args = ["-i", str(source), "-vn", "-ac", "1", "-ar", str(self.SAMPLE_RATE), "-c:a", "pcm_s16le", str(output)]
        self._runner.run(args, duration=duration, on_progress=on_progress, should_cancel=should_cancel)


@dataclass(frozen=True)
class Frame:
    index: int
    file: str
    timestamp_seconds: float


class FrameExtractor:
    """One JPEG every `interval` seconds, at most `max_width` wide (aspect kept), plus frames.json."""

    def __init__(self, runner: FfmpegRunner) -> None:
        self._runner = runner

    def extract(
        self,
        source: Path,
        frames_dir: Path,
        *,
        interval: float,
        max_width: int,
        duration: float,
        on_progress: ProgressCallback | None = None,
        should_cancel: CancelCheck | None = None,
    ) -> list[Frame]:
        if interval <= 0 or max_width <= 0:
            raise ValueError("interval and max_width must be positive")
        frames_dir.mkdir(parents=True, exist_ok=True)
        # min(): never upscale small videos; -2 keeps the height even, as encoders require.
        video_filter = f"fps=1/{interval},scale='min({int(max_width)},iw)':-2"
        args = ["-i", str(source), "-an", "-vf", video_filter, "-q:v", "4", str(frames_dir / "frame-%06d.jpg")]
        self._runner.run(args, duration=duration, on_progress=on_progress, should_cancel=should_cancel)

        files = sorted(frames_dir.glob("frame-*.jpg"))
        frames = [Frame(index=i, file=f.name, timestamp_seconds=round(i * interval, 3)) for i, f in enumerate(files)]
        index = [{"index": f.index, "file": f.file, "timestampSeconds": f.timestamp_seconds} for f in frames]
        (frames_dir / FRAMES_INDEX).write_text(json.dumps(index))
        return frames
