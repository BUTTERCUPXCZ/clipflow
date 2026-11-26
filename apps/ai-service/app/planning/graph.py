"""The clip-planning workflow as a LangGraph state graph (system-design §9).

build_windows ─┬─(no speech)──────────────────────────────▶ END
               └▶ find_candidates ▶ select ─┬─(none)──────▶ END
                                            └▶ write_copy ▶ END

The state holds only small structured data (never media). Every model call goes through StructuredAsk, so the
number of calls is bounded: at most 2 per window plus 2 per copy batch."""

from collections.abc import Callable
from math import ceil
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.media.ffmpeg_runner import FfmpegCancelled
from app.planning import timeline
from app.planning.llm import StructuredAsk
from app.planning.prompts import candidates_prompt, copy_prompt
from app.planning.schemas import CANDIDATES_PER_WINDOW, COPY_BATCH, CandidateList, CopyList, PlanSettings

MIN_WORDS = 30
WINDOW_TOLERANCE = 5.0  # seconds a proposed moment may stray outside its window before it counts as invalid


class PlanState(TypedDict, total=False):
    segments: list[dict]
    scenes: list[dict]
    language: str
    duration: float
    settings: PlanSettings
    windows: list[timeline.Window]
    candidates: list[dict]
    selected: list[dict]
    clips: list[dict]
    skipped: list[dict]
    llm_calls: int
    failure: tuple[str, str] | None


class PlanGraph:
    def __init__(
        self,
        ask: StructuredAsk,
        on_progress: Callable[[float], None] = lambda _: None,
        should_cancel: Callable[[], bool] = lambda: False,
    ) -> None:
        self._ask = ask
        self._progress = on_progress
        self._should_cancel = should_cancel
        builder = StateGraph(PlanState)
        builder.add_node("build_windows", self.build_windows)
        builder.add_node("find_candidates", self.find_candidates)
        builder.add_node("select", self.select)
        builder.add_node("write_copy", self.write_copy)
        builder.add_edge(START, "build_windows")
        builder.add_conditional_edges("build_windows", self._continue, {"next": "find_candidates", "stop": END})
        builder.add_edge("find_candidates", "select")
        builder.add_conditional_edges("select", self._continue, {"next": "write_copy", "stop": END})
        builder.add_edge("write_copy", END)
        self._graph = builder.compile()

    def run(self, state: PlanState) -> PlanState:
        return self._graph.invoke({"skipped": [], "llm_calls": 0, "failure": None, **state})

    @staticmethod
    def _continue(state: PlanState) -> str:
        return "stop" if state.get("failure") else "next"

    def _check_cancel(self) -> None:
        if self._should_cancel():
            raise FfmpegCancelled()

    # --- nodes ---

    def build_windows(self, state: PlanState) -> dict:
        segments = timeline.spoken(timeline.units(state["segments"]))
        if timeline.word_count(segments) < MIN_WORDS:
            return {"failure": ("NO_SPEECH", "Clip planning needs speech: this video has too little transcribed speech.")}
        self._progress(0.05)
        return {"segments": segments, "windows": timeline.windows(segments, state["scenes"])}

    def find_candidates(self, state: PlanState) -> dict:
        s: PlanSettings = state["settings"]
        found: list[dict] = []
        skipped = list(state["skipped"])
        calls = state["llm_calls"]
        for done, window in enumerate(state["windows"], start=1):
            self._check_cancel()

            def inside(answer: CandidateList, w=window) -> None:
                for c in answer.candidates:
                    if c.startSeconds < w.start - WINDOW_TOLERANCE or c.endSeconds > w.end + WINDOW_TOLERANCE:
                        raise ValueError(f"moment {c.startSeconds}-{c.endSeconds} is outside {w.start:.1f}-{w.end:.1f}")

            answer = self._ask.ask(
                candidates_prompt(window, s.minSeconds, s.maxSeconds), CandidateList,
                max_tokens=120 * CANDIDATES_PER_WINDOW + 60, check=inside,
            )
            calls += answer.calls
            if answer.value is None:
                skipped.append({"start": window.start, "end": window.end, "errors": answer.errors, "raw": answer.raw})
            else:
                found += [c.model_dump() for c in answer.value.candidates]
            self._progress(0.05 + 0.75 * done / len(state["windows"]))
        return {"candidates": found, "skipped": skipped, "llm_calls": calls}

    def select(self, state: PlanState) -> dict:
        s: PlanSettings = state["settings"]
        segments, duration = state["segments"], state["duration"]
        fitted = []
        for c in state["candidates"]:
            snapped = timeline.snap(c["startSeconds"], c["endSeconds"], segments, duration)
            if snapped:
                snapped = timeline.fit_length(*snapped, segments, duration, s.minSeconds, s.maxSeconds)
            if snapped:
                # Clamp after rounding: ffprobe durations have more decimals, and 2-decimal rounding of a clip that
                # ends with the video could otherwise land just past it and fail validation of the whole plan.
                start, end = round(snapped[0], 2), min(round(snapped[1], 2), duration)
                fitted.append(c | {"startSeconds": start, "endSeconds": end})
        selected = timeline.resolve_overlaps(fitted, s.maxClips)
        self._progress(0.85)
        if not selected:
            reason = "the model found no usable moment" if not state["skipped"] else "no part of the video gave a valid answer"
            return {"selected": [], "failure": ("PLAN_INVALID", f"No clip could be planned: {reason}.")}
        for clip in selected:
            clip["excerpt"] = timeline.excerpt(segments, clip["startSeconds"], clip["endSeconds"])
        return {"selected": selected}

    def write_copy(self, state: PlanState) -> dict:
        selected = state["selected"]
        calls = state["llm_calls"]
        clips: list[dict] = []
        skipped = list(state["skipped"])
        batches = [selected[i : i + COPY_BATCH] for i in range(0, len(selected), COPY_BATCH)]
        for done, batch in enumerate(batches, start=1):
            self._check_cancel()

            def complete(answer: CopyList, n=len(batch)) -> None:
                missing = set(range(n)) - {c.index for c in answer.clips}
                if missing:
                    raise ValueError(f"no copy for clip index {sorted(missing)}")

            answer = self._ask.ask(copy_prompt(batch, state["language"]), CopyList, 250 * len(batch) + 60, complete)
            calls += answer.calls
            if answer.value is None:  # clips without copy are dropped, not shipped half-written
                skipped.append({"start": batch[0]["startSeconds"], "end": batch[-1]["endSeconds"],
                                "errors": answer.errors, "raw": answer.raw})
            else:
                by_index = {c.index: c for c in answer.value.clips}
                for i, clip in enumerate(batch):
                    copy = by_index[i]
                    clips.append({k: clip[k] for k in ("startSeconds", "endSeconds", "score", "reason")}
                                 | {"title": copy.title, "hook": copy.hook, "caption": copy.caption})
            self._progress(0.85 + 0.13 * done / len(batches))
        failure = None if clips else ("PLAN_INVALID", "No clip could be planned: the titles and captions were invalid.")
        return {"clips": clips, "skipped": skipped, "llm_calls": calls, "failure": failure}


def max_llm_calls(windows: int, clips: int, attempts: int = 2) -> int:
    return attempts * windows + attempts * ceil(clips / COPY_BATCH)
