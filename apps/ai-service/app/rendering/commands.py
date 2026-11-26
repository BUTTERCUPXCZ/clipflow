"""FFmpeg argument lists for rendering (pure functions; FfmpegRunner runs them without a shell)."""

from pathlib import Path

from app.rendering.profile import HEIGHT, LOUDNESS, MAX_FPS, WIDTH, Encoder

# The background is blurred at quarter size: the same look as a full-size blur at a fraction of the CPU cost.
_BLUR_FIT = (
    f"[0:v]split=2[bg][fg];"
    f"[bg]scale={WIDTH // 4}:{HEIGHT // 4}:force_original_aspect_ratio=increase,crop={WIDTH // 4}:{HEIGHT // 4},"
    f"boxblur=10:2,scale={WIDTH}:{HEIGHT}[blurred];"
    f"[fg]scale={WIDTH}:-2[picture];"
    f"[blurred][picture]overlay=(W-w)/2:(H-h)/2"
)

_FILTER_UNSAFE = set("':\\[],;")


def filter_path(path: Path) -> str:
    """A path inside a filtergraph. Ours are generated (MEDIA_ROOT + UUIDs), so refuse rather than escape
    the characters the filtergraph parser would treat as syntax."""
    text = str(path)
    if _FILTER_UNSAFE & set(text):
        raise ValueError(f"unsupported character in subtitle path {path.name!r}")
    return text


def render_args(
    source: Path,
    start: float,
    end: float,
    output: Path,
    encoder: Encoder,
    *,
    has_audio: bool,
    source_fps: float,
    subtitles: Path | None,
) -> list[str]:
    video = _BLUR_FIT + (f",ass={filter_path(subtitles)}" if subtitles else "") + ",format=yuv420p[v]"
    args = ["-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", str(source), "-filter_complex", video, "-map", "[v]"]
    if has_audio:
        args += ["-map", "0:a:0", "-af", LOUDNESS, "-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
    else:
        args += ["-an"]
    if source_fps > MAX_FPS:
        args += ["-r", str(MAX_FPS)]
    return [*args, *encoder.args, "-sn", "-dn", "-movflags", "+faststart", str(output)]


def thumbnail_args(clip: Path, at_seconds: float, output: Path) -> list[str]:
    return ["-ss", f"{at_seconds:.3f}", "-i", str(clip), "-frames:v", "1", "-q:v", "3", str(output)]
