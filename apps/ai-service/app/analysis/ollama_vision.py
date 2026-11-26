"""Ollama /api/chat for vision requests. The only place that talks to the model runtime for inference."""

import base64
from dataclasses import dataclass
from pathlib import Path

import httpx


class ModelRuntimeUnavailable(RuntimeError):
    """Ollama is not running or not reachable."""


class ModelNotInstalled(RuntimeError):
    def __init__(self, model: str) -> None:
        super().__init__(f"{model} is not installed. Run: ollama pull {model}")
        self.model = model


@dataclass(frozen=True)
class VisionReply:
    content: str
    load_ms: float
    inference_ms: float


# Measured with qwen3-vl: Ollama resizes every image to a fixed size, about 1,050 tokens whatever the frame width.
# shortcut: per-model constant, measure again (prompt_eval_count) when another vision model becomes the default.
TOKENS_PER_IMAGE = 1100
PROMPT_TOKENS = 256


CHARS_PER_TOKEN = 3  # conservative for ASCII text
TEXT_ONLY_MIN_CONTEXT = 4096  # Ollama's own default: text calls never get less


def prompt_tokens(prompt: str) -> int:
    """Upper-bound estimate: ASCII at ~3 chars per token; every other character (CJK, Cyrillic, Arabic, accents)
    counted as a whole token, so non-Latin transcripts are never truncated by a too-small context."""
    ascii_chars = sum(1 for ch in prompt if ord(ch) < 128)
    return ascii_chars // CHARS_PER_TOKEN + (len(prompt) - ascii_chars)


def context_size(images: int, max_tokens: int, prompt: str = "") -> int:
    """Smallest context (whole KiB of tokens) that fits the request: a bigger one costs VRAM and pushes layers
    to the CPU; Ollama's default 4096 is too small for 4 frames or a long transcript window."""
    needed = images * TOKENS_PER_IMAGE + PROMPT_TOKENS + prompt_tokens(prompt) + max_tokens
    if not images:
        needed = max(needed, TEXT_ONLY_MIN_CONTEXT)
    return -(-needed // 1024) * 1024


class OllamaVisionClient:
    def __init__(self, base_url: str, timeout: float = 300.0, keep_alive: str = "5m", transport=None) -> None:
        self._client = httpx.Client(base_url=base_url, timeout=timeout, transport=transport)
        self._keep_alive = keep_alive

    def chat(self, model: str, prompt: str, images: list[Path], schema: dict, max_tokens: int) -> VisionReply:
        payload = {
            "model": model,
            "stream": False,
            "format": schema,
            "keep_alive": self._keep_alive,
            # temperature 0: same frames → same answer, which evals and experiments rely on.
            "options": {"temperature": 0, "num_predict": max_tokens, "num_ctx": context_size(len(images), max_tokens, prompt)},
            "messages": [
                {"role": "user", "content": prompt, "images": [base64.b64encode(p.read_bytes()).decode() for p in images]}
            ],
        }
        try:
            response = self._client.post("/api/chat", json=payload)
        except httpx.TimeoutException as exc:
            raise TimeoutError(f"the model did not answer within {self._client.timeout.read:.0f} s") from exc
        except httpx.TransportError as exc:
            raise ModelRuntimeUnavailable("Ollama is not running. Start it and process again.") from exc
        if response.status_code == 404:
            raise ModelNotInstalled(model)
        if response.status_code >= 500:
            raise ModelRuntimeUnavailable(f"Ollama failed ({response.status_code}): {response.text[:300]}")
        if response.status_code >= 400:
            raise RuntimeError(f"Ollama error {response.status_code}: {response.text[:300]}")
        try:
            body = response.json()
        except ValueError as exc:
            raise ValueError(f"Ollama sent a reply that is not JSON: {response.text[:200]}") from exc
        return VisionReply(
            content=body.get("message", {}).get("content", ""),
            load_ms=body.get("load_duration", 0) / 1e6,
            inference_ms=(body.get("total_duration", 0) - body.get("load_duration", 0)) / 1e6,
        )

    def close(self) -> None:
        self._client.close()
