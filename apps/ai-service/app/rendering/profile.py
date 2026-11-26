"""Output profile (system-design §11.1) and encoder choice: NVENC when this machine can use it, libx264 otherwise."""

from dataclasses import dataclass

from app.media.ffmpeg_runner import FfmpegError, FfmpegRunner

WIDTH, HEIGHT = 1080, 1920
MAX_FPS = 60
LOUDNESS = "loudnorm=I=-14:TP=-1.5:LRA=11"  # short-form platforms normalise to about -14 LUFS


@dataclass(frozen=True)
class Encoder:
    name: str
    args: tuple[str, ...]


X264 = Encoder("libx264", ("-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p"))
NVENC = Encoder("h264_nvenc", ("-c:v", "h264_nvenc", "-preset", "p5", "-cq", "23", "-pix_fmt", "yuv420p"))


def nvenc_works(runner: FfmpegRunner) -> bool:
    """A one-frame test encode: the encoder can be compiled in yet unusable (no NVIDIA driver, no free session)."""
    try:
        runner.run(["-f", "lavfi", "-i", "color=black:s=256x256:d=0.1", "-frames:v", "1", *NVENC.args, "-f", "null", "-"])
        return True
    except FfmpegError:
        return False


def choose_encoder(setting: str, runner: FfmpegRunner) -> Encoder:
    """`setting`: auto | nvenc | x264 (VIDEO_ENCODER)."""
    if setting == "x264":
        return X264
    if setting == "nvenc":
        return NVENC
    return NVENC if nvenc_works(runner) else X264
