"""RQ entry points. RQ imports these by name inside the forked work horse, so every connection
(Redis, gRPC, Ollama) is created here, after the fork."""

from redis import Redis

from app.analysis.ollama_vision import OllamaVisionClient
from app.analysis.transcriber import Transcriber
from app.analysis.visual_analyzer import VisualAnalyzer
from app.config import Settings
from app.jobs.events import JobEventsClient
from app.jobs.experiment import ExperimentRequest, ExperimentRunner
from app.jobs.pipeline import JobRequest, ProcessingPipeline
from app.jobs.planning_job import PlanRequest, PlanRunner
from app.jobs.queue import CancellationFlags
from app.jobs.rendering_job import RenderRequest, RenderRunner
from app.media.extractors import AudioExtractor, FrameExtractor
from app.media.ffmpeg_runner import FfmpegRunner
from app.media.media_paths import MediaPaths
from app.media.prober import MediaProber
from app.planning.planner import ClipPlanner
from app.planning.schemas import PlanSettings
from app.rendering.profile import choose_encoder
from app.rendering.renderer import ClipRenderer, ClipSpec


def _vision(settings: Settings) -> OllamaVisionClient:
    return OllamaVisionClient(settings.ollama_base_url, settings.vision_request_timeout, settings.ollama_keep_alive)


def process_video(job_id: str, storage_path: str, artifacts_path: str, interval: float, max_width: int) -> None:
    settings = Settings()
    redis = Redis.from_url(settings.redis_url)
    flags = CancellationFlags(redis)
    events = JobEventsClient(settings.job_events_grpc_url, redis)
    vision = _vision(settings)
    runner = FfmpegRunner()
    try:
        ProcessingPipeline(
            paths=MediaPaths(settings.media_root),
            prober=MediaProber(runner),
            audio=AudioExtractor(runner),
            frames=FrameExtractor(runner),
            transcriber=Transcriber(settings.transcription_model, settings.whisper_device, settings.whisper_compute_type),
            analyzer=VisualAnalyzer(vision, settings.vision_tokens_per_frame),
            events=events,
            is_cancel_requested=flags.is_requested,
        ).run(
            JobRequest(
                job_id, storage_path, artifacts_path, interval, max_width,
                model=settings.vision_model, max_frames=settings.vision_max_frames, batch_size=settings.vision_batch_size,
            )
        )
    finally:
        flags.clear(job_id)
        vision.close()
        events.close()
        redis.close()


def run_experiment(
    experiment_id: str, frames_path: str, output_path: str, model: str, max_frames: int, batch_size: int
) -> None:
    settings = Settings()
    redis = Redis.from_url(settings.redis_url)
    flags = CancellationFlags(redis)
    events = JobEventsClient(settings.job_events_grpc_url, redis)
    vision = _vision(settings)
    try:
        ExperimentRunner(
            paths=MediaPaths(settings.media_root),
            analyzer=VisualAnalyzer(vision, settings.vision_tokens_per_frame),
            events=events,
            is_cancel_requested=flags.is_requested,
        ).run(ExperimentRequest(experiment_id, frames_path, output_path, model, max_frames, batch_size))
    finally:
        flags.clear(experiment_id)
        vision.close()
        events.close()
        redis.close()


def plan_clips(
    plan_id: str,
    transcript_path: str,
    visual_path: str,
    output_path: str,
    duration_seconds: float,
    min_seconds: int,
    max_seconds: int,
    max_clips: int,
    model: str,
) -> None:
    settings = Settings()
    redis = Redis.from_url(settings.redis_url)
    flags = CancellationFlags(redis)
    events = JobEventsClient(settings.job_events_grpc_url, redis)
    llm = _vision(settings)
    try:
        PlanRunner(
            paths=MediaPaths(settings.media_root),
            planner=ClipPlanner(llm, model),
            events=events,
            is_cancel_requested=flags.is_requested,
        ).run(
            PlanRequest(
                plan_id, transcript_path, visual_path, output_path, duration_seconds,
                PlanSettings(minSeconds=min_seconds, maxSeconds=max_seconds, maxClips=max_clips),
            )
        )
    finally:
        flags.clear(plan_id)
        llm.close()
        events.close()
        redis.close()


def render_clips(render_id: str, source_path: str, output_path: str, subtitles: bool, clips: list[dict]) -> None:
    """`clips`: [{clip_id, start, end, cues: [{start, end, text}]}] (JSON-friendly for RQ)."""
    settings = Settings()
    redis = Redis.from_url(settings.redis_url)
    flags = CancellationFlags(redis)
    events = JobEventsClient(settings.job_events_grpc_url, redis)
    runner = FfmpegRunner()
    prober = MediaProber(runner)
    try:
        RenderRunner(
            paths=MediaPaths(settings.media_root),
            prober=prober,
            renderer=ClipRenderer(runner, prober, choose_encoder(settings.video_encoder, runner)),
            events=events,
            is_cancel_requested=flags.is_requested,
        ).run(RenderRequest(render_id, source_path, output_path, subtitles, [ClipSpec(**c) for c in clips]))
    finally:
        flags.clear(render_id)
        events.close()
        redis.close()
