import json
import os
import subprocess
import threading
import time
import wave

import pytest

from app.media.extractors import FRAMES_INDEX, AudioExtractor, FrameExtractor
from app.media.ffmpeg_runner import FfmpegCancelled, FfmpegError, FfmpegRunner
from app.media.media_paths import MediaPaths, PathEscapeError
from app.media.prober import MediaProber
from tests.media_fixtures import videos  # noqa: F401  (pytest fixture)

runner = FfmpegRunner(poll_interval=0.05, kill_grace=2)


# --- MediaPaths ---


def test_resolves_paths_inside_media_root(tmp_path):
    paths = MediaPaths(tmp_path)

    assert paths.resolve("original-videos/u/p/v/source.mp4") == tmp_path.resolve() / "original-videos/u/p/v/source.mp4"


@pytest.mark.parametrize("bad", ["", "/etc/passwd", "../outside", "a/../../outside"])
def test_rejects_paths_outside_media_root(tmp_path, bad):
    with pytest.raises(PathEscapeError):
        MediaPaths(tmp_path).resolve(bad)


def test_rejects_a_symlink_that_leads_outside(tmp_path):
    root, outside = tmp_path / "media", tmp_path / "secret"
    root.mkdir()
    outside.mkdir()
    (root / "link").symlink_to(outside)

    with pytest.raises(PathEscapeError):
        MediaPaths(root).resolve("link/file.mp4")


# --- MediaProber ---


def test_probes_a_video_with_audio(videos):
    result = MediaProber(runner).probe(videos.with_audio)

    assert result.decodable
    assert result.duration_seconds == pytest.approx(3.0, abs=0.1)
    assert (result.width, result.height, result.frame_rate) == (1280, 720, 25.0)
    assert (result.video_codec, result.audio_codec, result.has_audio) == ("h264", "aac", True)
    assert "mp4" in result.container


def test_probes_a_video_without_audio(videos):
    result = MediaProber(runner).probe(videos.no_audio)

    assert result.decodable
    assert not result.has_audio
    assert result.audio_codec == ""


def test_reports_a_corrupt_file_as_undecodable(videos):
    result = MediaProber(runner).probe(videos.corrupt)

    assert not result.decodable
    assert result.error


# --- Extraction ---


def test_extracts_whisper_ready_audio(videos, tmp_path):
    progress: list[float] = []
    out = tmp_path / "audio.wav"

    AudioExtractor(runner).extract(videos.with_audio, out, duration=3.0, on_progress=progress.append)

    with wave.open(str(out)) as wav:
        assert (wav.getnchannels(), wav.getframerate(), wav.getsampwidth()) == (1, 16_000, 2)
        assert wav.getnframes() / 16_000 == pytest.approx(3.0, abs=0.1)
    assert progress == sorted(progress)


def test_extracts_one_frame_per_interval_no_wider_than_max(videos, tmp_path):
    frames = FrameExtractor(runner).extract(
        videos.with_audio, tmp_path / "frames", interval=1.0, max_width=768, duration=3.0
    )

    assert len(frames) == 3
    probe = MediaProber(runner).probe(tmp_path / "frames" / frames[0].file)
    assert (probe.width, probe.height) == (768, 432)
    index = json.loads((tmp_path / "frames" / FRAMES_INDEX).read_text())
    assert [f["timestampSeconds"] for f in index] == [0.0, 1.0, 2.0]


def test_does_not_upscale_small_videos(videos, tmp_path):
    frames = FrameExtractor(runner).extract(videos.no_audio, tmp_path / "f", interval=1.0, max_width=768, duration=3.0)

    assert MediaProber(runner).probe(tmp_path / "f" / frames[0].file).width == 320


def test_ffmpeg_failure_raises_with_stderr(tmp_path):
    with pytest.raises(FfmpegError, match="exited with code"):
        runner.run(["-i", str(tmp_path / "missing.mp4"), str(tmp_path / "out.wav")])


def test_cancel_kills_ffmpeg_promptly(tmp_path):
    started = time.monotonic()
    cancel = threading.Event()
    threading.Timer(0.5, cancel.set).start()
    pids_before = _ffmpeg_pids()

    with pytest.raises(FfmpegCancelled):
        runner.run(
            ["-f", "lavfi", "-i", "testsrc=duration=600:size=1280x720:rate=25", "-f", "null", "-"],
            duration=600,
            should_cancel=cancel.is_set,
        )

    assert time.monotonic() - started < 5
    assert _ffmpeg_pids() - pids_before == set()


def _ffmpeg_pids() -> set[int]:
    out = subprocess.run(["pgrep", "-x", "ffmpeg"], capture_output=True, text=True).stdout
    return {int(p) for p in out.split()} - {os.getpid()}


def test_error_messages_never_expose_absolute_paths(videos):
    result = MediaProber(runner).probe(videos.corrupt)

    assert str(videos.corrupt.parent) not in result.error
    assert "@ 0x" not in result.error
    assert "\n" not in result.error
    assert "moov atom not found" in result.error


@pytest.mark.parametrize("bad", [".", "analysis", "analysis/..", "original-videos/u/p/v"])
def test_artifact_dirs_must_sit_strictly_under_analysis(tmp_path, bad):
    """Every rmtree in the pipeline goes through this: "." would otherwise wipe the media library."""
    with pytest.raises(PathEscapeError):
        MediaPaths(tmp_path).resolve_artifacts(bad)


def test_artifact_dir_under_analysis_is_accepted(tmp_path):
    assert MediaPaths(tmp_path).resolve_artifacts("analysis/u/p/v/j") == tmp_path.resolve() / "analysis/u/p/v/j"
