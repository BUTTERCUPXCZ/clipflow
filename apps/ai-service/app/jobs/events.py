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

    def experiment_progress(self, experiment_id: str, progress: int, message: str = "") -> bool:
        request = pb2.ReportExperimentProgressRequest(
            experiment_id=experiment_id, sequence=self._next_sequence(experiment_id), progress=progress, message=message
        )
        ack = self._send("ReportExperimentProgress", request, attempts=1)
        return bool(ack and ack.stop)

    def experiment_completed(self, experiment_id: str, output_path: str, metrics: dict) -> bool:
        peak = metrics.get("peakVramMiB")
        request = pb2.ReportExperimentCompletionRequest(
            experiment_id=experiment_id,
            sequence=self._next_sequence(experiment_id),
            output_path=output_path,
            metrics=pb2.ExperimentMetrics(
                load_ms=metrics["loadMs"],
                inference_ms=metrics["inferenceMs"],
                total_ms=metrics["totalMs"],
                peak_vram_mib=-1 if peak is None else peak,
                frames_analysed=metrics["framesAnalysed"],
                valid_batches=metrics["validBatches"],
                total_batches=metrics["totalBatches"],
            ),
        )
        ack = self._send("ReportExperimentCompletion", request, attempts=self._terminal_attempts)
        return bool(ack and ack.stop)

    def experiment_failed(self, experiment_id: str, code: str, message: str) -> None:
        request = pb2.ReportExperimentFailureRequest(
            experiment_id=experiment_id,
            sequence=self._next_sequence(experiment_id),
            error_code=pb2.JobErrorCode.Value(f"JOB_ERROR_CODE_{code}"),
            error_message=message[:1000],
        )
        self._send("ReportExperimentFailure", request, attempts=self._terminal_attempts)

    def plan_progress(self, plan_id: str, progress: int, message: str = "") -> bool:
        request = pb2.ReportPlanProgressRequest(
            plan_id=plan_id, sequence=self._next_sequence(plan_id), progress=progress, message=message
        )
        ack = self._send("ReportPlanProgress", request, attempts=1)
        return bool(ack and ack.stop)

    def plan_completed(self, plan_id: str, output_path: str, metrics: dict) -> bool:
        request = pb2.ReportPlanCompletionRequest(
            plan_id=plan_id,
            sequence=self._next_sequence(plan_id),
            output_path=output_path,
            metrics=pb2.PlanMetrics(
                llm_calls=metrics["llmCalls"],
                elapsed_ms=metrics["elapsedMs"],
                windows=metrics["windows"],
                skipped_windows=metrics["skippedWindows"],
                clip_count=metrics["clipCount"],
            ),
        )
        ack = self._send("ReportPlanCompletion", request, attempts=self._terminal_attempts)
        return bool(ack and ack.stop)

    def plan_failed(self, plan_id: str, code: str, message: str) -> None:
        request = pb2.ReportPlanFailureRequest(
            plan_id=plan_id,
            sequence=self._next_sequence(plan_id),
            error_code=pb2.JobErrorCode.Value(f"JOB_ERROR_CODE_{code}"),
            error_message=message[:1000],
        )
        self._send("ReportPlanFailure", request, attempts=self._terminal_attempts)

    def render_progress(self, render_id: str, progress: int, message: str = "") -> bool:
        request = pb2.ReportRenderProgressRequest(
            render_id=render_id, sequence=self._next_sequence(render_id), progress=progress, message=message
        )
        ack = self._send("ReportRenderProgress", request, attempts=1)
        return bool(ack and ack.stop)

    def render_completed(self, render_id: str, output_path: str, metrics: dict) -> bool:
        request = pb2.ReportRenderCompletionRequest(
            render_id=render_id,
            sequence=self._next_sequence(render_id),
            output_path=output_path,
            metrics=pb2.RenderMetrics(
                rendered=metrics["rendered"], failed=metrics["failed"],
                elapsed_ms=metrics["elapsedMs"], encoder=metrics["encoder"],
            ),
        )
        ack = self._send("ReportRenderCompletion", request, attempts=self._terminal_attempts)
        return bool(ack and ack.stop)

    def render_failed(self, render_id: str, code: str, message: str) -> None:
        request = pb2.ReportRenderFailureRequest(
            render_id=render_id,
            sequence=self._next_sequence(render_id),
            error_code=pb2.JobErrorCode.Value(f"JOB_ERROR_CODE_{code}"),
            error_message=message[:1000],
        )
        self._send("ReportRenderFailure", request, attempts=self._terminal_attempts)

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
        job_id = next(
            (getattr(request, f, "") for f in ("job_id", "experiment_id", "plan_id", "render_id") if getattr(request, f, "")), ""
        )
        # The channel is created lazily: RQ forks per job, and gRPC channels must not cross a fork.
        if self._channel is None:
            self._channel = grpc.insecure_channel(self._target)
        stub = pb2_grpc.JobEventsServiceStub(self._channel)
        for attempt in range(1, attempts + 1):
            try:
                return getattr(stub, method)(request, timeout=self._timeout)
            except grpc.RpcError as exc:
                if attempt == attempts:
                    log.error("job_event_lost", method=method, job_id=job_id, error=str(exc.code()))
                    return None
                time.sleep(min(2**attempt, 10))
