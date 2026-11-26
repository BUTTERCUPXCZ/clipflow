import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import system_checks
from app.services.model_runtime import InstalledModel, ModelRuntimeStatus
from app.services.system_checks import error, ok
from tests.conftest import VISION_MODEL, ollama_client


@pytest.fixture
def fake_infra(monkeypatch):
    """Redis and FFmpeg healthy unless a test overrides them."""

    async def redis_ok(url: str):
        return ok("reachable, appendonly=yes")

    monkeypatch.setattr(system_checks, "check_redis", redis_ok)
    monkeypatch.setattr(system_checks, "check_ffmpeg", lambda: ok("/usr/bin/ffmpeg"))


def get_health(settings, ollama):
    with TestClient(create_app(settings)) as client:
        client.app.state.ollama = ollama
        return client.get("/health")


def test_all_dependencies_healthy(settings, fake_infra):
    response = get_health(settings, ollama_client([VISION_MODEL, "gemma3:1b"]))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert set(body["checks"]) == {"ollama", "vision_model", "redis", "ffmpeg", "media_root"}
    assert settings.media_root.is_dir()


def test_degraded_dependencies_return_503_without_crashing(settings, fake_infra, monkeypatch):
    async def redis_down(url: str):
        return error("unreachable: connection refused")

    monkeypatch.setattr(system_checks, "check_redis", redis_down)

    response = get_health(settings, ollama_client(None))

    assert response.status_code == 503
    checks = response.json()["checks"]
    assert checks["ollama"]["status"] == "error"
    assert checks["vision_model"]["status"] == "error"
    assert checks["redis"]["status"] == "error"
    assert checks["media_root"]["status"] == "ok"


def test_missing_vision_model_is_reported(settings, fake_infra):
    response = get_health(settings, ollama_client(["gemma3:1b"]))

    assert response.status_code == 503
    vision = response.json()["checks"]["vision_model"]
    assert vision["status"] == "error"
    assert "not installed" in vision["detail"]


def test_untagged_model_name_means_latest():
    status = ModelRuntimeStatus(reachable=True, models=[InstalledModel("llava:latest", 1)])
    assert status.has_model("llava")
    assert not status.has_model("llava:7b")


def test_media_root_not_writable(tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    assert system_checks.check_media_root(blocker / "media").status == "error"
