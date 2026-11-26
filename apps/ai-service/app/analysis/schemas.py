"""Structured model output (system-design §4.6). The JSON schema below is also sent to Ollama as `format`,
so the model is constrained while generating, and every response is validated again here."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

DESCRIPTION_MAX = 200
PROMPT_VERSION = "visual-v2"  # v2: explicit description length; capped text trimmed to a whole sentence

CameraFraming = Literal["extreme-close-up", "close-up", "medium", "wide", "extreme-wide", "screen-capture", "other"]


Item = Annotated[str, Field(min_length=1, max_length=80)]  # caps the 8B model's output per list entry


class SceneObservation(BaseModel):
    """One analysed frame. Lengths are capped: without limits the 8B model wrote ~3,000 tokens per frame."""

    model_config = ConfigDict(extra="forbid")

    timestampSeconds: float = Field(ge=0)  # noqa: N815 (JSON field name)
    description: str = Field(min_length=1, max_length=DESCRIPTION_MAX)
    subjects: list[Item] = Field(max_length=5)
    actions: list[Item] = Field(max_length=3)
    cameraFraming: CameraFraming  # noqa: N815
    verticalCropSuitable: bool  # noqa: N815
    observations: list[Item] = Field(max_length=3)


class BatchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenes: list[SceneObservation] = Field(min_length=1)


def batch_schema() -> dict:
    return BatchResult.model_json_schema()
