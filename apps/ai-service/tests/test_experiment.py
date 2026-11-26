import json

import pytest

from app.analysis.ollama_vision import ModelNotInstalled
from app.jobs.experiment import ExperimentRequest, ExperimentRunner
from app.media.media_paths import MediaPaths
from app.services.health import WorkerCheck
from tests.fakes import FakeAnalyzer


class RecordingExperimentEvents:
    def __init__(self, refuse_completion: bool = False) -> None:
        self.progress: list[int] = []
        self.completion: tuple[str, dict] | None = None
        self.failure: tuple[str, str] | None = None
        self.refuse = refuse_completion

    def experiment_progress(self, experiment_id, progress, message=""):
        self.progress.append(progress)
        return False

    def experiment_completed(self, experiment_id, output_path, metrics):
        self.completion = (output_path, metrics)
        return self.refuse

    def experiment_failed(self, experiment_id, code, message):
        self.failure = (code, message)


class FixedSampler:
    peak_mib = 5230

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None


@pytest.fixture
def media(tmp_path):
    frames = tmp_path / "analysis/j1/frames"
    frames.mkdir(parents=True)
    index = [{"index": i, "file": f"frame-{i + 1:06d}.jpg", "timestampSeconds": float(i)} for i in range(10)]
    (frames / "frames.json").write_text(json.dumps(index))
    return tmp_path


def run(media, events, analyzer=None, max_frames=4):
    ExperimentRunner(MediaPaths(media), analyzer or FakeAnalyzer(), events, lambda _id: False, FixedSampler).run(
        ExperimentRequest("e1", "analysis/j1/frames", "analysis/experiments/e1", "qwen3-vl:8b-instruct", max_frames, 2)
    )


def test_runs_on_the_budgeted_frames_and_reports_metrics(media):
    events, analyzer = RecordingExperimentEvents(), FakeAnalyzer()

    run(media, events, analyzer)

    assert [f["timestampSeconds"] for f in analyzer.frames_seen] == [0.0, 3.0, 6.0, 9.0]
    path, metrics = events.completion
    assert path == "analysis/experiments/e1/visual.json"
    assert metrics["peakVramMiB"] == 5230 and metrics["framesAnalysed"] == 4 and metrics["totalMs"] >= 0
    assert json.loads((media / path).read_text())["metrics"] == metrics


def test_a_refused_completion_removes_the_output(media):
    run(media, RecordingExperimentEvents(refuse_completion=True))

    assert not (media / "analysis/experiments/e1").exists()


def test_model_errors_fail_the_experiment_without_output(media):
    events = RecordingExperimentEvents()

    run(media, events, FakeAnalyzer(error=ModelNotInstalled("qwen3-vl:8b-instruct")))

    assert events.failure[0] == "MODEL_NOT_INSTALLED"
    assert not (media / "analysis/experiments/e1").exists()


def test_missing_frames_fail_as_internal(tmp_path):
    events = RecordingExperimentEvents()

    run(tmp_path, events)

    assert events.failure[0] == "INTERNAL" and "Frames are not available" in events.failure[1]
    assert str(tmp_path) not in events.failure[1]  # no absolute paths reach the UI


async def test_worker_check_reports_a_missing_worker():
    assert (await WorkerCheck(lambda: True).run())["worker"].status == "ok"
    missing = (await WorkerCheck(lambda: False).run())["worker"]
    assert missing.status == "error" and "npm run dev:ai" in missing.detail
