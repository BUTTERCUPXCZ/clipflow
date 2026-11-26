"""Model experiments (system-design §10): visual analysis of a completed job's frames with a chosen model.
Same VisualAnalyzer, same frames.json, same frame budget as processing — only the model and settings vary."""

import json
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from app.analysis.frame_budget import select_evenly
from app.analysis.ollama_vision import ModelNotInstalled, ModelRuntimeUnavailable
from app.analysis.visual_analyzer import VisualAnalyzer
from app.analysis.vram import VramSampler
from app.jobs.pipeline import ProgressReporter
from app.media.extractors import FRAMES_INDEX
from app.media.ffmpeg_runner import FfmpegCancelled, scrub
from app.media.media_paths import MediaPaths, PathEscapeError

OUTPUT_FILE = "visual.json"


@dataclass(frozen=True)
class ExperimentRequest:
    experiment_id: str
    frames_path: str  # a completed job's frames directory, relative to MEDIA_ROOT
    output_path: str  # this experiment's directory, relative, under analysis/
    model: str
    max_frames: int
    batch_size: int


class ExperimentEvents(Protocol):
    def experiment_progress(self, experiment_id: str, progress: int, message: str = "") -> bool: ...
    def experiment_completed(self, experiment_id: str, output_path: str, metrics: dict) -> bool: ...
    def experiment_failed(self, experiment_id: str, code: str, message: str) -> None: ...


class ExperimentRunner:
    def __init__(
        self,
        paths: MediaPaths,
        analyzer: VisualAnalyzer,
        events: ExperimentEvents,
        is_cancel_requested: Callable[[str], bool],
        sampler_factory: Callable[[], VramSampler] = VramSampler,
    ) -> None:
        self._paths = paths
        self._analyzer = analyzer
        self._events = events
        self._is_cancel_requested = is_cancel_requested
        self._sampler_factory = sampler_factory

    def run(self, request: ExperimentRequest) -> None:
        """Never raises; failures report an event and leave no output behind."""
        output_dir = None
        failure: tuple[str, str] | None = None
        try:
            frames_dir = self._paths.resolve_artifacts(request.frames_path)
            output_dir = self._paths.resolve_artifacts(request.output_path)
            self._run(request, frames_dir, output_dir)
        except FfmpegCancelled:
            failure = ("CANCELLED", "Cancelled by the user")
        except ModelRuntimeUnavailable as exc:
            failure = ("MODEL_RUNTIME_UNAVAILABLE", str(exc))
        except ModelNotInstalled as exc:
            failure = ("MODEL_NOT_INSTALLED", str(exc))
        except (PathEscapeError, FileNotFoundError) as exc:
            failure = ("INTERNAL", f"Frames are not available: {scrub(str(exc), self._paths.root)}")
        except Exception as exc:  # noqa: BLE001
            failure = ("INTERNAL", f"Unexpected error: {scrub(str(exc), self._paths.root)}")
        if failure:
            if output_dir is not None:
                shutil.rmtree(output_dir, ignore_errors=True)
            self._events.experiment_failed(request.experiment_id, *failure)

    def _run(self, request: ExperimentRequest, frames_dir, output_dir) -> None:
        stop = {"requested": False}

        def report(percent: int) -> None:
            if self._events.experiment_progress(request.experiment_id, percent):
                stop["requested"] = True

        def should_cancel() -> bool:
            return stop["requested"] or self._is_cancel_requested(request.experiment_id)

        frames = json.loads((frames_dir / FRAMES_INDEX).read_text())
        chosen = select_evenly(frames, request.max_frames)
        reporter = ProgressReporter(report)
        reporter.report(0, force=True)
        started = time.monotonic()
        with self._sampler_factory() as vram:
            result = self._analyzer.analyze(
                frames_dir, chosen, model=request.model, batch_size=request.batch_size,
                on_progress=reporter.band(0, 99), should_cancel=should_cancel,
            )
        metrics = result["metrics"] | {
            "totalMs": round((time.monotonic() - started) * 1000),
            "peakVramMiB": vram.peak_mib,
        }
        result["metrics"] = metrics
        shutil.rmtree(output_dir, ignore_errors=True)
        output_dir.mkdir(parents=True)
        output = output_dir / OUTPUT_FILE
        output.write_text(json.dumps(result))
        # Unlike a job, an experiment with zero valid batches still "completes": its validity IS the result.
        if self._events.experiment_completed(request.experiment_id, self._paths.relative(output), metrics):
            shutil.rmtree(output_dir, ignore_errors=True)  # refused: deleted or cancelled meanwhile
