"""REST and Server-Sent Events API."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from app import __version__
from app.config import Settings
from app.core.errors import AppError, ClipNotFoundError, JobNotFoundError
from app.core.validation import validate_remote_url
from app.pipeline.jobs import JobManager
from app.pipeline.renderer import safe_title_slug
from app.schemas import (
    ApiConfig,
    ClipSettings,
    CreateJobRequest,
    HealthResponse,
    JobOut,
    PreviewRequest,
    PreviewResponse,
)
from app.services.downloader import fetch_metadata
from app.services.media import get_media_tools

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


def _manager(request: Request) -> JobManager:
    return request.app.state.jobs


def _settings(request: Request) -> Settings:
    return request.app.state.settings


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    settings = _settings(request)
    manager = _manager(request)
    ffmpeg_path: str | None = None
    has_libass = False
    healthy = False
    try:
        tools = await asyncio.to_thread(get_media_tools, settings)
        ffmpeg_path = tools.ffmpeg
        has_libass = tools.has_libass
        healthy = True
    except Exception:
        logger.exception("health check could not locate FFmpeg")
    active = sum(1 for job in manager.jobs.values() if job.status.value in {"queued", "running"})
    return HealthResponse(
        status="ok" if healthy else "degraded",
        version=__version__,
        ffmpeg=healthy,
        ffmpeg_path=ffmpeg_path,
        libass=has_libass,
        whisper_model=settings.whisper_model,
        active_jobs=active,
    )


@router.get("/config", response_model=ApiConfig)
async def api_config(request: Request) -> ApiConfig:
    settings = _settings(request)
    return ApiConfig(
        max_video_duration_seconds=settings.max_video_duration_seconds,
        max_clip_count=20,
        supported_aspect_ratios=["9:16", "1:1", "4:5"],
        default_settings=ClipSettings(),
    )


@router.post("/uploads", response_model=PreviewResponse, status_code=201)
async def upload_video(request: Request, file: UploadFile = File(...)) -> PreviewResponse:
    uploads = _manager(request).uploads
    try:
        stored = await uploads.save(file)
    finally:
        await file.close()
    return PreviewResponse(**stored.metadata.model_dump(), upload_id=stored.id)


@router.get("/uploads/{upload_id}/thumbnail")
async def upload_thumbnail(upload_id: str, request: Request) -> FileResponse:
    path = _manager(request).uploads.thumbnail(upload_id)
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("/preview", response_model=PreviewResponse)
async def preview_video(payload: PreviewRequest, request: Request) -> PreviewResponse:
    settings = _settings(request)
    normalized = await validate_remote_url(payload.url)
    metadata = await fetch_metadata(normalized, settings)
    _manager(request).cache_preview(metadata)
    logger.info(
        "preview resolved",
        extra={"source": metadata.source, "duration": metadata.duration},
    )
    return PreviewResponse(**metadata.model_dump(), normalized_url=normalized)


@router.post("/jobs", response_model=JobOut, status_code=202)
async def create_job(payload: CreateJobRequest, request: Request) -> JobOut:
    manager = _manager(request)
    if payload.upload_id:
        record = await manager.create_job(None, payload.settings, upload_id=payload.upload_id)
    else:
        normalized = await validate_remote_url(payload.url or "")
        record = await manager.create_job(normalized, payload.settings)
    return manager.snapshot(record.id)


@router.get("/jobs/{job_id}", response_model=JobOut)
async def get_job(job_id: str, request: Request) -> JobOut:
    return _manager(request).snapshot(job_id)


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request) -> StreamingResponse:
    manager = _manager(request)
    manager.get(job_id)  # Fail before headers are sent when the job is unknown.
    return StreamingResponse(
        manager.event_stream(job_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/jobs/{job_id}/cancel", response_model=JobOut)
async def cancel_job(job_id: str, request: Request) -> JobOut:
    manager = _manager(request)
    manager.request_cancel(job_id)
    return manager.snapshot(job_id)


@router.get("/jobs/{job_id}/clips/{clip_id}/video")
async def clip_video(job_id: str, clip_id: str, request: Request) -> FileResponse:
    manager = _manager(request)
    try:
        clip = manager.clip(job_id, clip_id)
    except AppError:
        raise ClipNotFoundError() from None
    if not clip.video_path.exists():
        raise ClipNotFoundError()
    return FileResponse(
        clip.video_path,
        media_type="video/mp4",
        headers={"Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes"},
    )


@router.get("/jobs/{job_id}/clips/{clip_id}/download")
async def download_clip(job_id: str, clip_id: str, request: Request) -> FileResponse:
    manager = _manager(request)
    try:
        clip = manager.clip(job_id, clip_id)
    except AppError:
        raise ClipNotFoundError() from None
    if not clip.video_path.exists():
        raise ClipNotFoundError()
    return FileResponse(
        clip.video_path,
        media_type="video/mp4",
        filename=clip.filename,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/jobs/{job_id}/clips/{clip_id}/thumbnail")
async def clip_thumbnail(job_id: str, clip_id: str, request: Request) -> FileResponse:
    manager = _manager(request)
    try:
        clip = manager.clip(job_id, clip_id)
    except AppError:
        raise ClipNotFoundError() from None
    if not clip.thumbnail_path.exists():
        raise ClipNotFoundError()
    return FileResponse(
        clip.thumbnail_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/jobs/{job_id}/download.zip")
async def download_all(job_id: str, request: Request) -> FileResponse:
    manager = _manager(request)
    record = manager.get(job_id)
    if record.status.value != "completed":
        raise AppError(
            "The download bundle is not ready yet. Wait for the render to finish.",
            code="job_not_ready",
            status_code=409,
        )
    if not record.clips:
        raise JobNotFoundError("There are no rendered clips to download yet.")
    try:
        zip_path = await asyncio.to_thread(manager.zip_path, job_id)
    except (OSError, ValueError) as exc:
        raise AppError(
            "The ZIP archive could not be created.",
            code="zip_failed",
            status_code=500,
            retryable=True,
        ) from exc
    title = safe_title_slug(record.video.title if record.video else "cutclipper")
    return FileResponse(
        Path(zip_path),
        media_type="application/zip",
        filename=f"{title}_clips.zip",
    )
