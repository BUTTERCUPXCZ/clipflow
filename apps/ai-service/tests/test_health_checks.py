import pytest
import redis.asyncio as redis

from app.services.health import FfmpegCheck, MediaRootCheck, ModelRuntimeCheck, RedisCheck
from app.services.health import checks as checks_module
from app.services.model_runtime import InstalledModel, ModelRuntimeStatus
from tests.conftest import VISION_MODEL


class FakeRuntime:
    def __init__(self, status: ModelRuntimeStatus) -> None:
        self._status = status

    async def status(self) -> ModelRuntimeStatus:
        return self._status


def installed(*names: str) -> ModelRuntimeStatus:
    return ModelRuntimeStatus(reachable=True, models=[InstalledModel(n, 1) for n in names])


class FakeRedis:
    def __init__(self, appendonly: str | None = "yes", ping_error: Exception | None = None):
        self._appendonly = appendonly
        self._ping_error = ping_error
        self.closed = False

    async def ping(self):
        if self._ping_error:
            raise self._ping_error

    async def config_get(self, name: str):
        return {name: self._appendonly}

    async def aclose(self):
        self.closed = True


@pytest.fixture
def fake_redis(monkeypatch):
    def install(**kwargs) -> FakeRedis:
        client = FakeRedis(**kwargs)
        monkeypatch.setattr(checks_module.redis, "from_url", lambda *a, **kw: client)
        return client

    return install


# --- ModelRuntimeCheck ---


async def test_runtime_and_model_ok():
    result = await ModelRuntimeCheck(FakeRuntime(installed(VISION_MODEL, "gemma3:1b")), VISION_MODEL).run()

    assert result["ollama"].detail == "2 models installed"
    assert result["vision_model"].status == "ok"


async def test_missing_model_tells_how_to_install():
    result = await ModelRuntimeCheck(FakeRuntime(installed("gemma3:1b")), VISION_MODEL).run()

    assert result["ollama"].status == "ok"
    assert result["vision_model"].status == "error"
    assert f"ollama pull {VISION_MODEL}" in result["vision_model"].detail


async def test_unreachable_runtime_fails_both_entries():
    down = ModelRuntimeStatus(reachable=False, error="connection refused")
    result = await ModelRuntimeCheck(FakeRuntime(down), VISION_MODEL).run()

    assert {c.status for c in result.values()} == {"error"}


def test_untagged_model_name_means_latest():
    status = installed("llava:latest")
    assert status.has_model("llava")
    assert not status.has_model("llava:7b")


# --- RedisCheck ---


async def test_redis_ok_when_reachable_with_aof(fake_redis):
    client = fake_redis(appendonly="yes")

    assert (await RedisCheck("redis://test").run())["redis"].status == "ok"
    assert client.closed


async def test_redis_error_when_aof_is_off(fake_redis):
    fake_redis(appendonly="no")

    check = (await RedisCheck("redis://test").run())["redis"]

    assert check.status == "error"
    assert "appendonly is off" in check.detail


async def test_redis_error_when_unreachable(fake_redis):
    client = fake_redis(ping_error=redis.ConnectionError("connection refused"))

    check = (await RedisCheck("redis://test").run())["redis"]

    assert check.detail.startswith("unreachable")
    assert client.closed


async def test_redis_malformed_url_is_reported_not_raised():
    check = (await RedisCheck("not-a-redis-url").run())["redis"]

    assert check.status == "error"
    assert check.detail.startswith("invalid REDIS_URL")


# --- FfmpegCheck ---


async def test_ffmpeg_ok_when_both_binaries_found():
    result = await FfmpegCheck(which=lambda b: f"/usr/bin/{b}").run()

    assert result["ffmpeg"].status == "ok"


async def test_ffmpeg_error_names_the_missing_binary():
    result = await FfmpegCheck(which=lambda b: None if b == "ffprobe" else f"/usr/bin/{b}").run()

    assert result["ffmpeg"].detail == "not found on PATH: ffprobe"


# --- MediaRootCheck ---


async def test_media_root_is_created(tmp_path):
    root = tmp_path / "media"

    assert (await MediaRootCheck(root).run())["media_root"].status == "ok"
    assert root.is_dir()


async def test_media_root_not_creatable(tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")

    assert (await MediaRootCheck(blocker / "media").run())["media_root"].status == "error"
