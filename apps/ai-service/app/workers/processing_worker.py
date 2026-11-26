"""The RQ worker process: `uv run python -m app.workers.processing_worker` (one job at a time)."""

import shutil

import structlog
from redis import Redis
from rq import Worker
from rq.job import Job
from rq.registry import StartedJobRegistry

from app.config import Settings
from app.jobs.events import EventSink, JobEventsClient
from app.jobs.queue import JobQueue, CancellationFlags
from app.logging_config import configure_logging
from app.media.media_paths import MediaPaths

log = structlog.get_logger()

INTERRUPTED_MESSAGE = "Processing interrupted. Process the video again"


def recover_interrupted(queue: JobQueue, events: EventSink, paths: MediaPaths) -> list[str]:
    """Jobs still marked started belonged to a worker that died: fail them and remove their partial files.
    (Phase 3 does not requeue; the user can click Process again.)"""
    registry = StartedJobRegistry(queue=queue.queue)
    recovered = []
    for job_id in registry.get_job_ids(cleanup=False):
        job = Job.fetch(job_id, connection=queue.queue.connection)
        artifacts = (job.kwargs or {}).get("artifacts_path")
        if artifacts:
            try:
                shutil.rmtree(paths.resolve_artifacts(artifacts), ignore_errors=True)
            except ValueError:
                log.warning("recovery_bad_artifacts_path", job_id=job_id)
        events.failed(job_id, "INTERRUPTED", INTERRUPTED_MESSAGE)
        # RQ 3 tracks executions: drop them from the registry, then the job itself.
        registry.remove_executions(job)
        job.delete()
        recovered.append(job_id)
    if recovered:
        log.warning("recovered_interrupted_jobs", count=len(recovered))
    return recovered


def main() -> None:
    configure_logging()
    settings = Settings()
    redis = Redis.from_url(settings.redis_url)
    events = JobEventsClient(settings.job_events_grpc_url, redis)
    queue = JobQueue(redis, CancellationFlags(redis), events)
    recover_interrupted(queue, events, MediaPaths(settings.media_root))
    events.close()  # close before RQ forks work horses; each job opens its own channel
    log.info("processing_worker_started", queue=queue.queue.name)
    Worker([queue.queue], connection=redis).work(with_scheduler=False)


if __name__ == "__main__":
    main()
