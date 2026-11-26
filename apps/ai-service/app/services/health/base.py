from typing import Literal, Protocol

from pydantic import BaseModel


class Check(BaseModel):
    status: Literal["ok", "error"]
    detail: str


class HealthReport(BaseModel):
    status: Literal["ok", "error"]
    checks: dict[str, Check]

    @property
    def healthy(self) -> bool:
        return self.status == "ok"


def ok(detail: str) -> Check:
    return Check(status="ok", detail=detail)


def error(detail: str) -> Check:
    return Check(status="error", detail=detail)


class HealthCheck(Protocol):
    """One dependency probe. Returns named results (one probe may report several, e.g. runtime + model).

    Must not raise: every failure is reported as an error Check.
    """

    async def run(self) -> dict[str, Check]: ...
