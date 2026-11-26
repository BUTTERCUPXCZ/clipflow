"""Queue, events and worker recovery against a real Redis (db 15) and an in-process fake NestJS."""

import shutil
from concurrent import futures

import grpc
import pytest
from redis import Redis
from rq import SimpleWorker
from rq.executions import Execution
from rq.job import Job
from rq.registry import StartedJobRegistry

from app.generated.ai.v1 import job_events_pb2 as pb2
from app.generated.ai.v1 import job_events_pb2_grpc as pb2_grpc
from app.jobs.events import JobEventsClient
from app.jobs.queue import CancellationFlags, JobQueue
from app.media.media_paths import MediaPaths
from app.workers.processing_worker import INTERRUPTED_MESSAGE, recover_interrupted
from tests.media_fixtures import videos  # noqa: F401  (pytest fixture)

TEST_REDIS = "redis://localhost:6379/15"


class FakeNest(pb2_grpc.JobEventsServiceServicer):
    def __init__(self) -> None:
        self.events: list[tuple[str, object]] = []

    def _record(self, kind, request):
        self.events.append((kind, request))
        return pb2.ReportAck(applied=True)

    def ReportProgress(self, request, context):  # noqa: N802
        return self._record("progress", request)

    def ReportCompletion(self, request, context):  # noqa: N802
        return self._record("completion", request)

    def ReportFailure(self, request, context):  # noqa: N802
        return self._record("failure", request)


@pytest.fixture
def redis():
    client = Redis.from_url(TEST_REDIS)
    try:
        client.ping()
    except Exception:  # noqa: BLE001
        pytest.skip("local Redis not available")
    client.flushdb()
    yield client
    client.flushdb()
    client.close()


@pytest.fixture
def nest():
    fake = FakeNest()
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    pb2_grpc.add_JobEventsServiceServicer_to_server(fake, server)
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    fake.target = f"127.0.0.1:{port}"
    yield fake
    server.stop(None)


def kinds(nest) -> list[str]:
    return [k for k, _ in nest.events]


def test_sequence_keeps_growing_across_clients(redis, nest):
    first, second = JobEventsClient(nest.target, redis), JobEventsClient(nest.target, redis)

    first.progress("j1", "VALIDATING", "Checking", 0)
    second.progress("j1", "EXTRACTING_MEDIA", "Extracting", 10)
    first.failed("j1", "CANCELLED", "stop")

    assert [r.sequence for _, r in nest.events] == [1, 2, 3]
    assert nest.events[2][1].error_code == pb2.JOB_ERROR_CODE_CANCELLED


def test_unreachable_nest_does_not_raise(redis):
    client = JobEventsClient("127.0.0.1:1", redis, timeout=0.2, terminal_attempts=1)

    client.failed("j1", "INTERNAL", "boom")  # logged, not raised


def test_enqueue_is_idempotent_and_reports_state(redis, nest):
    queue = JobQueue(redis, CancellationFlags(redis), JobEventsClient(nest.target, redis))

    queue.enqueue("j1", "src/a.mp4", "analysis/j1", 1.0, 768)
    queue.enqueue("j1", "src/a.mp4", "analysis/j1", 1.0, 768)

    assert queue.queue.count == 1
    assert queue.state("j1") == "QUEUED"
    assert queue.state("missing") == "UNKNOWN"


def test_cancelling_a_queued_job_drops_it_and_reports_cancelled(redis, nest):
    queue = JobQueue(redis, CancellationFlags(redis), JobEventsClient(nest.target, redis))
    queue.enqueue("j1", "src/a.mp4", "analysis/j1", 1.0, 768)

    assert queue.cancel("j1") is True

    assert queue.queue.count == 0
    assert kinds(nest) == ["failure"]
    assert nest.events[0][1].error_code == pb2.JOB_ERROR_CODE_CANCELLED
    assert queue.cancel("missing") is False


def test_cancelling_a_running_job_sets_its_flag(redis, nest):
    flags = CancellationFlags(redis)
    queue = JobQueue(redis, flags, JobEventsClient(nest.target, redis))
    queue.enqueue("j1", "src/a.mp4", "analysis/j1", 1.0, 768)
    job = Job.fetch("j1", connection=redis)
    job.set_status("started")

    queue.cancel("j1")

    assert flags.is_requested("j1")
    assert kinds(nest) == []  # the worker reports when it stops


def test_worker_startup_fails_interrupted_jobs_and_removes_their_files(redis, nest, tmp_path):
    events = JobEventsClient(nest.target, redis)
    queue = JobQueue(redis, CancellationFlags(redis), events)
    queue.enqueue("j1", "src/a.mp4", "analysis/j1", 1.0, 768)
    job = Job.fetch("j1", connection=redis)
    with redis.pipeline() as pipe:  # what a worker records when it starts a job (then it dies)
        Execution.create(job, ttl=600, pipeline=pipe)
        pipe.execute()
    assert StartedJobRegistry(queue=queue.queue).get_job_ids(cleanup=False) == ["j1"]
    partial = tmp_path / "analysis" / "j1" / "frames"
    partial.mkdir(parents=True)

    recovered = recover_interrupted(queue, events, MediaPaths(tmp_path))

    assert recovered == ["j1"]
    assert nest.events[0][1].error_code == pb2.JOB_ERROR_CODE_INTERRUPTED
    assert nest.events[0][1].error_message == INTERRUPTED_MESSAGE
    assert not (tmp_path / "analysis" / "j1").exists()
    assert StartedJobRegistry(queue=queue.queue).get_job_ids(cleanup=False) == []
    assert queue.state("j1") == "UNKNOWN"


def test_a_real_worker_runs_the_whole_job(redis, nest, tmp_path, videos, monkeypatch):
    (tmp_path / "src").mkdir()
    shutil.copy(videos.with_audio, tmp_path / "src" / "a.mp4")
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setenv("REDIS_URL", TEST_REDIS)
    monkeypatch.setenv("JOB_EVENTS_GRPC_URL", nest.target)
    queue = JobQueue(redis, CancellationFlags(redis), JobEventsClient(nest.target, redis))
    queue.enqueue("j1", "src/a.mp4", "analysis/j1", 1.0, 768)

    SimpleWorker([queue.queue], connection=redis).work(burst=True)

    assert kinds(nest)[0] == "progress" and kinds(nest)[-1] == "completion"
    artifacts = nest.events[-1][1].artifacts
    assert (artifacts.has_audio, artifacts.frame_count) == (True, 3)
    sequences = [r.sequence for _, r in nest.events]
    assert sequences == sorted(sequences) and len(set(sequences)) == len(sequences)
    assert queue.state("j1") == "FINISHED"
