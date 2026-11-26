import shutil

import grpc
import pytest

from app.generated.ai.v1 import video_analysis_pb2 as pb2
from app.generated.ai.v1 import video_analysis_pb2_grpc as pb2_grpc
from app.grpc_server import VideoAnalysisServicer, start_grpc_server
from app.media.ffmpeg_runner import FfmpegRunner
from app.media.media_paths import MediaPaths
from app.media.prober import MediaProber
from app.services.model_runtime import OllamaRuntime
from tests.conftest import VISION_MODEL, ollama_client
from tests.media_fixtures import videos  # noqa: F401  (pytest fixture)


class FakeQueue:
    def __init__(self, fail: Exception | None = None) -> None:
        self.enqueued: list[tuple] = []
        self.fail = fail

    def enqueue(self, *args) -> None:
        if self.fail:
            raise self.fail
        self.enqueued.append(args)

    def cancel(self, job_id: str) -> bool:
        return job_id == "known"

    def state(self, job_id: str) -> str:
        return "RUNNING" if job_id == "known" else "UNKNOWN"

    def enqueue_experiment(self, *args) -> None:
        self.enqueued.append(("experiment", *args))

    def workers_running(self) -> bool:
        return True

    def enqueue_plan(self, plan_id, params) -> None:
        self.enqueued.append(("plan", plan_id, params))

    def enqueue_render(self, render_id, params) -> None:
        self.enqueued.append(("render", render_id, params))


@pytest.fixture
def media_root(tmp_path, videos):
    root = tmp_path / "media"
    (root / "original-videos").mkdir(parents=True)
    shutil.copy(videos.with_audio, root / "original-videos" / "good.mp4")
    shutil.copy(videos.corrupt, root / "original-videos" / "bad.mp4")
    return root


async def call(method: str, request, *, models=None, queue=None, media_root=None):
    async with ollama_client(models) as ollama:
        servicer = VideoAnalysisServicer(
            OllamaRuntime(ollama),
            VISION_MODEL,
            paths=MediaPaths(media_root or "/nonexistent"),
            prober=MediaProber(FfmpegRunner()),
            queue=queue or FakeQueue(),
        )
        server, port = await start_grpc_server(servicer, 0)
        try:
            async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
                return await getattr(pb2_grpc.VideoAnalysisServiceStub(channel), method)(request, timeout=10)
        finally:
            await server.stop(grace=None)


async def test_reports_installed_models():
    response = await call("GetModelStatus", pb2.GetModelStatusRequest(), models=[VISION_MODEL, "gemma3:1b"])

    assert response.runtime_reachable
    assert response.configured_vision_model_installed
    assert [(m.name, m.vision) for m in response.installed_models] == [(VISION_MODEL, True), ("gemma3:1b", False)]
    assert response.worker_running


async def test_unreachable_runtime_is_a_response_not_an_rpc_error():
    response = await call("GetModelStatus", pb2.GetModelStatusRequest(), models=None)

    assert not response.runtime_reachable
    assert response.error_code == pb2.ERROR_CODE_MODEL_RUNTIME_UNAVAILABLE


async def test_probe_video_returns_media_facts(media_root):
    response = await call("ProbeVideo", pb2.ProbeVideoRequest(storage_path="original-videos/good.mp4"), media_root=media_root)

    assert response.decodable
    assert (response.width, response.height, response.has_audio, response.video_codec) == (1280, 720, True, "h264")
    assert response.duration_seconds == pytest.approx(3.0, abs=0.1)


async def test_probe_video_flags_an_undecodable_file(media_root):
    response = await call("ProbeVideo", pb2.ProbeVideoRequest(storage_path="original-videos/bad.mp4"), media_root=media_root)

    assert not response.decodable
    assert response.error_code == pb2.ERROR_CODE_MEDIA_UNDECODABLE


async def test_probe_video_refuses_paths_outside_media_root(media_root):
    response = await call("ProbeVideo", pb2.ProbeVideoRequest(storage_path="../../etc/passwd"), media_root=media_root)

    assert response.error_code == pb2.ERROR_CODE_INVALID_PATH


async def test_start_analysis_enqueues_with_defaults(media_root):
    queue = FakeQueue()
    request = pb2.StartAnalysisRequest(job_id="j1", storage_path="original-videos/good.mp4", artifacts_path="analysis/j1")

    response = await call("StartAnalysis", request, queue=queue, media_root=media_root)

    assert response.accepted
    assert queue.enqueued == [("j1", "original-videos/good.mp4", "analysis/j1", 1.0, 768)]


async def test_start_analysis_reports_an_unavailable_queue(media_root):
    request = pb2.StartAnalysisRequest(job_id="j1", storage_path="original-videos/good.mp4", artifacts_path="analysis/j1")

    response = await call("StartAnalysis", request, queue=FakeQueue(fail=ConnectionError("redis down")), media_root=media_root)

    assert not response.accepted
    assert response.error_code == pb2.ERROR_CODE_QUEUE_UNAVAILABLE


