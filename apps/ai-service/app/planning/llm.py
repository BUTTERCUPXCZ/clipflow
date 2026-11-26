"""One structured question to the local model, with a bounded retry (same rules as Phase 4 visual analysis)."""

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, ValidationError

RAW_LIMIT = 4000


class TextLlm(Protocol):
    """Satisfied by OllamaVisionClient: a text request is a chat with no images."""

    def chat(self, model: str, prompt: str, images: list[Path], schema: dict, max_tokens: int): ...


@dataclass
class Answer:
    value: BaseModel | None
    calls: int
    errors: list[str] = field(default_factory=list)
    raw: str = ""


class StructuredAsk:
    def __init__(self, llm: TextLlm, model: str, max_attempts: int = 2) -> None:
        self._llm = llm
        self._model = model
        self._max_attempts = max_attempts

    def ask(
        self,
        prompt: str,
        schema: type[BaseModel],
        max_tokens: int,
        check: Callable[[BaseModel], None] | None = None,
    ) -> Answer:
        """`check` raises ValueError for answers that are well-formed but wrong (e.g. times outside the window).
        ModelRuntimeUnavailable / ModelNotInstalled propagate: retrying cannot help."""
        errors: list[str] = []
        raw = ""
        for attempt in range(1, self._max_attempts + 1):
            correction = f"\nYour previous answer was invalid: {errors[-1]}. Fix it." if errors else ""
            try:
                reply = self._llm.chat(self._model, prompt + correction, [], schema.model_json_schema(), max_tokens)
                raw = reply.content
                value = schema.model_validate_json(raw)
                if check:
                    check(value)
                return Answer(value, attempt, errors)
            except ValidationError as exc:
                errors.append(f"schema: {exc.errors(include_url=False)[:3]}"[:500])
            except (TimeoutError, ValueError) as exc:
                errors.append(str(exc)[:500])
        return Answer(None, self._max_attempts, errors, raw[:RAW_LIMIT])
