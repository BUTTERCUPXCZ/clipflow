import pytest
import redis.asyncio as redis

from app.services import system_checks


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
        monkeypatch.setattr(system_checks.redis, "from_url", lambda *a, **kw: client)
        return client

    return install


async def test_redis_ok_when_reachable_with_aof(fake_redis):
    client = fake_redis(appendonly="yes")

    check = await system_checks.check_redis("redis://test")

    assert check.status == "ok"
    assert client.closed


async def test_redis_error_when_aof_is_off(fake_redis):
    fake_redis(appendonly="no")

    check = await system_checks.check_redis("redis://test")

    assert check.status == "error"
    assert "appendonly is off" in check.detail


async def test_redis_error_when_unreachable(fake_redis):
    client = fake_redis(ping_error=redis.ConnectionError("connection refused"))

    check = await system_checks.check_redis("redis://test")

    assert check.status == "error"
    assert check.detail.startswith("unreachable")
    assert client.closed


def test_ffmpeg_ok_when_both_binaries_found(monkeypatch):
    monkeypatch.setattr(system_checks.shutil, "which", lambda b: f"/usr/bin/{b}")

    assert system_checks.check_ffmpeg().status == "ok"


def test_ffmpeg_error_names_the_missing_binary(monkeypatch):
    monkeypatch.setattr(system_checks.shutil, "which", lambda b: None if b == "ffprobe" else f"/usr/bin/{b}")

    check = system_checks.check_ffmpeg()

    assert check.status == "error"
    assert check.detail == "not found on PATH: ffprobe"
