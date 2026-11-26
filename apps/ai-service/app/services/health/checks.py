"""Health checks for the local infrastructure the AI service depends on. One class per dependency."""

import os
import shutil
from collections.abc import Callable
from pathlib import Path

import redis.asyncio as redis

from app.services.health.base import Check, error, ok
from app.services.model_runtime import ModelRuntime


class ModelRuntimeCheck:
    def __init__(self, runtime: ModelRuntime, vision_model: str) -> None:
        self._runtime = runtime
        self._vision_model = vision_model

    async def run(self) -> dict[str, Check]:
        status = await self._runtime.status()
        if not status.reachable:
            down = error(f"Ollama unreachable: {status.error}")
            return {"ollama": down, "vision_model": down}

        model = self._vision_model
        vision = ok(model) if status.has_model(model) else error(f"{model} is not installed (ollama pull {model})")
        return {"ollama": ok(f"{len(status.models)} models installed"), "vision_model": vision}


class RedisCheck:
    def __init__(self, url: str) -> None:
        self._url = url

    async def run(self) -> dict[str, Check]:
        return {"redis": await self._probe()}

    async def _probe(self) -> Check:
        client = redis.from_url(self._url, socket_timeout=2, socket_connect_timeout=2, decode_responses=True)
        try:
            await client.ping()
            appendonly = (await client.config_get("appendonly")).get("appendonly")
        except redis.RedisError as exc:
            return error(f"unreachable: {exc}")
        finally:
            await client.aclose()
        if appendonly != "yes":
            return error("appendonly is off; queued jobs would not survive a Redis restart")
        return ok("reachable, appendonly=yes")


class FfmpegCheck:
    BINARIES = ("ffmpeg", "ffprobe")

    def __init__(self, which: Callable[[str], str | None] = shutil.which) -> None:
        self._which = which

    async def run(self) -> dict[str, Check]:
        missing = [b for b in self.BINARIES if self._which(b) is None]
        if missing:
            return {"ffmpeg": error(f"not found on PATH: {', '.join(missing)}")}
        return {"ffmpeg": ok(self._which("ffmpeg") or "ffmpeg")}


class MediaRootCheck:
    def __init__(self, path: Path) -> None:
        self._path = path

    async def run(self) -> dict[str, Check]:
        return {"media_root": self._probe()}

    def _probe(self) -> Check:
        try:
            self._path.mkdir(parents=True, exist_ok=True, mode=0o700)
        except OSError as exc:
            return error(f"cannot create {self._path}: {exc}")
        if not os.access(self._path, os.W_OK):
            return error(f"not writable: {self._path}")
        return ok(str(self._path))
