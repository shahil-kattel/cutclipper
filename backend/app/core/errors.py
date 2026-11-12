"""Typed application errors with user-facing messages."""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Base error surfaced to API clients and job consumers."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "app_error",
        status_code: int = 400,
        retryable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.retryable = retryable
        self.details = details or {}


class InputValidationError(AppError):
    def __init__(self, message: str, *, code: str = "invalid_input", **kwargs: Any) -> None:
        super().__init__(message, code=code, status_code=422, **kwargs)


class URLValidationError(InputValidationError):
    def __init__(self, message: str, *, code: str = "invalid_url") -> None:
        super().__init__(message, code=code)


class MediaFetchError(AppError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "fetch_failed",
        retryable: bool = True,
        **kwargs: Any,
    ) -> None:
        super().__init__(
            message,
            code=code,
            status_code=422,
            retryable=retryable,
            **kwargs,
        )


class JobNotFoundError(AppError):
    def __init__(self, message: str = "That job could not be found or has expired.") -> None:
        super().__init__(message, code="job_not_found", status_code=404)


class ClipNotFoundError(AppError):
    def __init__(self) -> None:
        super().__init__("That clip could not be found.", code="clip_not_found", status_code=404)


class JobCancelledError(AppError):
    def __init__(self) -> None:
        super().__init__("The job was cancelled.", code="job_cancelled", status_code=409)


class ProcessingError(AppError):
    def __init__(
        self,
        message: str,
        *,
        code: str = "processing_failed",
        retryable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(
            message,
            code=code,
            status_code=500,
            retryable=retryable,
            details=details,
        )


class SelectionError(ProcessingError):
    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message, code="selection_failed", details=details)
