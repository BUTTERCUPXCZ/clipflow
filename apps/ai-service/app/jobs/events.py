"""Reports job events to NestJS (the only database writer) over gRPC JobEventsService."""

import time
from typing import Protocol

import grpc
import structlog
from redis import Redis

from app.generated.ai.v1 import job_events_pb2 as pb2
from app.generated.ai.v1 import job_events_pb2_grpc as pb2_grpc

log = structlog.get_logger()

SEQUENCE_KEY = "clipforge:job-seq:{job_id}"
SEQUENCE_TTL_SECONDS = 7 * 24 * 3600


class EventSink(Protocol):
    def progress(self, job_id: str, status: str, stage: str, progress: int, message: str = "") -> bool:
        """Returns True when NestJS says the job is gone or finished: stop working on it."""
        ...

    def completed(self, job_id: str, artifacts: dict) -> bool:
        """Returns True when NestJS refused the completion because the job is gone or already ended."""
        ...
    def failed(self, job_id: str, code: str, message: str) -> None: ...


class JobEventsClient:
    """Each event gets the next per-job sequence number from Redis (INCR), so numbers keep growing even when
    the gRPC service and the worker process report for the same job. Progress is best-effort; terminal
    events are retried, because a lost completion would leave the job looking busy until reconciliation.
    """

    def __init__(self, target: str, redis: Redis, timeout: float = 5.0, terminal_attempts: int = 6) -> None:
        self._target = target
        self._redis = redis
        self._timeout = timeout
        self._terminal_attempts = terminal_attempts
        self._channel: grpc.Channel | None = None

    def progress(self, job_id: str, status: str, stage: str, progress: int, message: str = "") -> bool:
        request = pb2.ReportProgressRequest(
            job_id=job_id,
            sequence=self._next_sequence(job_id),
            status=pb2.JobStatus.Value(f"JOB_STATUS_{status}"),
            stage=stage,
            progress=progress,
            message=message,
        )
        ack = self._send("ReportProgress", request, attempts=1)
        return bool(ack and ack.stop)

    def completed(self, job_id: str, artifacts: dict) -> bool:
        request = pb2.ReportCompletionRequest(
            job_id=job_id, sequence=self._next_sequence(job_id), artifacts=pb2.JobArtifacts(**artifacts)
        )
        ack = self._send("ReportCompletion", request, attempts=self._terminal_attempts)
        return bool(ack and ack.stop)

    def failed(self, job_id: str, code: str, message: str) -> None:
        request = pb2.ReportFailureRequest(
            job_id=job_id,
            sequence=self._next_sequence(job_id),
            error_code=pb2.JobErrorCode.Value(f"JOB_ERROR_CODE_{code}"),
            error_message=message[:1000],
        )
        self._send("ReportFailure", request, attempts=self._terminal_attempts)

    def close(self) -> None:
        if self._channel is not None:
            self._channel.close()
            self._channel = None

    def _next_sequence(self, job_id: str) -> int:
        key = SEQUENCE_KEY.format(job_id=job_id)
        sequence = int(self._redis.incr(key))
        self._redis.expire(key, SEQUENCE_TTL_SECONDS)
        return sequence

    def _send(self, method: str, request, attempts: int):
        # The channel is created lazily: RQ forks per job, and gRPC channels must not cross a fork.
        if self._channel is None:
            self._channel = grpc.insecure_channel(self._target)
        stub = pb2_grpc.JobEventsServiceStub(self._channel)
        for attempt in range(1, attempts + 1):
            try:
                return getattr(stub, method)(request, timeout=self._timeout)
            except grpc.RpcError as exc:
                if attempt == attempts:
                    log.error("job_event_lost", method=method, job_id=request.job_id, error=str(exc.code()))
                    return None
                time.sleep(min(2**attempt, 10))
