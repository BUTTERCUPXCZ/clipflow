from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import structlog
import uvicorn
from fastapi import FastAPI

from app.api.routes import health
from app.config import Settings
from app.grpc_server import VideoAnalysisServicer, start_grpc_server
from app.logging_config import configure_logging

log = structlog.get_logger()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        # Must stay well under NestJS's 3 s gRPC deadline (per phase: connect + read), or a hung
        # Ollama surfaces as "AI service unreachable" instead of "Ollama unreachable".
        async with httpx.AsyncClient(base_url=settings.ollama_base_url, timeout=1.0) as ollama:
            app.state.ollama = ollama
            servicer = VideoAnalysisServicer(ollama, settings.vision_model)
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
