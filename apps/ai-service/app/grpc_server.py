import grpc
import structlog

from app.generated.ai.v1 import video_analysis_pb2 as pb2
from app.generated.ai.v1 import video_analysis_pb2_grpc as pb2_grpc
from app.services.model_runtime import ModelRuntime

log = structlog.get_logger()


class VideoAnalysisServicer(pb2_grpc.VideoAnalysisServiceServicer):
    def __init__(self, runtime: ModelRuntime, vision_model: str) -> None:
        self._runtime = runtime
        self._vision_model = vision_model

    async def GetModelStatus(self, request, context):  # noqa: N802 (gRPC method name)
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


async def start_grpc_server(servicer: VideoAnalysisServicer, port: int) -> tuple[grpc.aio.Server, int]:
    """Start on localhost only. Returns the server and the bound port (useful when port=0)."""
    server = grpc.aio.server()
    pb2_grpc.add_VideoAnalysisServiceServicer_to_server(servicer, server)
    bound_port = server.add_insecure_port(f"127.0.0.1:{port}")
    if bound_port == 0:
        raise RuntimeError(f"could not bind gRPC server to 127.0.0.1:{port}")
    await server.start()
    return server, bound_port
