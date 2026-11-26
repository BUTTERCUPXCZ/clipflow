"""Planner model output and the plan itself (system-design §4.9). Validated with Pydantic before anything is kept."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

PLAN_SCHEMA_VERSION = "plan-v1"
CANDIDATES_PER_WINDOW = 3
COPY_BATCH = 5


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Candidate(_Strict):
    startSeconds: float = Field(ge=0)
    endSeconds: float = Field(gt=0)
    score: int = Field(ge=1, le=10)  # 10 = would stop someone scrolling
    reason: str = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def _ordered(self):
        if self.endSeconds <= self.startSeconds:
            raise ValueError("endSeconds must be greater than startSeconds")
        return self


class CandidateList(_Strict):
    # At least one: with an optional empty list, constrained decoding made qwen3-vl return [] on every window
    # (measured on a 11-min game cast). Weak moments get a low score and lose in ranking instead.
    candidates: list[Candidate] = Field(min_length=1, max_length=CANDIDATES_PER_WINDOW)


class ClipCopy(_Strict):
    index: int = Field(ge=0)
    title: str = Field(min_length=1, max_length=70)
    hook: str = Field(min_length=1, max_length=120)
    caption: str = Field(min_length=1, max_length=220)


class CopyList(_Strict):
    clips: list[ClipCopy] = Field(min_length=1, max_length=COPY_BATCH)


class PlanSettings(_Strict):
    minSeconds: int = Field(ge=5, le=180)
    maxSeconds: int = Field(ge=5, le=180)
    maxClips: int = Field(ge=1, le=20)

    @model_validator(mode="after")
    def _range(self):
        if self.maxSeconds < self.minSeconds:
            raise ValueError("maxSeconds must be at least minSeconds")
        return self


class PlannedClip(_Strict):
    startSeconds: float = Field(ge=0)
    endSeconds: float
    score: int = Field(ge=1, le=10)
    reason: str
    title: str
    hook: str
    caption: str
    cropMode: Literal["center"] = "center"


class EditingPlan(_Strict):
    """The validated result. Invariants against the video are checked here, so a plan object is always safe."""

    schemaVersion: Literal["plan-v1"] = PLAN_SCHEMA_VERSION
    model: str
    language: str
    durationSeconds: float = Field(gt=0)
    settings: PlanSettings
    clips: list[PlannedClip] = Field(min_length=1)
    skippedWindows: list[dict] = []
    metrics: dict = {}

    @model_validator(mode="after")
    def _clips_fit_the_video(self):
        ordered = sorted(self.clips, key=lambda c: c.startSeconds)
        for clip in ordered:
            length = clip.endSeconds - clip.startSeconds
            if clip.endSeconds > self.durationSeconds + 1e-6:
                raise ValueError(f"clip {clip.startSeconds}-{clip.endSeconds} ends after the video")
            if not self.settings.minSeconds - 1e-6 <= length <= self.settings.maxSeconds + 1e-6:
                raise ValueError(f"clip {clip.startSeconds}-{clip.endSeconds} is {length:.1f} s long")
        for a, b in zip(ordered, ordered[1:]):
            if b.startSeconds < a.endSeconds:
                raise ValueError(f"clips {a.startSeconds} and {b.startSeconds} overlap")
        return self
