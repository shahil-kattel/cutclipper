"""REST and Server-Sent Events API."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from threading import Event

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from app import __version__
from app.caption_fonts import catalog_for_client, safe_font_file
from app.config import Settings
from app.core.errors import AppError, ClipNotFoundError, JobNotFoundError
from app.core.validation import validate_remote_url
from app.pipeline.captions import build_caption_segments
from app.pipeline.jobs import JobManager
from app.pipeline.renderer import safe_title_slug
from app.pipeline.types import Word
from app.schemas import (
    CAPTION_FONTS,
    ApiConfig,
    CaptionStyle,
    ClipSettings,
    CreateJobRequest,
    HealthResponse,
    JobCaptionsResponse,
    JobOut,
    PreviewRequest,
    PreviewResponse,
    RestyleCaptionsRequest,
    RomanizeSegmentsRequest,
    RomanizeSegmentsResponse,
    TranscribeRequest,
    TranscriptResponse,
    TranscriptWordOut,
    TranslateSegmentsRequest,
    TranslateSegmentsResponse,
)
from app.services.audio import extract_audio
from app.services.downloader import fetch_metadata
from app.services.media import get_media_tools
from app.services.romanize import romanize_segments
from app.services.transcriber import normalize_cached_words, transcribe_audio
from app.services.translator import translate_caption_segments

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
        max_upload_bytes=settings.max_upload_bytes,
        max_clip_count=20,
        supported_aspect_ratios=["9:16", "1:1", "4:5"],
        caption_fonts=list(CAPTION_FONTS),
        caption_styles=[style.value for style in CaptionStyle],
        transcription_languages=[
            {"code": "auto", "label": "Detect language"},
            {"code": "en", "label": "English"},
            {"code": "ne", "label": "नेपाली (Nepali)"},
        ],
        default_settings=ClipSettings(),
    )


@router.get("/caption-fonts")
async def caption_font_catalog() -> list[dict[str, object]]:
    return catalog_for_client()


@router.get("/caption-fonts/{filename}")
async def caption_font_file(filename: str) -> FileResponse:
    path = safe_font_file(filename)
    if path is None:
        raise AppError(
            "That caption font is not available.", code="font_not_found", status_code=404
        )
    return FileResponse(
        path,
        media_type="font/ttf",
        headers={"Cache-Control": "public, max-age=604800, immutable"},
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


_VIDEO_MEDIA_TYPES = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
}


@router.get("/uploads/{upload_id}/video")
async def upload_video_stream(upload_id: str, request: Request) -> FileResponse:
    upload = await asyncio.to_thread(_manager(request).uploads.load, upload_id)
    media_type = _VIDEO_MEDIA_TYPES.get(upload.path.suffix.lower(), "application/octet-stream")
    return FileResponse(
        upload.path,
        media_type=media_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "Accept-Ranges": "bytes",
        },
    )


def _refresh_cached_transcript(cached: TranscriptResponse) -> TranscriptResponse:
    """Re-apply the current word normalisation to an older cached transcript.

    Cache files persist across releases, so a transcript written before a
    spelling or code-switch fix would otherwise keep serving the old text even
    though the renderer and editor now expect corrected words.
    """

    if not cached.words:
        return cached
    duration = cached.duration or max((item.end for item in cached.words), default=0.0)
    words = normalize_cached_words(
        [Word(start=item.start, end=item.end, text=item.text) for item in cached.words],
        duration,
    )
    cached.words = [
        TranscriptWordOut(start=word.start, end=word.end, text=word.text) for word in words
    ]
    cached.segments = build_caption_segments(words)
    return cached


@router.post("/captions/transcribe", response_model=TranscriptResponse)
async def transcribe_captions(payload: TranscribeRequest, request: Request) -> TranscriptResponse:
    manager = _manager(request)
    settings = _settings(request)
    upload = await asyncio.to_thread(manager.uploads.load, payload.upload_id)
    language_key = payload.language or "auto"
    quality_key = payload.quality or "default"
    # v4 invalidates transcripts produced before speech-coverage repair and the
    # expanded mixed Nepali/English glossary; re-transcribing is required to get
    # the missing clauses and Latin English spellings.
    cache_path = (
        upload.path.parent / f"transcript_v4_{language_key}_{quality_key}_{payload.task}.json"
    )
    if cache_path.exists() and not payload.force:
        try:
            cached = TranscriptResponse.model_validate_json(cache_path.read_text("utf-8"))
            cached = _refresh_cached_transcript(cached)
            cached.cached = True
            return cached
        except (OSError, ValueError):
            logger.warning("caption transcript cache unreadable", extra={"path": str(cache_path)})

    metadata = upload.metadata
    if metadata.has_audio is False:
        return TranscriptResponse(
            upload_id=upload.id,
            duration=metadata.duration,
            segments=[],
            words=[],
            warnings=["The video has no audio track, so no speech could be transcribed."],
        )

    work_dir = upload.path.parent / "transcribe"
    work_dir.mkdir(parents=True, exist_ok=True)
    audio_path = work_dir / "audio.wav"
    if not audio_path.exists():
        await extract_audio(upload.path, audio_path, cancel_event=Event())

    language = payload.language if payload.language not in {None, "auto"} else None
    transcript = await transcribe_audio(
        audio_path,
        metadata.duration,
        settings,
        cancel_event=Event(),
        language=language,
        quality=payload.quality,
        task=payload.task,
    )
    segments = build_caption_segments(transcript.words)
    warnings = list(transcript.warnings)
    if transcript.language == "ne" and language != "ne":
        warnings.append(
            "Nepali was detected, so CutClipper used the Nepali fine-tuned model and Devanagari "
            "captions automatically."
        )
    if not segments:
        warnings.append("No speech was detected in this video. You can add caption lines manually.")
    response = TranscriptResponse(
        upload_id=upload.id,
        duration=metadata.duration,
        language=transcript.language,
        language_probability=transcript.language_probability,
        translated=payload.task == "translate",
        segments=segments,
        words=[
            TranscriptWordOut(start=word.start, end=word.end, text=word.text)
            for word in transcript.words
        ],
        warnings=warnings,
    )
    try:
        cache_path.write_text(response.model_dump_json(), encoding="utf-8")
    except OSError:
        logger.warning("caption transcript cache write failed", extra={"path": str(cache_path)})
    logger.info(
        "caption transcript ready",
        extra={
            "upload_id": upload.id,
            "language": transcript.language,
            "segments": len(segments),
            "words": len(transcript.words),
        },
    )
    return response


@router.post("/captions/translate", response_model=TranslateSegmentsResponse)
async def translate_captions(
    payload: TranslateSegmentsRequest,
    request: Request,
) -> TranslateSegmentsResponse:
    manager = _manager(request)
    settings = _settings(request)
    upload = await asyncio.to_thread(manager.uploads.load, payload.upload_id)
    if upload.metadata.has_audio is False:
        raise AppError(
            "This video has no audio track to translate.",
            code="no_audio",
            status_code=422,
        )
    work_dir = upload.path.parent / "transcribe"
    work_dir.mkdir(parents=True, exist_ok=True)
    audio_path = work_dir / "audio.wav"
    if not audio_path.exists():
        await extract_audio(upload.path, audio_path, cancel_event=Event())
    result = await translate_caption_segments(
        payload.segments,
        audio_path=audio_path,
        duration=upload.metadata.duration,
        settings=settings,
        quality=payload.quality,
        language=payload.language,
        cache_dir=upload.path.parent,
    )
    if not result.segments:
        raise AppError(
            (
                result.warnings[-1]
                if result.warnings
                else "The English translation came back empty. Try re-transcribing the speech."
            ),
            code="translation_empty",
            status_code=422,
            details={"warnings": result.warnings},
        )
    logger.info(
        "caption translation ready",
        extra={
            "upload_id": upload.id,
            "engine": result.engine,
            "language": payload.language,
            "segments": len(result.segments),
        },
    )
    return TranslateSegmentsResponse(
        segments=result.segments,
        source_language=payload.language,
        engine=result.engine,
        warnings=result.warnings,
    )


@router.post("/captions/romanize", response_model=RomanizeSegmentsResponse)
def romanize_captions(payload: RomanizeSegmentsRequest) -> RomanizeSegmentsResponse:
    """Transliterate Nepali caption lines to Roman Nepali for the live editor.

    The same transliterator runs inside the renderer, so the preview, SRT, and
    burned captions agree even after the user edits a line. This is a sync
    route so FastAPI runs it in its worker thread instead of blocking the
    event loop on a long caption list.
    """

    return RomanizeSegmentsResponse(segments=romanize_segments(payload.segments))


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
        record = await manager.create_job(
            None,
            payload.settings,
            upload_id=payload.upload_id,
            mode=payload.mode,
            segments=payload.segments,
            secondary_segments=payload.secondary_segments,
            language=payload.language,
            quality=payload.quality,
            task=payload.task,
        )
    else:
        normalized = await validate_remote_url(payload.url or "")
        record = await manager.create_job(
            normalized,
            payload.settings,
            mode=payload.mode,
            language=payload.language,
            quality=payload.quality,
            task=payload.task,
        )
    return manager.snapshot(record.id)


@router.post("/jobs/{job_id}/restyle", response_model=JobOut, status_code=202)
async def restyle_captions(
    job_id: str,
    payload: RestyleCaptionsRequest,
    request: Request,
) -> JobOut:
    manager = _manager(request)
    record = await manager.create_restyle_job(
        job_id,
        payload.captions,
        segments=payload.segments,
        secondary_segments=payload.secondary_segments,
    )
    return manager.snapshot(record.id)


@router.get("/jobs/{job_id}/captions", response_model=JobCaptionsResponse)
async def job_captions(job_id: str, request: Request) -> JobCaptionsResponse:
    manager = _manager(request)
    duration, segments, words = manager.caption_lines(job_id)
    return JobCaptionsResponse(
        job_id=job_id,
        duration=duration,
        segments=segments,
        words=[TranscriptWordOut(start=word.start, end=word.end, text=word.text) for word in words],
    )


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