async def test_start_analysis_refuses_escaping_artifacts_path(media_root):
    request = pb2.StartAnalysisRequest(job_id="j1", storage_path="original-videos/good.mp4", artifacts_path="../out")

    response = await call("StartAnalysis", request, media_root=media_root)

    assert response.error_code == pb2.ERROR_CODE_INVALID_PATH


async def test_cancel_and_status_delegate_to_the_queue():
    assert (await call("CancelAnalysis", pb2.CancelAnalysisRequest(job_id="known"))).found
    assert not (await call("CancelAnalysis", pb2.CancelAnalysisRequest(job_id="other"))).found
    state = (await call("GetAnalysisStatus", pb2.GetAnalysisStatusRequest(job_id="known"))).state
    assert state == pb2.ANALYSIS_STATE_RUNNING


async def test_start_experiment_enqueues_on_the_same_queue(media_root):
    queue = FakeQueue()
    request = pb2.StartExperimentRequest(
        experiment_id="e1", frames_path="analysis/j1/frames", output_path="analysis/experiments/e1", model="m"
    )

    response = await call("StartExperiment", request, queue=queue, media_root=media_root)

    assert response.accepted
    assert queue.enqueued == [("experiment", "e1", "analysis/j1/frames", "analysis/experiments/e1", "m", 60, 4)]


P1 = "11111111-1111-4111-8111-111111111111"
R1 = "22222222-2222-4222-8222-222222222222"
C1 = "33333333-3333-4333-8333-333333333333"


def planning(**overrides):
    fields = dict(
        plan_id=P1, transcript_path="analysis/j1/transcript.json", visual_path="analysis/j1/visual.json",
        output_path=f"analysis/j1/plans/{P1}", duration_seconds=600.0, min_seconds=15, max_seconds=60, max_clips=4, model="m",
    )
    return pb2.StartPlanningRequest(**(fields | overrides))


async def test_start_planning_enqueues_validated_settings(media_root):
    queue = FakeQueue()

    response = await call("StartPlanning", planning(), queue=queue, media_root=media_root)

    assert response.accepted
    assert queue.enqueued[0][:2] == ("plan", P1) and queue.enqueued[0][2]["max_clips"] == 4


@pytest.mark.parametrize("overrides", [{"min_seconds": 90, "max_seconds": 30}, {"max_clips": 0}, {"duration_seconds": 0}, {"model": ""},
     {"duration_seconds": float("nan")}, {"output_path": "analysis/j1"}, {"plan_id": ""}, {"plan_id": "p1"}])
async def test_start_planning_rejects_bad_settings(media_root, overrides):
    queue = FakeQueue()
    response = await call("StartPlanning", planning(**overrides), queue=queue, media_root=media_root)
    assert not response.accepted and queue.enqueued == []


async def test_start_planning_rejects_paths_outside_analysis(media_root):
    response = await call("StartPlanning", planning(transcript_path="src/x.json"), media_root=media_root)
    assert not response.accepted and response.error_code == pb2.ERROR_CODE_INVALID_PATH


def rendering(clips=None, **overrides):
    clip = pb2.RenderClipSpec(clip_id=C1, start=1.0, end=20.0, cues=[pb2.SubtitleCue(start=0.1, end=1.0, text="Hi")])
    fields = dict(render_id=R1, source_path="original-videos/u/p/v/source.mp4", output_path=f"analysis/j1/renders/{R1}",
                  subtitles=True, clips=[clip] if clips is None else clips)
    return pb2.StartRenderingRequest(**(fields | overrides))


async def test_start_rendering_enqueues_the_clips_with_their_cues(media_root):
    queue = FakeQueue()

    response = await call("StartRendering", rendering(), queue=queue, media_root=media_root)

    assert response.accepted
    kind, render_id, params = queue.enqueued[0]
    assert (kind, render_id) == ("render", R1)
    assert params["clips"] == [{"clip_id": C1, "start": 1.0, "end": 20.0, "cues": [{"start": 0.1, "end": 1.0, "text": "Hi"}]}]


@pytest.mark.parametrize(
    "request_",
    [
        rendering(clips=[]),
        rendering(output_path="analysis/j1"),
        rendering(clips=[pb2.RenderClipSpec(clip_id=C1, start=5, end=5)]),
        rendering(source_path="../outside.mp4"),
        rendering(source_path="analysis/j1/transcript.json"),  # only original videos are sources
        rendering(clips=[pb2.RenderClipSpec(clip_id="../../../home/u/Videos/holiday", start=1, end=2)]),
        rendering(render_id="x/../..", output_path="analysis/j1/renders/x/../.."),
        rendering(output_path=f"analysis/j1/plans/{R1}"),
    ],
)
async def test_start_rendering_refuses_bad_requests(media_root, request_):
    queue = FakeQueue()
    response = await call("StartRendering", request_, queue=queue, media_root=media_root)
    assert not response.accepted and queue.enqueued == []
