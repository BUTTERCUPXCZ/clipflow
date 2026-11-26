import asyncio
import math
import uuid
from typing import Protocol

import grpc
import structlog

from app.generated.ai.v1 import video_analysis_pb2 as pb2
from app.generated.ai.v1 import video_analysis_pb2_grpc as pb2_grpc
from app.media.media_paths import MediaPaths, PathEscapeError
from app.media.prober import MediaProber
from app.planning.schemas import PlanSettings
from app.services.model_runtime import ModelRuntime

log = structlog.get_logger()


class AnalysisQueue(Protocol):
    """What the gRPC layer needs from the job queue (implemented by app.jobs.queue.JobQueue)."""

    def enqueue(self, job_id: str, storage_path: str, artifacts_path: str, interval: float, max_width: int) -> None: ...
    def cancel(self, job_id: str) -> bool: ...
    def state(self, job_id: str) -> str: ...  # "QUEUED" | "RUNNING" | "FINISHED" | "UNKNOWN"
    def enqueue_experiment(
        self, experiment_id: str, frames_path: str, output_path: str, model: str, max_frames: int, batch_size: int
    ) -> None: ...
    def workers_running(self) -> bool: ...
    def enqueue_plan(self, plan_id: str, params: dict) -> None: ...
    def enqueue_render(self, render_id: str, params: dict) -> None: ...


