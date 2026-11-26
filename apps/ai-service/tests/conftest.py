import httpx
import pytest

from app.config import Settings

VISION_MODEL = "qwen3-vl:8b-instruct"


def ollama_client(models: list[str] | None) -> httpx.AsyncClient:
    """Fake Ollama. `models=None` simulates an unreachable server."""

    def handler(request: httpx.Request) -> httpx.Response:
        if models is None:
            raise httpx.ConnectError("connection refused", request=request)
        assert request.url.path == "/api/tags"
        return httpx.Response(200, json={"models": [{"name": m, "size": 123} for m in models]})

    return httpx.AsyncClient(base_url="http://ollama.test", transport=httpx.MockTransport(handler))


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        _env_file=None,
        ai_grpc_port=0,
        media_root=tmp_path / "media",
        vision_model=VISION_MODEL,
    )
