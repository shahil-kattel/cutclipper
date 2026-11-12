"""Structured logging setup shared by the API and workers."""

from __future__ import annotations

import json
import logging
import logging.config
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
job_id_ctx: ContextVar[str | None] = ContextVar("job_id", default=None)

_RESERVED_ATTRS = {
    "args",
    "asctime",
    "created",
    "exc_info",
    "exc_text",
    "filename",
    "funcName",
    "levelname",
    "levelno",
    "lineno",
    "module",
    "msecs",
    "message",
    "msg",
    "name",
    "pathname",
    "process",
    "processName",
    "relativeCreated",
    "stack_info",
    "thread",
    "threadName",
    "taskName",
}


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        record.job_id = job_id_ctx.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.request_id:
            payload["request_id"] = record.request_id
        if record.job_id:
            payload["job_id"] = record.job_id
        for key, value in record.__dict__.items():
            if key not in _RESERVED_ATTRS and not key.startswith("_") and key not in payload:
                if key in {"request_id", "job_id"}:
                    continue
                try:
                    json.dumps(value)
                except (TypeError, ValueError):
                    value = repr(value)
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


class HumanFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        suffix = ""
        if record.request_id:
            suffix += f" request_id={record.request_id}"
        if record.job_id:
            suffix += f" job_id={record.job_id}"
        return f"{base}{suffix}"


def configure_logging(level: str = "INFO", *, json_logs: bool = True) -> None:
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(ContextFilter())
    if json_logs:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(HumanFormatter("%(asctime)s %(levelname)-8s %(name)s — %(message)s"))
    root.addHandler(handler)
    root.setLevel(level.upper())

    for noisy in (
        "uvicorn.access",
        "httpcore",
        "httpx",
        "huggingface_hub",
        "faster_whisper",
        "PIL",
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {
                    "()": (
                        "app.logging_setup.JsonFormatter"
                        if json_logs
                        else "app.logging_setup.HumanFormatter"
                    ),
                    "format": "%(asctime)s %(levelname)-8s %(name)s — %(message)s",
                }
            },
            "handlers": {
                "default": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "stream": "ext://sys.stdout",
                    "filters": ["context"],
                }
            },
            "filters": {"context": {"()": "app.logging_setup.ContextFilter"}},
            "loggers": {
                "uvicorn": {"handlers": ["default"], "level": level.upper(), "propagate": False},
                "uvicorn.error": {
                    "handlers": ["default"],
                    "level": level.upper(),
                    "propagate": False,
                },
            },
        }
    )
