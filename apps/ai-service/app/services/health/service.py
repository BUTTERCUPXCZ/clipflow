import asyncio
from collections.abc import Sequence

from app.services.health.base import HealthCheck, HealthReport


class HealthService:
    """Runs every registered check concurrently. Add a dependency by registering a new HealthCheck."""

    def __init__(self, checks: Sequence[HealthCheck]) -> None:
        self._checks = checks

    async def report(self) -> HealthReport:
        results = await asyncio.gather(*(check.run() for check in self._checks))
        checks = {name: check for result in results for name, check in result.items()}
        healthy = all(c.status == "ok" for c in checks.values())
        return HealthReport(status="ok" if healthy else "error", checks=checks)
