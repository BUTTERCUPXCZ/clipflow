"""Processing: VALIDATING → EXTRACTING_MEDIA → TRANSCRIBING → ANALYZING_VISUALS → COMPLETED (system-design §5.2)."""

import json
import shutil
import time
import wave
from collections.abc import Callable
from dataclasses import dataclass

from app.analysis.frame_budget import select_evenly
from app.analysis.ollama_vision import ModelNotInstalled, ModelRuntimeUnavailable
from app.analysis.transcriber import TranscriptionError, Transcriber
from app.analysis.visual_analyzer import VisualAnalyzer
from app.jobs.events import EventSink
from app.media.extractors import AudioExtractor, FrameExtractor
from app.media.ffmpeg_runner import FfmpegCancelled, FfmpegError, scrub
from app.media.media_paths import MediaPaths, PathEscapeError
from app.media.prober import MediaProber

AUDIO_FILE = "audio.wav"
FRAMES_DIR = "frames"
TRANSCRIPT_FILE = "transcript.json"
VISUAL_FILE = "visual.json"


@dataclass(frozen=True)
class JobRequest:
    job_id: str
    storage_path: str    # source video, relative to MEDIA_ROOT
    artifacts_path: str  # output directory, relative to MEDIA_ROOT
    interval: float
    max_width: int
    model: str
    max_frames: int
    batch_size: int


