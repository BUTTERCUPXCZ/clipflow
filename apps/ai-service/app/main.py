from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx
import structlog
import uvicorn
from fastapi import FastAPI
from redis import Redis

from app.api.routes import health
from app.config import Settings
from app.grpc_server import VideoAnalysisServicer, start_grpc_server
from app.jobs.events import JobEventsClient
from app.jobs.queue import CancellationFlags, JobQueue
from app.logging_config import configure_logging
from app.media.ffmpeg_runner import FfmpegRunner
from app.media.media_paths import MediaPaths
from app.media.prober import MediaProber
from app.services.health import FfmpegCheck, HealthService, MediaRootCheck, ModelRuntimeCheck, RedisCheck, WorkerCheck
from app.services.model_runtime import ModelRuntime, OllamaRuntime

log = structlog.get_logger()


def build_queue(settings: Settings, redis: Redis) -> JobQueue:
    return JobQueue(redis, CancellationFlags(redis), JobEventsClient(settings.job_events_grpc_url, redis))


def build_health_service(settings: Settings, runtime: ModelRuntime, queue: JobQueue) -> HealthService:
    """Composition root for /health: register one check per dependency."""
    return HealthService(
        [
            ModelRuntimeCheck(runtime, settings.vision_model),
            RedisCheck(settings.redis_url),
            WorkerCheck(queue.workers_running),
            FfmpegCheck(),
            MediaRootCheck(settings.media_root),
        ]
    )


def build_servicer(settings: Settings, runtime: ModelRuntime, queue: JobQueue) -> VideoAnalysisServicer:
    """Composition root for gRPC: media probing plus the RQ job queue."""
    return VideoAnalysisServicer(
        runtime,
        settings.vision_model,
        paths=MediaPaths(settings.media_root),
        prober=MediaProber(FfmpegRunner()),
        queue=queue,
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
            redis = Redis.from_url(settings.redis_url)
            queue = build_queue(settings, redis)
            app.state.health = build_health_service(settings, runtime, queue)
            servicer = build_servicer(settings, runtime, queue)
            grpc_server, grpc_port = await start_grpc_server(servicer, settings.ai_grpc_port)
            app.state.grpc_port = grpc_port
            log.info("ai_service_started", http_port=settings.ai_http_port, grpc_port=grpc_port)
            try:
                yield
            finally:
                await grpc_server.stop(grace=5)
                redis.close()
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
