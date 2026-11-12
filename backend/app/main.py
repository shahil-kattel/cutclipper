"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api.routes import router
from app.config import get_settings
from app.core.errors import AppError
from app.logging_setup import configure_logging, request_id_ctx
from app.pipeline.jobs import JobManager
from app.schemas import ErrorBody, ErrorResponse

settings = get_settings()
configure_logging(settings.log_level, json_logs=settings.log_json)
logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.ensure_directories()
    manager = JobManager(settings)
    app.state.jobs = manager
    app.state.settings = settings
    await manager.start()
    logger.info(
        "CutClipper API ready",
        extra={"environment": settings.environment, "version": __version__},
    )
    try:
        yield
    finally:
        await manager.stop()
        logger.info("CutClipper API stopped")


app = FastAPI(
    title="CutClipper",
    version=__version__,
    description="Turn any video link into captioned, vertical short clips.",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Length", "Accept-Ranges"],
)


@app.middleware("http")
async def upload_size_guard(request: Request, call_next: Any) -> Any:
    """Reject obviously oversized uploads before Starlette spools the body to disk."""

    if request.method == "POST" and request.url.path == "/api/uploads":
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                declared = int(content_length)
            except ValueError:
                declared = 0
            if declared > settings.max_upload_bytes + 2_000_000:
                limit_gb = settings.max_upload_bytes / (1024**3)
                return JSONResponse(
                    status_code=413,
                    content=ErrorResponse(
                        error=ErrorBody(
                            code="file_too_large",
                            message=f"That file is larger than the {limit_gb:g} GB upload limit.",
                            retryable=False,
                        )
                    ).model_dump(mode="json"),
                )
    return await call_next(request)


@app.middleware("http")
async def request_context(request: Request, call_next: Any) -> Any:
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    token = request_id_ctx.set(request_id)
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed = (time.perf_counter() - started) * 1000
        logger.exception(
            "request failed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "elapsed_ms": round(elapsed, 1),
            },
        )
        raise
    finally:
        request_id_ctx.reset(token)
    elapsed = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    if request.url.path.startswith("/api/") and request.url.path != "/api/health":
        logger.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "elapsed_ms": round(elapsed, 1),
            },
        )
    return response


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=ErrorBody(
                code=exc.code,
                message=exc.message,
                retryable=exc.retryable,
                details=exc.details,
            )
        ).model_dump(mode="json"),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    location = ".".join(
        str(part) for part in first.get("loc", []) if part not in {"body", "query", "path"}
    )
    message = str(first.get("msg") or "Invalid request.")
    message = message.removeprefix("Value error, ")
    if location:
        message = f"{message} ({location})"
    return JSONResponse(
        status_code=422,
        content=ErrorResponse(
            error=ErrorBody(
                code="validation_error",
                message=message,
                retryable=False,
            )
        ).model_dump(mode="json"),
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled API error")
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error=ErrorBody(
                code="internal_error",
                message="An unexpected server error occurred. Please try again.",
                retryable=True,
            )
        ).model_dump(mode="json"),
    )


app.include_router(router)

frontend_dist: Path | None = settings.frontend_dist
if frontend_dist and (frontend_dist / "index.html").exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
else:

    @app.get("/", include_in_schema=False)
    async def backend_root() -> dict[str, str]:
        return {
            "name": "CutClipper API",
            "version": __version__,
            "docs": "/api/docs",
            "message": "Frontend not built. Run the Vite dev server or build the frontend.",
        }
