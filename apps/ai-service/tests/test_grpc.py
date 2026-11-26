import grpc

from app.generated.ai.v1 import video_analysis_pb2 as pb2
from app.generated.ai.v1 import video_analysis_pb2_grpc as pb2_grpc
from app.grpc_server import VideoAnalysisServicer, start_grpc_server
from app.services.model_runtime import OllamaRuntime
from tests.conftest import VISION_MODEL, ollama_client


async def call_get_model_status(models: list[str] | None) -> pb2.GetModelStatusResponse:
    async with ollama_client(models) as ollama:
        servicer = VideoAnalysisServicer(OllamaRuntime(ollama), VISION_MODEL)
        server, port = await start_grpc_server(servicer, 0)
        try:
            async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
                stub = pb2_grpc.VideoAnalysisServiceStub(channel)
                return await stub.GetModelStatus(pb2.GetModelStatusRequest(), timeout=5)
        finally:
            await server.stop(grace=None)


async def test_reports_installed_models():
    response = await call_get_model_status([VISION_MODEL, "gemma3:1b"])

    assert response.runtime_reachable
    assert response.configured_vision_model == VISION_MODEL
    assert response.configured_vision_model_installed
    assert [m.name for m in response.installed_models] == [VISION_MODEL, "gemma3:1b"]
    assert response.error_code == pb2.ERROR_CODE_UNSPECIFIED


async def test_unreachable_runtime_is_a_response_not_an_rpc_error():
    response = await call_get_model_status(None)

    assert not response.runtime_reachable
    assert not response.configured_vision_model_installed
    assert response.error_code == pb2.ERROR_CODE_MODEL_RUNTIME_UNAVAILABLE
