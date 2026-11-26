"""Durable job queue on Redis + RQ (system-design §13.3). RQ job id == processing job id."""

from redis import Redis
from rq import Queue, Worker
from rq.exceptions import NoSuchJobError
from rq.job import Job, JobStatus

from app.jobs.events import EventSink

QUEUE_NAME = "clipforge-processing"
JOB_TIMEOUT_SECONDS = 6 * 3600  # a 30+ min video: Whisper on CPU + 60 frames on the 8B model can take over 1 h
RESULT_TTL_SECONDS = 24 * 3600
TASK = "app.jobs.task.process_video"
EXPERIMENT_TASK = "app.jobs.task.run_experiment"
PLAN_TASK = "app.jobs.task.plan_clips"
RENDER_TASK = "app.jobs.task.render_clips"

# Which event reports a failure for each kind of queued work (jobs, experiments and plans share the queue).
# Ids are UUIDv4 from separate NestJS tables, so they never collide in RQ, the cancel flags or the sequences.
_FAILURE_EVENTS = {EXPERIMENT_TASK: "experiment_failed", PLAN_TASK: "plan_failed", RENDER_TASK: "render_failed"}


def report_failure(events, func_name: str, work_id: str, code: str, message: str) -> None:
    getattr(events, _FAILURE_EVENTS.get(func_name, "failed"))(work_id, code, message)

CANCEL_KEY = "clipforge:job-cancel:{job_id}"


class CancellationFlags:
    """A running job polls its flag; setting it asks the worker to stop."""

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    def request(self, job_id: str) -> None:
        self._redis.set(CANCEL_KEY.format(job_id=job_id), "1", ex=24 * 3600)

    def is_requested(self, job_id: str) -> bool:
        return bool(self._redis.exists(CANCEL_KEY.format(job_id=job_id)))

    def clear(self, job_id: str) -> None:
        self._redis.delete(CANCEL_KEY.format(job_id=job_id))


class JobQueue:
    def __init__(self, redis: Redis, flags: CancellationFlags, events: EventSink) -> None:
        self._redis = redis
        self._queue = Queue(QUEUE_NAME, connection=redis)
        self._flags = flags
        self._events = events

    def enqueue(self, job_id: str, storage_path: str, artifacts_path: str, interval: float, max_width: int) -> None:
        """Idempotent: a job id already known to RQ is not enqueued again."""
        if self._fetch(job_id) is not None:
            return
        self._queue.enqueue_call(
            TASK,
            kwargs={
                "job_id": job_id,
                "storage_path": storage_path,
                "artifacts_path": artifacts_path,
                "interval": interval,
                "max_width": max_width,
            },
            job_id=job_id,
            timeout=JOB_TIMEOUT_SECONDS,
            result_ttl=RESULT_TTL_SECONDS,
            failure_ttl=RESULT_TTL_SECONDS,
        )

    def enqueue_experiment(
        self, experiment_id: str, frames_path: str, output_path: str, model: str, max_frames: int, batch_size: int
    ) -> None:
        """Same queue and worker as processing, so an experiment never competes with a job for the GPU."""
        if self._fetch(experiment_id) is not None:
            return
        self._queue.enqueue_call(
            EXPERIMENT_TASK,
            kwargs={
                "experiment_id": experiment_id,
                "frames_path": frames_path,
                "output_path": output_path,
                "model": model,
                "max_frames": max_frames,
                "batch_size": batch_size,
            },
            job_id=experiment_id,
            timeout=JOB_TIMEOUT_SECONDS,
            result_ttl=RESULT_TTL_SECONDS,
            failure_ttl=RESULT_TTL_SECONDS,
        )

    def workers_running(self) -> bool:
        return Worker.count(connection=self._redis) > 0

    def enqueue_plan(self, plan_id: str, params: dict) -> None:
        """`params`: the keyword arguments of app.jobs.task.plan_clips except plan_id. Same queue: one model at a time."""
        self._enqueue(PLAN_TASK, plan_id, {"plan_id": plan_id, **params})

    def enqueue_render(self, render_id: str, params: dict) -> None:
        """`params`: the keyword arguments of app.jobs.task.render_clips except render_id (the GPU encoder is shared too)."""
        self._enqueue(RENDER_TASK, render_id, {"render_id": render_id, **params})

    def _enqueue(self, task: str, work_id: str, kwargs: dict) -> None:
        if self._fetch(work_id) is not None:
            return
        self._queue.enqueue_call(
            task,
            kwargs=kwargs,
            job_id=work_id,
            timeout=JOB_TIMEOUT_SECONDS,
            result_ttl=RESULT_TTL_SECONDS,
            failure_ttl=RESULT_TTL_SECONDS,
        )

    def cancel(self, job_id: str) -> bool:
        """Queued: dropped and reported CANCELLED here. Running: flagged; the worker stops and reports."""
        job = self._fetch(job_id)
        if job is None:
            return False
        status = job.get_status(refresh=True)
        if status in (JobStatus.QUEUED, JobStatus.DEFERRED, JobStatus.SCHEDULED):
            job.cancel()
            report_failure(self._events, job.func_name, job_id, "CANCELLED", "Cancelled before it started")
        elif status == JobStatus.STARTED:
            self._flags.request(job_id)
        return True

    def state(self, job_id: str) -> str:
        job = self._fetch(job_id)
        if job is None:
            return "UNKNOWN"
        status = job.get_status(refresh=True)
        if status in (JobStatus.QUEUED, JobStatus.DEFERRED, JobStatus.SCHEDULED):
            return "QUEUED"
        if status == JobStatus.STARTED:
            return "RUNNING"
        return "FINISHED"

    @property
    def queue(self) -> Queue:
        return self._queue

    def _fetch(self, job_id: str) -> Job | None:
        try:
            return Job.fetch(job_id, connection=self._redis)
        except NoSuchJobError:
            return None