class PipelineFailure(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ProgressReporter:
    """Maps a step's 0–1 fraction into an overall percentage band; sends only when the integer % changes,
    at most every `min_interval` seconds, so a long extraction does not flood NestJS."""

    def __init__(self, send: Callable[[int], None], min_interval: float = 0.5) -> None:
        self._send = send
        self._min_interval = min_interval
        self._last_percent = -1
        self._last_time = 0.0

    def band(self, start: int, end: int) -> Callable[[float], None]:
        return lambda fraction: self.report(start + round((end - start) * fraction))

    def report(self, percent: int, force: bool = False) -> None:
        now = time.monotonic()
        if percent == self._last_percent or (not force and now - self._last_time < self._min_interval):
            return
        self._last_percent, self._last_time = percent, now
        self._send(percent)


class ProcessingPipeline:
    def __init__(
        self,
        paths: MediaPaths,
        prober: MediaProber,
        audio: AudioExtractor,
        frames: FrameExtractor,
        transcriber: Transcriber,
        analyzer: VisualAnalyzer,
        events: EventSink,
        is_cancel_requested: Callable[[str], bool],
    ) -> None:
        self._paths = paths
        self._prober = prober
        self._audio = audio
        self._frames = frames
        self._transcriber = transcriber
        self._analyzer = analyzer
        self._events = events
        self._is_cancel_requested = is_cancel_requested

    def run(self, job: JobRequest) -> None:
        """Never raises: every outcome becomes a completion or failure event, and failures leave no files."""
        artifacts_dir = None
        source = None
        try:
            source = self._paths.resolve(job.storage_path)
            artifacts_dir = self._paths.resolve_artifacts(job.artifacts_path)
            self._process(job, source, artifacts_dir)
        except FfmpegCancelled:
            self._cleanup(artifacts_dir)
            self._events.failed(job.job_id, "CANCELLED", "Cancelled by the user")
        except PipelineFailure as failure:
            self._cleanup(artifacts_dir)
            self._events.failed(job.job_id, failure.code, str(failure))
        except ModelRuntimeUnavailable as exc:
            self._cleanup(artifacts_dir)
            self._events.failed(job.job_id, "MODEL_RUNTIME_UNAVAILABLE", str(exc))
        except ModelNotInstalled as exc:
            self._cleanup(artifacts_dir)
            self._events.failed(job.job_id, "MODEL_NOT_INSTALLED", str(exc))
        except TranscriptionError as exc:
            self._cleanup(artifacts_dir)
            self._events.failed(job.job_id, "TRANSCRIPTION_FAILED", scrub(str(exc), self._paths.root))
        except PathEscapeError as exc:
            self._events.failed(job.job_id, "INTERNAL", scrub(str(exc), self._paths.root))
        except FfmpegError as exc:
            self._cleanup(artifacts_dir)
            known = [p for p in (source, artifacts_dir, self._paths.root) if p is not None]
            self._events.failed(job.job_id, "FFMPEG_FAILED", f"FFmpeg failed: {scrub(str(exc), *known)}")
        except Exception as exc:  # noqa: BLE001 — report every unexpected error instead of hanging the job
            self._cleanup(artifacts_dir)
            self._events.failed(job.job_id, "INTERNAL", f"Unexpected error: {scrub(str(exc), self._paths.root)}")

    def _process(self, job: JobRequest, source, artifacts_dir) -> None:
        stop = {"requested": False}  # set when NestJS answers a progress event with stop (job deleted)

        def report(status: str, stage: str, percent: int) -> None:
            if self._events.progress(job.job_id, status, stage, percent):
                stop["requested"] = True

        def should_cancel() -> bool:
            return stop["requested"] or self._is_cancel_requested(job.job_id)

        report("VALIDATING", "Checking the video", 0)
        probe = self._prober.probe(source)
        if not probe.decodable:
            raise PipelineFailure("MEDIA_UNDECODABLE", f"Not a playable video: {probe.error}")
        if should_cancel():
            raise FfmpegCancelled()

        shutil.rmtree(artifacts_dir, ignore_errors=True)  # a re-run starts clean
        artifacts_dir.mkdir(parents=True)
        reporter = ProgressReporter(lambda pct: report("EXTRACTING_MEDIA", "Extracting audio and frames", pct))
        reporter.report(3, force=True)

        audio_path = artifacts_dir / AUDIO_FILE
        if probe.has_audio:
            self._audio.extract(
                source, audio_path, duration=probe.duration_seconds,
                on_progress=reporter.band(3, 8), should_cancel=should_cancel,
            )
        frames = self._frames.extract(
            source, artifacts_dir / FRAMES_DIR, interval=job.interval, max_width=job.max_width,
            duration=probe.duration_seconds, on_progress=reporter.band(8, 20), should_cancel=should_cancel,
        )

        transcript_path = artifacts_dir / TRANSCRIPT_FILE
        if probe.has_audio:
            transcribing = ProgressReporter(lambda pct: report("TRANSCRIBING", "Transcribing speech", pct))
            transcribing.report(20, force=True)
            transcript = self._transcriber.transcribe(
                audio_path, duration=probe.duration_seconds,
                on_progress=transcribing.band(20, 50), should_cancel=should_cancel,
            )
            transcript_path.write_text(json.dumps(transcript))

        analysing = ProgressReporter(lambda pct: report("ANALYZING_VISUALS", "Analysing frames", pct))
        analysing.report(50, force=True)
        chosen = select_evenly([_frame_dict(f) for f in frames], job.max_frames)
        visual = self._analyzer.analyze(
            artifacts_dir / FRAMES_DIR, chosen, model=job.model, batch_size=job.batch_size,
            on_progress=analysing.band(50, 99), should_cancel=should_cancel,
        )
        metrics = visual["metrics"]
        if metrics["validBatches"] == 0:
            raise PipelineFailure(
                "VISION_INVALID",
                f"The vision model returned no valid analysis ({metrics['totalBatches']} batches tried)",
            )
        visual_path = artifacts_dir / VISUAL_FILE
        visual_path.write_text(json.dumps(visual))

        refused = self._events.completed(
            job.job_id,
            {
                "has_audio": probe.has_audio,
                "audio_path": self._paths.relative(audio_path) if probe.has_audio else "",
                "audio_duration_seconds": _wav_duration(audio_path) if probe.has_audio else 0.0,
                "frame_count": len(frames),
                "frame_interval_seconds": job.interval,
                "frames_path": self._paths.relative(artifacts_dir / FRAMES_DIR),
                "transcript_path": self._paths.relative(transcript_path) if probe.has_audio else "",
                "visual_path": self._paths.relative(visual_path),
                "valid_batches": metrics["validBatches"],
                "total_batches": metrics["totalBatches"],
            },
        )
        if refused:  # cancelled or deleted after our last check: the completion was refused, keep nothing
            self._cleanup(artifacts_dir)

    @staticmethod
    def _cleanup(artifacts_dir) -> None:
        if artifacts_dir is not None:
            shutil.rmtree(artifacts_dir, ignore_errors=True)


def _wav_duration(path) -> float:
    with wave.open(str(path)) as wav:
        return round(wav.getnframes() / wav.getframerate(), 3)


def _frame_dict(frame) -> dict:
    return {"index": frame.index, "file": frame.file, "timestampSeconds": frame.timestamp_seconds}