class VideoAnalysisServicer(pb2_grpc.VideoAnalysisServiceServicer):
    def __init__(
        self,
        runtime: ModelRuntime,
        vision_model: str,
        paths: MediaPaths,
        prober: MediaProber,
        queue: AnalysisQueue,
    ) -> None:
        self._runtime = runtime
        self._vision_model = vision_model
        self._paths = paths
        self._prober = prober
        self._queue = queue

    async def GetModelStatus(self, request, context):  # noqa: N802 (gRPC method names)
        status = await self._runtime.status()
        if not status.reachable:
            log.warning("model_runtime_unreachable", error=status.error)
        return pb2.GetModelStatusResponse(
            runtime_reachable=status.reachable,
            installed_models=[pb2.ModelInfo(name=m.name, size_bytes=m.size_bytes, vision=m.vision) for m in status.models],
            worker_running=await asyncio.to_thread(self._workers_running),
            configured_vision_model=self._vision_model,
            configured_vision_model_installed=status.has_model(self._vision_model),
            error_code=(
                pb2.ERROR_CODE_UNSPECIFIED
                if status.reachable
                else pb2.ERROR_CODE_MODEL_RUNTIME_UNAVAILABLE
            ),
        )

    async def ProbeVideo(self, request, context):  # noqa: N802
        try:
            path = self._paths.resolve(request.storage_path)
        except PathEscapeError as exc:
            return pb2.ProbeVideoResponse(error_code=pb2.ERROR_CODE_INVALID_PATH, error_message=str(exc))
        # ffprobe is a blocking subprocess; keep the event loop (HTTP + gRPC) responsive.
        result = await asyncio.to_thread(self._prober.probe, path)
        if not result.decodable:
            return pb2.ProbeVideoResponse(error_code=pb2.ERROR_CODE_MEDIA_UNDECODABLE, error_message=result.error)
        return pb2.ProbeVideoResponse(
            decodable=True,
            duration_seconds=result.duration_seconds,
            width=result.width,
            height=result.height,
            frame_rate=result.frame_rate,
            video_codec=result.video_codec,
            audio_codec=result.audio_codec,
            has_audio=result.has_audio,
            container=result.container,
        )

    async def StartAnalysis(self, request, context):  # noqa: N802
        try:
            self._paths.resolve(request.storage_path)
            self._paths.resolve_artifacts(request.artifacts_path)
            settings = request.settings
            await asyncio.to_thread(
                self._queue.enqueue,
                request.job_id,
                request.storage_path,
                request.artifacts_path,
                settings.frame_interval_seconds or 1.0,
                settings.frame_max_width or 768,
            )
        except PathEscapeError as exc:
            return pb2.StartAnalysisResponse(accepted=False, error_code=pb2.ERROR_CODE_INVALID_PATH, error_message=str(exc))
        except Exception as exc:  # Redis down: NestJS marks the job FAILED and answers 503
            log.error("enqueue_failed", job_id=request.job_id, error=str(exc))
            return pb2.StartAnalysisResponse(
                accepted=False, error_code=pb2.ERROR_CODE_QUEUE_UNAVAILABLE, error_message=str(exc)
            )
        return pb2.StartAnalysisResponse(accepted=True)

    async def StartPlanning(self, request, context):  # noqa: N802
        try:
            for path in (request.transcript_path, request.visual_path, request.output_path):
                self._paths.resolve_artifacts(path)
            params = {
                "transcript_path": request.transcript_path,
                "visual_path": request.visual_path,
                "output_path": request.output_path,
                "duration_seconds": request.duration_seconds,
                "min_seconds": request.min_seconds,
                "max_seconds": request.max_seconds,
                "max_clips": request.max_clips,
                "model": request.model,
            }
            PlanSettings(minSeconds=request.min_seconds, maxSeconds=request.max_seconds, maxClips=request.max_clips)
            if not (math.isfinite(request.duration_seconds) and request.duration_seconds > 0) or not request.model:
                raise ValueError("duration_seconds must be a positive number and model set")
            if not _is_uuid(request.plan_id) or not request.output_path.rstrip("/").endswith(f"/plans/{request.plan_id}"):
                # The runner removes output_path on failure: it must be this plan's own directory, never a job's.
                raise ValueError("output_path must be the plan's own directory")
            await asyncio.to_thread(self._queue.enqueue_plan, request.plan_id, params)
        except PathEscapeError as exc:
            return pb2.StartAnalysisResponse(accepted=False, error_code=pb2.ERROR_CODE_INVALID_PATH, error_message=str(exc))
        except ValueError as exc:  # settings out of range (NestJS validates first; this is the trust boundary)
            return pb2.StartAnalysisResponse(accepted=False, error_code=pb2.ERROR_CODE_UNSPECIFIED, error_message=str(exc))
        except Exception as exc:  # Redis down
            log.error("enqueue_plan_failed", plan_id=request.plan_id, error=str(exc))
            return pb2.StartAnalysisResponse(
                accepted=False, error_code=pb2.ERROR_CODE_QUEUE_UNAVAILABLE, error_message=str(exc)
            )
        return pb2.StartAnalysisResponse(accepted=True)

    async def StartRendering(self, request, context):  # noqa: N802
        try:
            if not request.source_path.startswith("original-videos/"):
                raise PathEscapeError("source_path must be an original video")
            self._paths.resolve(request.source_path)
            output = self._paths.resolve_artifacts(request.output_path)
            # Ids become file names and the runner removes output_path on failure: UUIDs only, and the
            # resolved directory must be exactly renders/<render_id>.
            if not _is_uuid(request.render_id) or (output.parent.name, output.name) != ("renders", request.render_id):
                raise ValueError("output_path must be the render's own directory")
            if not request.clips:
                raise ValueError("no clips to render")
            clips = [
                {
                    "clip_id": c.clip_id, "start": c.start, "end": c.end,
                    "cues": [{"start": q.start, "end": q.end, "text": q.text} for q in c.cues],
                }
                for c in request.clips
            ]
            if not all(_valid_clip(c) for c in clips):
                raise ValueError("every clip needs an id and 0 <= start < end")
            params = {"source_path": request.source_path, "output_path": request.output_path,
                      "subtitles": request.subtitles, "clips": clips}
            await asyncio.to_thread(self._queue.enqueue_render, request.render_id, params)
        except PathEscapeError as exc:
            return pb2.StartAnalysisResponse(accepted=False, error_code=pb2.ERROR_CODE_INVALID_PATH, error_message=str(exc))
        except ValueError as exc:
            return pb2.StartAnalysisResponse(accepted=False, error_code=pb2.ERROR_CODE_UNSPECIFIED, error_message=str(exc))
        except Exception as exc:  # Redis down
            log.error("enqueue_render_failed", render_id=request.render_id, error=str(exc))
            return pb2.StartAnalysisResponse(
                accepted=False, error_code=pb2.ERROR_CODE_QUEUE_UNAVAILABLE, error_message=str(exc)
            )
        return pb2.StartAnalysisResponse(accepted=True)

    async def StartExperiment(self, request, context):  # noqa: N802
        try:
            self._paths.resolve_artifacts(request.frames_path)
            self._paths.resolve_artifacts(request.output_path)
            await asyncio.to_thread(
                self._queue.enqueue_experiment,
                request.experiment_id,
                request.frames_path,
                request.output_path,
                request.model,
                request.max_frames or 60,
                request.batch_size or 4,
            )
        except PathEscapeError as exc:
            return pb2.StartAnalysisResponse(accepted=False, error_code=pb2.ERROR_CODE_INVALID_PATH, error_message=str(exc))
        except Exception as exc:  # Redis down
            log.error("enqueue_experiment_failed", experiment_id=request.experiment_id, error=str(exc))
            return pb2.StartAnalysisResponse(
                accepted=False, error_code=pb2.ERROR_CODE_QUEUE_UNAVAILABLE, error_message=str(exc)
            )
        return pb2.StartAnalysisResponse(accepted=True)

    def _workers_running(self) -> bool:
        try:
            return self._queue.workers_running()
        except Exception:  # noqa: BLE001 — Redis down: report no worker rather than failing the status call
            return False

    async def CancelAnalysis(self, request, context):  # noqa: N802
        return pb2.CancelAnalysisResponse(found=await asyncio.to_thread(self._queue.cancel, request.job_id))

    async def GetAnalysisStatus(self, request, context):  # noqa: N802
        state = await asyncio.to_thread(self._queue.state, request.job_id)
        return pb2.GetAnalysisStatusResponse(state=pb2.AnalysisState.Value(f"ANALYSIS_STATE_{state}"))


async def start_grpc_server(servicer: VideoAnalysisServicer, port: int) -> tuple[grpc.aio.Server, int]:
    """Start on localhost only. Returns the server and the bound port (useful when port=0)."""
    server = grpc.aio.server()
    pb2_grpc.add_VideoAnalysisServiceServicer_to_server(servicer, server)
    bound_port = server.add_insecure_port(f"127.0.0.1:{port}")
    if bound_port == 0:
        raise RuntimeError(f"could not bind gRPC server to 127.0.0.1:{port}")
    await server.start()
    return server, bound_port


def _is_uuid(value: str) -> bool:
    try:
        return str(uuid.UUID(value)) == value.lower()
    except ValueError:
        return False


def _valid_clip(clip: dict) -> bool:
    ok = _is_uuid(clip["clip_id"]) and all(math.isfinite(clip[k]) for k in ("start", "end"))
    return ok and 0 <= clip["start"] < clip["end"]
