"""Rendering (system-design §4.11–4.13) as queued work: every kept clip of a plan, in order. A clip that fails is
recorded and the others continue; the render fails only if no clip succeeds."""

import json
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from app.jobs.pipeline import ProgressReporter
from app.media.ffmpeg_runner import FfmpegCancelled, FfmpegError, scrub
from app.media.media_paths import MediaPaths, PathEscapeError
from app.media.prober import MediaProber
from app.rendering.renderer import ClipRenderer, ClipSpec, RenderVerificationError, SourceInfo

OUTPUT_FILE = "render.json"


@dataclass(frozen=True)
class RenderRequest:
    render_id: str
    source_path: str  # the original video, relative to MEDIA_ROOT
    output_path: str  # this render's directory, relative, under analysis/
    subtitles: bool
    clips: list[ClipSpec]


class RenderEvents(Protocol):
    def render_progress(self, render_id: str, progress: int, message: str = "") -> bool: ...
    def render_completed(self, render_id: str, output_path: str, metrics: dict) -> bool: ...
    def render_failed(self, render_id: str, code: str, message: str) -> None: ...


class RenderRunner:
    def __init__(
        self,
        paths: MediaPaths,
        prober: MediaProber,
        renderer: ClipRenderer,
        events: RenderEvents,
        is_cancel_requested: Callable[[str], bool],
    ) -> None:
        self._paths = paths
        self._prober = prober
        self._renderer = renderer
        self._events = events
        self._is_cancel_requested = is_cancel_requested

    def run(self, request: RenderRequest) -> None:
        """Never raises; failures report an event and leave no output behind."""
        output_dir = None
        failure: tuple[str, str] | None = None
        try:
            source = self._paths.resolve(request.source_path)
            output_dir = self._paths.resolve_artifacts(request.output_path)
            failure = self._run(request, source, output_dir)
        except FfmpegCancelled:
            failure = ("CANCELLED", "Cancelled by the user")
        except (PathEscapeError, FileNotFoundError) as exc:
            failure = ("INTERNAL", f"The source video is not available: {scrub(str(exc), self._paths.root)}")
        except Exception as exc:  # noqa: BLE001 — report every unexpected error instead of hanging the render
            failure = ("INTERNAL", f"Unexpected error: {scrub(str(exc), self._paths.root)}")
        if failure:
            if output_dir is not None:
                shutil.rmtree(output_dir, ignore_errors=True)
            self._events.render_failed(request.render_id, *failure)

    def _run(self, request: RenderRequest, source_file, output_dir) -> tuple[str, str] | None:
        stop = {"requested": False}

        def report(percent: int) -> None:
            if self._events.render_progress(request.render_id, percent):
                stop["requested"] = True

        def should_cancel() -> bool:
            return stop["requested"] or self._is_cancel_requested(request.render_id)

        probe = self._prober.probe(source_file)
        if not probe.decodable:
            return ("INTERNAL", f"The source video cannot be read: {probe.error}")
        source = SourceInfo(source_file, probe.has_audio, probe.frame_rate)
        reporter = ProgressReporter(report)
        reporter.report(0, force=True)
        started = time.monotonic()
        shutil.rmtree(output_dir, ignore_errors=True)
        output_dir.mkdir(parents=True)
        rendered, failures = [], []
        total = len(request.clips)
        for i, clip in enumerate(request.clips):
            if should_cancel():
                raise FfmpegCancelled()
            try:
                result = self._renderer.render(
                    source, clip, output_dir, subtitles=request.subtitles,
                    on_progress=reporter.band(99 * i // total, 99 * (i + 1) // total), should_cancel=should_cancel,
                )
                rendered.append(result | {"file": self._paths.relative(result["file"]),
                                          "thumbnail": self._paths.relative(result["thumbnail"])})
            except (FfmpegError, RenderVerificationError, ValueError, OSError) as exc:
                failures.append({"clipId": clip.clip_id, "error": scrub(str(exc), self._paths.root, source_file)})
        if not rendered:
            return ("RENDER_FAILED", f"No clip could be rendered: {failures[0]['error']}" if failures else "No clips")
        metrics = {
            "rendered": len(rendered),
            "failed": len(failures),
            "elapsedMs": round((time.monotonic() - started) * 1000),
            "encoder": self._renderer.encoder.name,
        }
        output = output_dir / OUTPUT_FILE
        output.write_text(json.dumps({"clips": rendered, "failures": failures, "metrics": metrics}))
        if self._events.render_completed(request.render_id, self._paths.relative(output), metrics):
            shutil.rmtree(output_dir, ignore_errors=True)  # refused: deleted or cancelled meanwhile
        return None
