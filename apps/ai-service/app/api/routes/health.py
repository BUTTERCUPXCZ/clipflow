import asyncio
from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app.services import system_checks
from app.services.model_runtime import get_model_runtime_status
from app.services.system_checks import Check, error, ok

router = APIRouter()


class HealthResponse(BaseModel):
    status: Literal["ok", "error"]
    checks: dict[str, Check]


@router.get("/health")
async def health(request: Request, response: Response) -> HealthResponse:
    settings = request.app.state.settings
    runtime, redis_check = await asyncio.gather(
        get_model_runtime_status(request.app.state.ollama),
        system_checks.check_redis(settings.redis_url),
    )

    if not runtime.reachable:
        ollama_check = vision_check = error(f"Ollama unreachable: {runtime.error}")
    else:
        ollama_check = ok(f"{len(runtime.models)} models installed")
        vision_check = (
            ok(settings.vision_model)
            if runtime.has_model(settings.vision_model)
            else error(f"{settings.vision_model} is not installed (ollama pull {settings.vision_model})")
        )

    checks = {
        "ollama": ollama_check,
        "vision_model": vision_check,
        "redis": redis_check,
        "ffmpeg": system_checks.check_ffmpeg(),
        "media_root": system_checks.check_media_root(settings.media_root),
    }
    healthy = all(c.status == "ok" for c in checks.values())
    if not healthy:
        response.status_code = 503
    return HealthResponse(status="ok" if healthy else "error", checks=checks)
