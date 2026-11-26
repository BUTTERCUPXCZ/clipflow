import asyncio
from typing import Protocol

import grpc
import structlog

from app.generated.ai.v1 import video_analysis_pb2 as pb2
from app.generated.ai.v1 import video_analysis_pb2_grpc as pb2_grpc
from app.media.media_paths import MediaPaths, PathEscapeError
from app.media.prober import MediaProber
from app.services.model_runtime import ModelRuntime

log = structlog.get_logger()


class AnalysisQueue(Protocol):
    """What the gRPC layer needs from the job queue (implemented by app.jobs.queue.JobQueue)."""

    def enqueue(self, job_id: str, storage_path: str, artifacts_path: str, interval: float, max_width: int) -> None: ...
    def cancel(self, job_id: str) -> bool: ...
    def state(self, job_id: str) -> str: ...  # "QUEUED" | "RUNNING" | "FINISHED" | "UNKNOWN"


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
            installed_models=[pb2.ModelInfo(name=m.name, size_bytes=m.size_bytes) for m in status.models],
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
