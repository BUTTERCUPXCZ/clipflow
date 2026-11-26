import logging
import sys

import structlog


def _tidy_uvicorn_name(_logger, _method, event_dict):
    # uvicorn logs normal startup messages under "uvicorn.error", which reads like a failure.
    if event_dict.get("logger") == "uvicorn.error":
        event_dict["logger"] = "uvicorn"
    return event_dict


def configure_logging() -> None:
    """Terminal: readable colored lines. Piped/redirected: JSON for log tooling.

    Routes stdlib logs (uvicorn, grpc) through the same renderer as structlog.
    """
    pretty = sys.stderr.isatty()
    shared = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        _tidy_uvicorn_name,
        # Local wall-clock time in the terminal (matches the NestJS logs); UTC ISO in JSON.
        structlog.processors.TimeStamper(fmt="%H:%M:%S", utc=False)
        if pretty
        else structlog.processors.TimeStamper(fmt="iso"),
    ]
    render = (
        [structlog.dev.ConsoleRenderer()]
        if pretty
        else [structlog.processors.format_exc_info, structlog.processors.JSONRenderer()]
    )

    structlog.configure(
        processors=[*shared, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    handler = logging.StreamHandler()
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=shared,
            processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta, *render],
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per Ollama poll is noise
