"""RQ entry point. RQ imports this by name ("app.jobs.task.process_video") inside the forked work horse,
so every connection (Redis, gRPC) is created here, after the fork."""

from redis import Redis

from app.config import Settings
from app.jobs.events import JobEventsClient
from app.jobs.pipeline import JobRequest, ProcessingPipeline
from app.jobs.queue import CancellationFlags
from app.media.extractors import AudioExtractor, FrameExtractor
from app.media.ffmpeg_runner import FfmpegRunner
from app.media.media_paths import MediaPaths
from app.media.prober import MediaProber


def process_video(job_id: str, storage_path: str, artifacts_path: str, interval: float, max_width: int) -> None:
    settings = Settings()
    redis = Redis.from_url(settings.redis_url)
    flags = CancellationFlags(redis)
    events = JobEventsClient(settings.job_events_grpc_url, redis)
    runner = FfmpegRunner()
    try:
        ProcessingPipeline(
            paths=MediaPaths(settings.media_root),
            prober=MediaProber(runner),
            audio=AudioExtractor(runner),
            frames=FrameExtractor(runner),
            events=events,
            is_cancel_requested=flags.is_requested,
        ).run(JobRequest(job_id, storage_path, artifacts_path, interval, max_width))
    finally:
        flags.clear(job_id)
        events.close()
        redis.close()
