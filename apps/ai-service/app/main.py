from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx
import structlog
import uvicorn
from fastapi import FastAPI

from app.api.routes import health
from app.config import Settings
from app.grpc_server import VideoAnalysisServicer, start_grpc_server
from app.logging_config import configure_logging
from app.services.health import FfmpegCheck, HealthService, MediaRootCheck, ModelRuntimeCheck, RedisCheck
from app.services.model_runtime import ModelRuntime, OllamaRuntime

log = structlog.get_logger()


def build_health_service(settings: Settings, runtime: ModelRuntime) -> HealthService:
    """Composition root for /health: register one check per dependency."""
    return HealthService(
        [
            ModelRuntimeCheck(runtime, settings.vision_model),
            RedisCheck(settings.redis_url),
            FfmpegCheck(),
            MediaRootCheck(settings.media_root),
        ]
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        app.state.settings = settings
        # Must stay well under NestJS's 3 s gRPC deadline (per phase: connect + read), or a hung
        # Ollama surfaces as "AI service unreachable" instead of "Ollama unreachable".
        async with httpx.AsyncClient(base_url=settings.ollama_base_url, timeout=1.0) as ollama:
            runtime = OllamaRuntime(ollama)
            app.state.health = build_health_service(settings, runtime)
            servicer = VideoAnalysisServicer(runtime, settings.vision_model)
            grpc_server, grpc_port = await start_grpc_server(servicer, settings.ai_grpc_port)
            app.state.grpc_port = grpc_port
            log.info("ai_service_started", http_port=settings.ai_http_port, grpc_port=grpc_port)
            try:
                yield
            finally:
                await grpc_server.stop(grace=5)
                log.info("ai_service_stopped")

    app = FastAPI(title="ClipForge AI Service", lifespan=lifespan)
    app.include_router(health.router)
    return app


def main() -> None:
    configure_logging()
    settings = Settings()
    uvicorn.run(create_app(settings), host="127.0.0.1", port=settings.ai_http_port, log_config=None)


if __name__ == "__main__":
    main()
