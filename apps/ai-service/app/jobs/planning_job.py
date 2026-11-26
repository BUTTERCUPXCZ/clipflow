"""Clip planning (system-design §4.7–4.10) as queued work: reads a completed job's transcript.json and visual.json,
runs ClipPlanner, writes plan.json, reports. Same event and cleanup rules as experiments."""

import json
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from app.analysis.ollama_vision import ModelNotInstalled, ModelRuntimeUnavailable
from app.jobs.pipeline import ProgressReporter
from app.media.ffmpeg_runner import FfmpegCancelled, scrub
from app.media.media_paths import MediaPaths, PathEscapeError
from app.planning.planner import ClipPlanner, PlanFailure
from app.planning.schemas import PlanSettings

OUTPUT_FILE = "plan.json"


@dataclass(frozen=True)
class PlanRequest:
    plan_id: str
    transcript_path: str  # relative, under analysis/
    visual_path: str  # relative, under analysis/
    output_path: str  # this plan's directory, relative, under analysis/
    duration_seconds: float
    settings: PlanSettings


class PlanEvents(Protocol):
    def plan_progress(self, plan_id: str, progress: int, message: str = "") -> bool: ...
    def plan_completed(self, plan_id: str, output_path: str, metrics: dict) -> bool: ...
    def plan_failed(self, plan_id: str, code: str, message: str) -> None: ...


class PlanRunner:
    def __init__(
        self,
        paths: MediaPaths,
        planner: ClipPlanner,
        events: PlanEvents,
        is_cancel_requested: Callable[[str], bool],
    ) -> None:
        self._paths = paths
        self._planner = planner
        self._events = events
        self._is_cancel_requested = is_cancel_requested

    def run(self, request: PlanRequest) -> None:
        """Never raises; failures report an event and leave no output behind."""
        output_dir = None
        failure: tuple[str, str] | None = None
        try:
            transcript = self._paths.resolve_artifacts(request.transcript_path)
            visual = self._paths.resolve_artifacts(request.visual_path)
            output_dir = self._paths.resolve_artifacts(request.output_path)
            self._run(request, transcript, visual, output_dir)
        except FfmpegCancelled:
            failure = ("CANCELLED", "Cancelled by the user")
        except PlanFailure as exc:
            failure = (exc.code, str(exc))
        except ModelRuntimeUnavailable as exc:
            failure = ("MODEL_RUNTIME_UNAVAILABLE", str(exc))
        except ModelNotInstalled as exc:
            failure = ("MODEL_NOT_INSTALLED", str(exc))
        except (PathEscapeError, FileNotFoundError) as exc:
            failure = ("INTERNAL", f"The analysis is not available: {scrub(str(exc), self._paths.root)}")
        except Exception as exc:  # noqa: BLE001 — report every unexpected error instead of hanging the plan
            failure = ("INTERNAL", f"Unexpected error: {scrub(str(exc), self._paths.root)}")
        if failure:
            if output_dir is not None:
                shutil.rmtree(output_dir, ignore_errors=True)
            self._events.plan_failed(request.plan_id, *failure)

    def _run(self, request: PlanRequest, transcript_file, visual_file, output_dir) -> None:
        stop = {"requested": False}

        def report(percent: int) -> None:
            if self._events.plan_progress(request.plan_id, percent):
                stop["requested"] = True

        def should_cancel() -> bool:
            return stop["requested"] or self._is_cancel_requested(request.plan_id)

        transcript = json.loads(transcript_file.read_text())
        visual = json.loads(visual_file.read_text()) if visual_file.exists() else None
        reporter = ProgressReporter(report)
        reporter.report(0, force=True)
        plan = self._planner.plan(
            transcript, visual, request.duration_seconds, request.settings,
            on_progress=reporter.band(0, 99), should_cancel=should_cancel,
        )
        shutil.rmtree(output_dir, ignore_errors=True)
        output_dir.mkdir(parents=True)
        output = output_dir / OUTPUT_FILE
        output.write_text(json.dumps(plan))
        if self._events.plan_completed(request.plan_id, self._paths.relative(output), plan["metrics"]):
            shutil.rmtree(output_dir, ignore_errors=True)  # refused: deleted or cancelled meanwhile
