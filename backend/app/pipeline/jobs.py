"""In-process job queue, progress state, cleanup, and pipeline orchestration."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import shutil
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from typing import Any

from app.config import Settings
from app.core.errors import (
    AppError,
    ClipNotFoundError,
    JobCancelledError,
    JobNotFoundError,
    ProcessingError,
    SelectionError,
)
from app.core.validation import validate_remote_url
from app.logging_setup import job_id_ctx
from app.pipeline.renderer import ClipRenderer, safe_title_slug
from app.pipeline.selection import select_clips
from app.pipeline.types import Transcript
from app.schemas import (
    STAGE_LABELS,
    ClipOut,
    ClipSettings,
    JobOut,
    JobStage,
    JobStatus,
    VideoMetadata,
)
from app.services.audio import EnergyProfile, analyze_energy, extract_audio
from app.services.downloader import download_video, fetch_metadata
from app.services.media import probe_media
from app.services.scenes import detect_scenes
from app.services.transcriber import transcribe_audio
from app.services.uploads import UploadStore

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = {JobStatus.QUEUED, JobStatus.RUNNING}
TERMINAL_STATUSES = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}


@dataclass(slots=True)
class StoredClip:
    id: str
    index: int
    start: float
    end: float
    score: float
    width: int
    height: int
    filename: str
    video_path: Path
    thumbnail_path: Path
    file_size: int


@dataclass(slots=True)
class JobRecord:
    id: str
    url: str
    settings: ClipSettings
    upload_id: str | None = None
    status: JobStatus = JobStatus.QUEUED
    stage: JobStage = JobStage.QUEUED
    progress: float = 0.0
    message: str = "Queued"
    video: VideoMetadata | None = None
    clips: list[StoredClip] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = False
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    revision: int = 0
    cancel_event: Event = field(default_factory=Event)
    cancel_requested: bool = False
    zip_path: Path | None = None
    source_path: Path | None = None

    @property
    def job_dir(self) -> Path:
        return self.base_dir / self.id

    base_dir: Path = field(default=Path("."))

    @property
    def terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES


@dataclass(slots=True)
class CachedPreview:
    video: VideoMetadata
    expires_at: float


class JobManager:
    """Single-process queue sized for local and small-server deployments."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.settings.ensure_directories()
        self.uploads = UploadStore(settings)
        self.jobs: dict[str, JobRecord] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.workers: list[asyncio.Task[None]] = []
        self.cleanup_task: asyncio.Task[None] | None = None
        self._preview_cache: dict[str, CachedPreview] = {}
        self._stopping = asyncio.Event()

    async def start(self) -> None:
        self.settings.ensure_directories()
        self._stopping.clear()
        self.workers = [
            asyncio.create_task(self._worker(index), name=f"cutclipper-worker-{index}")
            for index in range(self.settings.max_concurrent_jobs)
        ]
        self.cleanup_task = asyncio.create_task(self._cleanup_loop(), name="cutclipper-cleanup")
        await self._cleanup_once()
        logger.info(
            "job manager started",
            extra={"workers": self.settings.max_concurrent_jobs},
        )

    async def stop(self) -> None:
        self._stopping.set()
        for record in self.jobs.values():
            if record.status in ACTIVE_STATUSES:
                record.cancel_event.set()
        for worker in self.workers:
            worker.cancel()
        for worker in self.workers:
            with contextlib.suppress(asyncio.CancelledError):
                await worker
        self.workers.clear()
        if self.cleanup_task:
            self.cleanup_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.cleanup_task
            self.cleanup_task = None

    def cache_preview(self, video: VideoMetadata) -> None:
        self._preview_cache[video.source_url] = CachedPreview(
            video=video,
            expires_at=time.monotonic() + 1800,
        )

    def cached_preview(self, url: str) -> VideoMetadata | None:
        cached = self._preview_cache.get(url)
        if not cached:
            return None
        if cached.expires_at < time.monotonic():
            self._preview_cache.pop(url, None)
            return None
        return cached.video

    async def create_job(
        self,
        url: str | None,
        settings: ClipSettings,
        *,
        upload_id: str | None = None,
    ) -> JobRecord:
        job_id = uuid.uuid4().hex
        video = self.cached_preview(url) if url else None
        if upload_id:
            upload = await asyncio.to_thread(self.uploads.load, upload_id)
            video = upload.metadata
        record = JobRecord(
            id=job_id,
            url=url or (f"upload://{upload_id}" if upload_id else ""),
            settings=settings,
            upload_id=upload_id,
            video=video,
            base_dir=self.settings.jobs_dir,
            message="Queued for processing",
        )
        record.job_dir.mkdir(parents=True, exist_ok=True)
        (record.job_dir / "downloads").mkdir(exist_ok=True)
        (record.job_dir / "work").mkdir(exist_ok=True)
        (record.job_dir / "outputs").mkdir(exist_ok=True)
        self.jobs[job_id] = record
        await self.queue.put(job_id)
        logger.info("job created", extra={"job_id": job_id})
        return record

    def get(self, job_id: str) -> JobRecord:
        record = self.jobs.get(job_id)
        if not record:
            raise JobNotFoundError()
        return record

    def request_cancel(self, job_id: str) -> JobRecord:
        record = self.get(job_id)
        if record.terminal:
            return record
        record.cancel_event.set()
        record.cancel_requested = True
        if record.status == JobStatus.QUEUED:
            record.status = JobStatus.CANCELLED
            record.stage = JobStage.CANCELLED
            record.message = "Cancelled before processing"
            record.updated_at = datetime.now(UTC)
            record.revision += 1
        else:
            record.message = "Cancelling after the current step…"
            record.updated_at = datetime.now(UTC)
            record.revision += 1
        return record

    def snapshot(self, job_id: str) -> JobOut:
        return self._to_out(self.get(job_id))

    async def event_stream(self, job_id: str) -> Any:
        """Yield SSE frames until the job reaches a terminal state."""

        last_revision = -1
        heartbeat_at = time.monotonic()
        while True:
            record = self.get(job_id)
            if record.revision != last_revision:
                last_revision = record.revision
                payload = self._to_out(record).model_dump(mode="json")
                yield f"data: {json.dumps(payload, separators=(',', ':'))}\n\n"
                heartbeat_at = time.monotonic()
            if record.terminal:
                return
            if time.monotonic() - heartbeat_at > 12:
                yield ": keep-alive\n\n"
                heartbeat_at = time.monotonic()
            await asyncio.sleep(0.35)

    def clip(self, job_id: str, clip_id: str) -> StoredClip:
        record = self.get(job_id)
        for clip in record.clips:
            if clip.id == clip_id:
                return clip
        raise ClipNotFoundError()

    def zip_path(self, job_id: str) -> Path:
        record = self.get(job_id)
        if record.status != JobStatus.COMPLETED:
            raise AppError(
                "The download bundle is not ready yet. Wait for the render to finish.",
                code="job_not_ready",
                status_code=409,
            )
        if not record.clips:
            raise JobNotFoundError("This job has no finished clips yet.")
        if record.zip_path and record.zip_path.exists():
            return record.zip_path
        outputs = record.job_dir / "outputs"
        zip_path = outputs / "cutclipper-clips.zip"
        self._build_zip(record.clips, zip_path)
        record.zip_path = zip_path
        return zip_path

    def _build_zip(self, clips: list[StoredClip], destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp_path = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
        try:
            with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_STORED) as archive:
                for clip in clips:
                    if clip.video_path.exists():
                        archive.write(clip.video_path, arcname=clip.filename)
            temp_path.replace(destination)
        finally:
            temp_path.unlink(missing_ok=True)

    def _to_out(self, record: JobRecord) -> JobOut:
        base = f"/api/jobs/{record.id}"
        video = record.video
        if video and video.thumbnail_url and video.thumbnail_url.startswith("data:"):
            # Remote-poster previews are inlined once in /api/preview. Do not
            # re-send hundreds of KB of base64 in every SSE progress frame.
            video = video.model_copy(update={"thumbnail_url": None})
        clips: list[ClipOut] = []
        for clip in record.clips:
            clips.append(
                ClipOut(
                    id=clip.id,
                    index=clip.index,
                    start=clip.start,
                    end=clip.end,
                    duration=round(clip.end - clip.start, 3),
                    score=round(clip.score),
                    width=clip.width,
                    height=clip.height,
                    file_size=clip.file_size,
                    filename=clip.filename,
                    video_url=f"{base}/clips/{clip.id}/video",
                    download_url=f"{base}/clips/{clip.id}/download",
                    thumbnail_url=f"{base}/clips/{clip.id}/thumbnail",
                )
            )
        return JobOut(
            id=record.id,
            status=record.status,
            stage=record.stage,
            stage_label=STAGE_LABELS.get(
                record.stage, record.stage.value.replace("_", " ").title()
            ),
            progress=round(record.progress, 1),
            message=record.message,
            created_at=record.created_at,
            updated_at=record.updated_at,
            video=video,
            settings=record.settings,
            clips=clips,
            warnings=record.warnings,
            error_code=record.error_code,
            error_message=record.error_message,
            retryable=record.retryable,
            can_cancel=record.status in ACTIVE_STATUSES and not record.cancel_requested,
            download_all_url=(
                f"{base}/download.zip"
                if record.clips and record.status == JobStatus.COMPLETED
                else None
            ),
        )

    def _update(
        self,
        record: JobRecord,
        *,
        stage: JobStage | None = None,
        progress: float | None = None,
        message: str | None = None,
        warnings: list[str] | None = None,
    ) -> None:
        if stage is not None:
            record.stage = stage
        if progress is not None and record.status in ACTIVE_STATUSES:
            record.progress = max(record.progress, min(100.0, progress))
        if message is not None:
            record.message = message
        if warnings:
            for warning in warnings:
                if warning not in record.warnings:
                    record.warnings.append(warning)
        record.updated_at = datetime.now(UTC)
        record.revision += 1

    def _finish(self, record: JobRecord, *, message: str) -> None:
        record.status = JobStatus.COMPLETED
        record.stage = JobStage.COMPLETE
        record.progress = 100.0
        record.message = message
        record.error_code = None
        record.error_message = None
        record.updated_at = datetime.now(UTC)
        record.revision += 1

    def _fail(self, record: JobRecord, error: AppError) -> None:
        record.status = JobStatus.FAILED
        record.stage = JobStage.FAILED
        record.error_code = error.code
        record.error_message = error.message
        record.retryable = error.retryable
        record.message = error.message
        record.updated_at = datetime.now(UTC)
        record.revision += 1
        logger.error(
            "job failed",
            extra={
                "job_id": record.id,
                "error_code": error.code,
                "details": error.details,
            },
        )

    def _cancel(self, record: JobRecord) -> None:
        record.status = JobStatus.CANCELLED
        record.stage = JobStage.CANCELLED
        record.message = "Job cancelled"
        record.updated_at = datetime.now(UTC)
        record.revision += 1
        logger.info("job cancelled", extra={"job_id": record.id})

    async def _worker(self, worker_index: int) -> None:
        while not self._stopping.is_set():
            try:
                job_id = await self.queue.get()
            except asyncio.CancelledError:
                return
            try:
                record = self.jobs.get(job_id)
                if not record or record.terminal:
                    continue
                if record.cancel_event.is_set():
                    self._cancel(record)
                    continue
                record.status = JobStatus.RUNNING
                record.stage = JobStage.FETCHING
                record.message = "Starting pipeline"
                record.progress = 1.0
                record.updated_at = datetime.now(UTC)
                record.revision += 1
                token = job_id_ctx.set(record.id)
                try:
                    await self._run_pipeline(record)
                except JobCancelledError:
                    self._cancel(record)
                except AppError as exc:
                    self._fail(record, exc)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.exception("unexpected job failure")
                    self._fail(
                        record,
                        ProcessingError(
                            "Something went wrong while processing this video. "
                            "Try again or use a different link.",
                            details={"error": f"{type(exc).__name__}: {exc}"},
                        ),
                    )
                finally:
                    job_id_ctx.reset(token)
            finally:
                self.queue.task_done()

    def _prepare_upload(self, record: JobRecord, downloads: Path) -> Path:
        """Link (or copy) the uploaded source into the job workspace."""

        if not record.upload_id:
            raise ProcessingError("The uploaded video is unavailable.", code="upload_missing")
        upload = self.uploads.load(record.upload_id)
        target = downloads / f"source{upload.path.suffix}"
        if target.exists():
            return target
        try:
            os.link(upload.path, target)
        except OSError:
            shutil.copyfile(upload.path, target)
        return target

    async def _run_pipeline(self, record: JobRecord) -> None:
        cancel = record.cancel_event
        record.job_dir.mkdir(parents=True, exist_ok=True)
        downloads = record.job_dir / "downloads"
        work = record.job_dir / "work"
        outputs = record.job_dir / "outputs"
        for directory in (downloads, work, outputs):
            directory.mkdir(exist_ok=True)

        if not record.upload_id:
            # Re-resolve immediately before any network fetch. This catches a
            # DNS answer that changed while the job was queued.
            await validate_remote_url(record.url)

        metadata = record.video
        if metadata is None:
            if record.upload_id:
                upload = await asyncio.to_thread(self.uploads.load, record.upload_id)
                metadata = upload.metadata
            else:
                self._update(
                    record,
                    stage=JobStage.FETCHING,
                    progress=3,
                    message="Reading video details",
                )
                metadata = await fetch_metadata(record.url, self.settings)
            record.video = metadata

        if metadata.duration > 0:
            needed = record.settings.clip_count * record.settings.min_clip_seconds
            if metadata.duration < needed - 0.2:
                max_clips = max(1, int(metadata.duration // record.settings.min_clip_seconds))
                raise SelectionError(
                    f"This video is {metadata.duration:.0f}s long. "
                    f"{record.settings.clip_count} clips of at least "
                    f"{record.settings.min_clip_seconds:.0f}s need {needed:.0f}s. "
                    f"Reduce the clip count to {max_clips} or lower the minimum length.",
                    details={"reason": "video_too_short", "max_clips": max_clips},
                )

        if record.upload_id:
            self._update(
                record,
                stage=JobStage.FETCHING,
                progress=4,
                message="Preparing your uploaded video",
            )
            source_path = await asyncio.to_thread(self._prepare_upload, record, downloads)
            self._update(record, progress=22, message="Upload ready to process")
        else:
            self._update(
                record,
                stage=JobStage.FETCHING,
                progress=4,
                message="Downloading video at up to 1080p",
            )

            def download_progress(fraction: float, message: str) -> None:
                self._update(
                    record,
                    stage=JobStage.FETCHING,
                    progress=4 + max(0.0, min(1.0, fraction)) * 18,
                    message=message,
                )

            download = await download_video(
                record.url,
                downloads,
                self.settings,
                cancel_event=cancel,
                on_progress=download_progress,
            )
            source_path = download.path

        record.source_path = source_path
        self._update(
            record,
            stage=JobStage.PROBING,
            progress=23,
            message="Inspecting video streams",
        )
        media = await probe_media(str(source_path))
        if record.video:
            record.video = record.video.model_copy(
                update={
                    "duration": round(media.duration, 3),
                    "width": media.width,
                    "height": media.height,
                    "fps": round(media.fps, 3),
                    "has_audio": media.has_audio,
                }
            )
        else:
            record.video = VideoMetadata(
                title=metadata.title,
                duration=media.duration,
                source_url=record.url,
                width=media.width,
                height=media.height,
                fps=media.fps,
                has_audio=media.has_audio,
            )
        if not media.has_audio:
            self._update(
                record,
                warnings=[
                    "The video has no audio track. Clips will be visual-only and captions are unavailable."
                ],
            )

        transcript = Transcript(duration=media.duration)
        energy: EnergyProfile | None = None
        audio_path: Path | None = None
        if media.has_audio:
            self._update(
                record,
                stage=JobStage.TRANSCRIBING,
                progress=26,
                message="Extracting audio for speech analysis",
            )
            try:
                audio_path = await extract_audio(
                    source_path,
                    work / "audio.wav",
                    cancel_event=cancel,
                )
                self._update(
                    record,
                    progress=27,
                    message=f"Transcribing with Whisper ({self.settings.whisper_model})",
                )

                def transcription_progress(fraction: float, message: str) -> None:
                    self._update(
                        record,
                        stage=JobStage.TRANSCRIBING,
                        progress=27 + max(0.0, min(1.0, fraction)) * 22,
                        message=message,
                    )

                transcript = await transcribe_audio(
                    audio_path,
                    media.duration,
                    self.settings,
                    cancel_event=cancel,
                    on_progress=transcription_progress,
                )
                self._update(
                    record,
                    progress=50,
                    message="Speech transcription complete",
                    warnings=transcript.warnings,
                )
            except JobCancelledError:
                raise
            except Exception as exc:
                logger.exception("transcription failed")
                if record.settings.captions.enabled:
                    if isinstance(exc, AppError):
                        raise
                    raise ProcessingError(
                        "Speech transcription failed, so animated captions could not be "
                        "generated. Turn captions off to process without them.",
                        code="transcription_failed",
                        retryable=True,
                        details={"error": str(exc)},
                    ) from exc
                transcript = Transcript(duration=media.duration)
                self._update(
                    record,
                    progress=50,
                    message="Speech unavailable · using visual and audio cues",
                    warnings=[
                        "Speech transcription was unavailable. Highlights were chosen from "
                        "audio energy and scene changes."
                    ],
                )
        else:
            self._update(record, progress=50, message="No audio · skipping transcription")

        self._update(
            record,
            stage=JobStage.FINDING_HIGHLIGHTS,
            progress=52,
            message="Analyzing scenes, audio energy, and sentence boundaries",
        )
        scene_task = asyncio.create_task(detect_scenes(source_path, work, cancel_event=cancel))
        energy_task: asyncio.Task[EnergyProfile] | None = None
        if audio_path is not None:
            energy_task = asyncio.create_task(analyze_energy(audio_path))
        try:
            scenes = await scene_task
            if energy_task is not None:
                try:
                    energy = await energy_task
                except JobCancelledError:
                    raise
                except Exception as exc:
                    logger.warning("audio energy analysis failed", extra={"error": str(exc)})
                    energy = None
                    self._update(
                        record,
                        warnings=[
                            "Audio energy analysis was unavailable; highlights were scored "
                            "with the remaining signals."
                        ],
                    )
        finally:
            for task in (scene_task, energy_task):
                if task is not None and not task.done():
                    task.cancel()
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await task
        for warning in scenes.warnings:
            self._update(record, warnings=[warning])

        selection = select_clips(
            duration=media.duration,
            settings=record.settings,
            transcript=transcript,
            scenes=scenes.cuts,
            energy=energy,
        )
        for warning in selection.warnings:
            self._update(record, warnings=[warning])
        self._update(
            record,
            progress=60,
            message=f"Found {len(selection.clips)} highlights",
        )

        renderer = ClipRenderer(
            source=source_path,
            media=media,
            settings=self.settings,
            clip_settings=record.settings,
            work_dir=work,
            output_dir=outputs,
            cancel_event=cancel,
        )
        title_slug = safe_title_slug(metadata.title)
        clip_count = len(selection.clips)
        render_span = 35.0  # progress points 61..96

        for index, plan in enumerate(selection.clips, start=1):
            if cancel.is_set():
                raise JobCancelledError()
            clip_index_zero = index - 1
            base_fraction = clip_index_zero / clip_count

            def on_stage(
                stage: JobStage,
                message: str,
                clip_fraction: float,
                *,
                index: int = index,
                base_fraction: float = base_fraction,
            ) -> None:
                overall = 61 + (base_fraction + clip_fraction / clip_count) * render_span
                self._update(
                    record,
                    stage=stage,
                    progress=overall,
                    message=f"{message} · {index} of {clip_count}",
                )

            def on_progress(
                clip_fraction: float,
                *,
                base_fraction: float = base_fraction,
            ) -> None:
                overall = 61 + (base_fraction + clip_fraction / clip_count) * render_span
                self._update(
                    record,
                    stage=JobStage.RENDERING,
                    progress=overall,
                )

            try:
                rendered = await renderer.render(
                    plan,
                    index,
                    transcript,
                    on_stage=on_stage,
                    on_progress=on_progress,
                    title_slug=title_slug,
                )
            except JobCancelledError:
                raise
            clip = StoredClip(
                id=f"{index:02d}",
                index=index,
                start=plan.start,
                end=plan.end,
                score=plan.score,
                width=rendered.width,
                height=rendered.height,
                filename=rendered.filename,
                video_path=rendered.video_path,
                thumbnail_path=rendered.thumbnail_path,
                file_size=rendered.video_path.stat().st_size,
            )
            record.clips.append(clip)
            if record.zip_path:
                record.zip_path.unlink(missing_ok=True)
                record.zip_path = None
            if rendered.warnings:
                self._update(record, warnings=rendered.warnings)
            self._update(
                record,
                progress=61 + (index / clip_count) * render_span,
                message=f"Clip {index} of {clip_count} rendered",
            )

        if cancel.is_set():
            raise JobCancelledError()
        self._update(
            record,
            stage=JobStage.PACKAGING,
            progress=97,
            message="Packaging downloads",
        )
        try:
            zip_path = outputs / "cutclipper-clips.zip"
            zip_path.unlink(missing_ok=True)
            await asyncio.to_thread(self._build_zip, record.clips, zip_path)
            record.zip_path = zip_path
        except Exception as exc:
            record.zip_path = None
            logger.warning("zip prebuild failed", extra={"error": str(exc)})
        self._update(
            record,
            stage=JobStage.COMPLETE,
            progress=100,
            message=f"Ready · {len(record.clips)} clips rendered",
        )
        self._finish(record, message=f"Ready · {len(record.clips)} clips rendered")
        logger.info(
            "job complete",
            extra={"clips": len(record.clips), "duration": media.duration},
        )

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(self.settings.cleanup_interval_seconds)
            try:
                await self._cleanup_once()
            except Exception:
                logger.exception("job cleanup failed")

    async def _cleanup_once(self) -> None:
        cutoff = datetime.now(UTC) - timedelta(seconds=self.settings.job_ttl_seconds)
        expired_ids = [
            job_id
            for job_id, record in self.jobs.items()
            if record.status not in ACTIVE_STATUSES and record.updated_at < cutoff
        ]
        for job_id in expired_ids:
            record = self.jobs.pop(job_id, None)
            if record is not None:
                await asyncio.to_thread(shutil.rmtree, record.job_dir, True)
                logger.info("expired job removed", extra={"job_id": job_id})

        for source_url, cached in list(self._preview_cache.items()):
            if cached.expires_at < time.monotonic():
                self._preview_cache.pop(source_url, None)

        known = set(self.jobs)
        orphaned = await asyncio.to_thread(self._expired_orphan_dirs, cutoff, known)
        for directory in orphaned:
            await asyncio.to_thread(shutil.rmtree, directory, True)
            logger.info("orphaned job directory removed", extra={"directory": directory.name})

        active_uploads = {
            record.upload_id
            for record in self.jobs.values()
            if record.upload_id and record.status in ACTIVE_STATUSES
        }
        try:
            await asyncio.to_thread(self.uploads.cleanup_expired, cutoff, active_uploads)
        except Exception:
            logger.exception("upload cleanup failed")

    def _expired_orphan_dirs(self, cutoff: datetime, known: set[str]) -> list[Path]:
        expired: list[Path] = []
        if not self.settings.jobs_dir.exists():
            return expired
        for directory in self.settings.jobs_dir.iterdir():
            if not directory.is_dir() or directory.name in known:
                continue
            try:
                modified = datetime.fromtimestamp(directory.stat().st_mtime, UTC)
            except OSError:
                continue
            if modified < cutoff:
                expired.append(directory)
        return expired
