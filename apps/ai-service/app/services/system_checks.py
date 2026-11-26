"""Health checks for local infrastructure the AI service depends on."""

import os
import shutil
from pathlib import Path
from typing import Literal

import redis.asyncio as redis
from pydantic import BaseModel


class Check(BaseModel):
    status: Literal["ok", "error"]
    detail: str


def ok(detail: str) -> Check:
    return Check(status="ok", detail=detail)


def error(detail: str) -> Check:
    return Check(status="error", detail=detail)


async def check_redis(url: str) -> Check:
    client = redis.from_url(url, socket_timeout=2, socket_connect_timeout=2, decode_responses=True)
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


def check_ffmpeg() -> Check:
    missing = [b for b in ("ffmpeg", "ffprobe") if shutil.which(b) is None]
    if missing:
        return error(f"not found on PATH: {', '.join(missing)}")
    return ok(shutil.which("ffmpeg") or "ffmpeg")


def check_media_root(path: Path) -> Check:
    try:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    except OSError as exc:
        return error(f"cannot create {path}: {exc}")
    if not os.access(path, os.W_OK):
        return error(f"not writable: {path}")
    return ok(str(path))
