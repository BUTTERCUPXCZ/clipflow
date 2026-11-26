"""Local model runtime (Ollama). Shared by the health checks and the gRPC GetModelStatus."""

from dataclasses import dataclass, field
from typing import Protocol

import httpx


@dataclass(frozen=True)
class InstalledModel:
    name: str
    size_bytes: int
    vision: bool = False  # Ollama capability "vision": accepts images


@dataclass(frozen=True)
class ModelRuntimeStatus:
    reachable: bool
    models: list[InstalledModel] = field(default_factory=list)
    error: str | None = None

    def has_model(self, name: str) -> bool:
        # Ollama treats an untagged name as ":latest".
        wanted = name if ":" in name else f"{name}:latest"
        return any(m.name == wanted for m in self.models)


class ModelRuntime(Protocol):
    """What consumers need from a model runtime; swap Ollama for another runtime behind this."""

    async def status(self) -> ModelRuntimeStatus: ...


class OllamaRuntime:
    def __init__(self, client: httpx.AsyncClient) -> None:
        """`client` must have base_url set to the Ollama server."""
        self._client = client

    async def status(self) -> ModelRuntimeStatus:
        try:
            response = await self._client.get("/api/tags")
            response.raise_for_status()
            models = [
                InstalledModel(name=m["name"], size_bytes=int(m.get("size", 0)))
                for m in response.json().get("models", [])
            ]
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            return ModelRuntimeStatus(reachable=False, error=str(exc) or type(exc).__name__)
        return ModelRuntimeStatus(reachable=True, models=[await self._with_capabilities(m) for m in models])

    async def _with_capabilities(self, model: InstalledModel) -> InstalledModel:
        try:
            response = await self._client.post("/api/show", json={"model": model.name})
            response.raise_for_status()
            capabilities = response.json().get("capabilities") or []
        except (httpx.HTTPError, ValueError):
            return model  # unknown capabilities: treat as not vision-capable
        return InstalledModel(model.name, model.size_bytes, vision="vision" in capabilities)
