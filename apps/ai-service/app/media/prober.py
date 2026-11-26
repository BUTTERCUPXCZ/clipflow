from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from app.media.ffmpeg_runner import FfmpegError, FfmpegRunner, scrub


@dataclass(frozen=True)
class ProbeResult:
    decodable: bool
    duration_seconds: float = 0.0
    width: int = 0
    height: int = 0
    frame_rate: float = 0.0
    video_codec: str = ""
    audio_codec: str = ""
    has_audio: bool = False
    container: str = ""
    error: str = ""

    @classmethod
    def undecodable(cls, reason: str) -> "ProbeResult":
        return cls(decodable=False, error=reason)


class MediaProber:
    """FFprobe → the facts processing needs (system-design §4.2).

    Distinguishes "cannot be decoded" (decodable=False) from "decodes but has no audio" (has_audio=False).
    """

    def __init__(self, runner: FfmpegRunner) -> None:
        self._runner = runner

    def probe(self, path: Path) -> ProbeResult:
        try:
            info = self._runner.probe_json(path)
        except FfmpegError as exc:
            return ProbeResult.undecodable(scrub(str(exc), path))

        streams = info.get("streams", [])
        video = next(
            (s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")),
            None,
        )
        if video is None:
            return ProbeResult.undecodable("the file has no video stream")

        fmt = info.get("format", {})
        duration = _float(fmt.get("duration")) or _float(video.get("duration"))
        if duration <= 0:
            return ProbeResult.undecodable("the video has no measurable duration")

        audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
        return ProbeResult(
            decodable=True,
            duration_seconds=round(duration, 3),
            width=int(video.get("width") or 0),
            height=int(video.get("height") or 0),
            frame_rate=_rate(video.get("avg_frame_rate")) or _rate(video.get("r_frame_rate")),
            video_codec=video.get("codec_name", ""),
            audio_codec=audio.get("codec_name", "") if audio else "",
            has_audio=audio is not None,
            container=fmt.get("format_name", ""),
        )


def _float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _rate(value) -> float:
    """ffprobe rates are fractions like "30000/1001"; "0/0" means unknown."""
    try:
        rate = Fraction(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return 0.0
    return round(float(rate), 3) if rate > 0 else 0.0
