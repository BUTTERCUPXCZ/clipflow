import json
import shutil
import threading

import pytest

from app.jobs.pipeline import JobRequest, ProcessingPipeline, ProgressReporter
from app.media.extractors import AudioExtractor, FrameExtractor
from app.media.ffmpeg_runner import FfmpegRunner
from app.media.media_paths import MediaPaths
from app.media.prober import MediaProber
from tests.media_fixtures import videos  # noqa: F401  (pytest fixture)


class RecordingEvents:
    def __init__(self) -> None:
        self.progress_events: list[tuple[str, int]] = []
        self.completion: dict | None = None
        self.failure: tuple[str, str] | None = None

    def progress(self, job_id, status, stage, progress, message=""):
        self.progress_events.append((status, progress))

    def completed(self, job_id, artifacts):
        self.completion = artifacts

    def failed(self, job_id, code, message):
        self.failure = (code, message)


@pytest.fixture
def media(tmp_path, videos):
    root = tmp_path / "media"
    (root / "src").mkdir(parents=True)
    for name, path in (("good", videos.with_audio), ("silent", videos.no_audio), ("bad", videos.corrupt)):
        shutil.copy(path, root / "src" / f"{name}.mp4")
    return root


def pipeline(root, events, cancel=lambda job_id: False):
    runner = FfmpegRunner(poll_interval=0.05, kill_grace=2)
    return ProcessingPipeline(
        MediaPaths(root), MediaProber(runner), AudioExtractor(runner), FrameExtractor(runner), events, cancel
    )


def request(name: str) -> JobRequest:
    return JobRequest(job_id="j1", storage_path=f"src/{name}.mp4", artifacts_path="analysis/j1", interval=1.0, max_width=768)


def test_completes_with_audio_and_frames(media):
    events = RecordingEvents()

    pipeline(media, events).run(request("good"))

    assert events.failure is None
    assert events.completion["has_audio"] is True
    assert events.completion["audio_duration_seconds"] == pytest.approx(3.0, abs=0.1)
    assert events.completion["frame_count"] == 3
    assert events.completion["audio_path"] == "analysis/j1/audio.wav"
    frames = json.loads((media / events.completion["frames_path"] / "frames.json").read_text())
    assert len(frames) == 3
    statuses = [s for s, _ in events.progress_events]
    assert statuses[0] == "VALIDATING" and statuses[-1] == "EXTRACTING_MEDIA"
    percents = [p for s, p in events.progress_events if s == "EXTRACTING_MEDIA"]
    assert percents == sorted(percents)


def test_video_without_audio_completes_without_an_audio_file(media):
    events = RecordingEvents()

    pipeline(media, events).run(request("silent"))

    assert events.completion["has_audio"] is False
    assert events.completion["audio_path"] == ""
    assert not (media / "analysis/j1/audio.wav").exists()


def test_undecodable_video_fails_without_leaving_files(media):
    events = RecordingEvents()

    pipeline(media, events).run(request("bad"))

    assert events.failure[0] == "MEDIA_UNDECODABLE"
    assert events.failure[1].startswith("Not a playable video")
    assert not (media / "analysis/j1").exists()


def test_cancel_during_extraction_stops_and_removes_partial_files(media):
    events = RecordingEvents()
    cancel = threading.Event()
    original = events.progress

    def progress(job_id, status, stage, pct, message=""):
        original(job_id, status, stage, pct, message)
        if status == "EXTRACTING_MEDIA":
            cancel.set()

    events.progress = progress

    pipeline(media, events, cancel=lambda job_id: cancel.is_set()).run(request("good"))

    assert events.failure == ("CANCELLED", "Cancelled by the user")
    assert events.completion is None
    assert not (media / "analysis/j1").exists()


def test_paths_escaping_media_root_fail_as_internal(media):
    events = RecordingEvents()

    pipeline(media, events).run(JobRequest("j1", "../outside.mp4", "analysis/j1", 1.0, 768))

    assert events.failure[0] == "INTERNAL"


def test_progress_reporter_sends_only_changes():
    sent: list[int] = []
    reporter = ProgressReporter(sent.append, min_interval=0)

    for fraction in (0.0, 0.001, 0.5, 0.5, 1.0):
        reporter.band(30, 99)(fraction)

    assert sent == [30, 64, 99]


def test_stops_when_nest_says_the_job_is_gone(media):
    events = RecordingEvents()
    original = events.progress

    def progress(job_id, status, stage, pct, message=""):
        original(job_id, status, stage, pct, message)
        return status == "EXTRACTING_MEDIA"  # e.g. the video was deleted: NestJS answers stop=true

    events.progress = progress

    pipeline(media, events).run(request("good"))

    assert events.failure[0] == "CANCELLED"
    assert not (media / "analysis/j1").exists()


def test_refused_completion_leaves_no_files(media):
    """A cancel that lands after the last check: NestJS refuses the completion (stop=true)."""
    events = RecordingEvents()
    original = events.completed

    def completed(job_id, artifacts):
        original(job_id, artifacts)
        return True

    events.completed = completed

    pipeline(media, events).run(request("good"))

    assert events.completion is not None
    assert not (media / "analysis/j1").exists()


def test_refuses_to_use_media_root_itself_as_artifacts(media):
    events = RecordingEvents()

    pipeline(media, events).run(JobRequest("j1", "src/good.mp4", ".", 1.0, 768))

    assert events.failure[0] == "INTERNAL"
    assert (media / "src" / "good.mp4").exists()
