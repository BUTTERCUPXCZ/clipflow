"""ClipPlanner: transcript + visual analysis → a validated EditingPlan (dict), or PlanFailure."""

import time
from collections.abc import Callable

from pydantic import ValidationError

from app.planning.graph import PlanGraph
from app.planning.llm import StructuredAsk, TextLlm
from app.planning.schemas import EditingPlan, PlanSettings


class PlanFailure(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ClipPlanner:
    def __init__(self, llm: TextLlm, model: str) -> None:
        self._llm = llm
        self._model = model

    def plan(
        self,
        transcript: dict | None,
        visual: dict | None,
        duration: float,
        settings: PlanSettings,
        on_progress: Callable[[float], None] = lambda _: None,
        should_cancel: Callable[[], bool] = lambda: False,
    ) -> dict:
        started = time.monotonic()
        state = PlanGraph(StructuredAsk(self._llm, self._model), on_progress, should_cancel).run(
            {
                "segments": (transcript or {}).get("segments", []),
                "scenes": (visual or {}).get("scenes", []),
                "language": (transcript or {}).get("language") or "en",
                "duration": duration,
                "settings": settings,
            }
        )
        if state.get("failure"):
            raise PlanFailure(*state["failure"])
        metrics = {
            "llmCalls": state["llm_calls"],
            "elapsedMs": round((time.monotonic() - started) * 1000),
            "windows": len(state["windows"]),
            "skippedWindows": len(state["skipped"]),
            "clipCount": len(state["clips"]),
        }
        try:
            plan = EditingPlan(
                model=self._model,
                language=state["language"],
                durationSeconds=duration,
                settings=settings,
                clips=state["clips"],
                skippedWindows=state["skipped"],
                metrics=metrics,
            )
        except ValidationError as exc:  # code bug guard: selection should never produce this
            raise PlanFailure("PLAN_INVALID", f"The plan failed validation: {exc.errors(include_url=False)[:2]}") from exc
        on_progress(1.0)
        return plan.model_dump()
