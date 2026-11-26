from fastapi.testclient import TestClient

from app.main import create_app
from app.services.health import Check, HealthService, error, ok


class StaticCheck:
    def __init__(self, **results: Check) -> None:
        self._results = results

    async def run(self) -> dict[str, Check]:
        return self._results


def get_health(settings, service: HealthService):
    with TestClient(create_app(settings)) as client:
        client.app.state.health = service
        return client.get("/health")


async def test_service_merges_results_of_every_check():
    service = HealthService([StaticCheck(a=ok("1")), StaticCheck(b=ok("2"), c=ok("3"))])

    report = await service.report()

    assert report.healthy
    assert set(report.checks) == {"a", "b", "c"}


async def test_service_is_unhealthy_when_any_check_fails():
    report = await HealthService([StaticCheck(a=ok("1")), StaticCheck(b=error("down"))]).report()

    assert report.status == "error"


def test_route_returns_200_when_healthy(settings):
    response = get_health(settings, HealthService([StaticCheck(redis=ok("fine"))]))

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": {"redis": {"status": "ok", "detail": "fine"}}}


def test_route_returns_503_with_details_when_degraded(settings):
    response = get_health(settings, HealthService([StaticCheck(redis=error("unreachable"), ffmpeg=ok("x"))]))

    assert response.status_code == 503
    assert response.json()["checks"]["redis"]["detail"] == "unreachable"


def test_app_registers_every_dependency_check(settings):
    with TestClient(create_app(settings)) as client:
        names = {type(c).__name__ for c in client.app.state.health._checks}

    assert names == {"ModelRuntimeCheck", "RedisCheck", "FfmpegCheck", "MediaRootCheck"}
