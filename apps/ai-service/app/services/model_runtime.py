"""Ollama runtime status. Shared by the HTTP health check and the gRPC GetModelStatus."""

from dataclasses import dataclass, field

import httpx


@dataclass(frozen=True)
class InstalledModel:
    name: str
    size_bytes: int


@dataclass(frozen=True)
class ModelRuntimeStatus:
    reachable: bool
    models: list[InstalledModel] = field(default_factory=list)
    error: str | None = None

    def has_model(self, name: str) -> bool:
        # Ollama treats an untagged name as ":latest".
        wanted = name if ":" in name else f"{name}:latest"
        return any(m.name == wanted for m in self.models)


async def get_model_runtime_status(client: httpx.AsyncClient) -> ModelRuntimeStatus:
    """`client` must have base_url set to the Ollama server."""
    try:
        response = await client.get("/api/tags")
        response.raise_for_status()
        models = [
            InstalledModel(name=m["name"], size_bytes=int(m.get("size", 0)))
            for m in response.json().get("models", [])
        ]
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        return ModelRuntimeStatus(reachable=False, error=str(exc) or type(exc).__name__)
    return ModelRuntimeStatus(reachable=True, models=models)
