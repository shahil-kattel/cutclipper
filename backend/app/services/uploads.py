"""Local video uploads: streaming storage, probing, and preview artwork."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from fastapi import UploadFile

from app.config import Settings
from app.core.errors import AppError, ProcessingError
from app.schemas import VideoMetadata
from app.services.media import get_media_tools, probe_media_sync
from app.services.process import run_process

logger = logging.getLogger(__name__)

UPLOAD_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
_SUFFIX_PATTERN = re.compile(r"^\.[a-z0-9]{1,6}$")
_CHUNK_SIZE = 1024 * 1024


class UploadNotFoundError(AppError):
    def __init__(self, message: str = "That upload could not be found. Upload your video again."):
        super().__init__(message, code="upload_not_found", status_code=404)


class UploadTooLargeError(AppError):
    def __init__(self, limit_bytes: int) -> None:
        limit_gb = limit_bytes / (1024**3)
        super().__init__(
            f"That file is larger than the {limit_gb:g} GB upload limit.",
            code="file_too_large",
            status_code=413,
        )


@dataclass(slots=True)
class StoredUpload:
    id: str
    path: Path
    thumbnail_path: Path | None
    metadata: VideoMetadata


def _title_from_filename(filename: str) -> str:
    stem = Path(filename or "").stem.replace("_", " ").replace("-", " ").strip()
    title = " ".join(stem.split())
    return title.title()[:500] if title else "Uploaded video"


def _safe_suffix(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    return suffix if _SUFFIX_PATTERN.match(suffix) else ".mp4"


class UploadStore:
    """Filesystem-backed uploads with a per-file metadata sidecar."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.root = settings.uploads_dir

    def ensure(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    def directory(self, upload_id: str) -> Path:
        if not UPLOAD_ID_PATTERN.match(upload_id):
            raise UploadNotFoundError()
        return self.root / upload_id

    async def save(self, upload: UploadFile) -> StoredUpload:
        self.ensure()
        upload_id = uuid.uuid4().hex
        directory = self.root / upload_id
        directory.mkdir(parents=True, exist_ok=False)
        source = directory / f"source{_safe_suffix(upload.filename or '')}"
        try:
            size = await self._stream_to_disk(upload, source)
            if size == 0:
                raise AppError(
                    "That file is empty. Choose a video file with content.",
                    code="empty_upload",
                    status_code=422,
                )
            try:
                media = await asyncio.to_thread(probe_media_sync, str(source), timeout=120)
            except ProcessingError as exc:
                raise AppError(
                    "That file doesn't look like a supported video. Try MP4, MOV, WebM, or MKV.",
                    code="invalid_video",
                    status_code=422,
                    details={"reason": exc.code},
                ) from exc
            if media.duration > self.settings.max_video_duration_seconds:
                maximum_hours = self.settings.max_video_duration_seconds / 3600
                raise AppError(
                    f"This video is {media.duration / 60:.0f} minutes long. CutClipper supports "
                    f"videos up to {maximum_hours:g} hours.",
                    code="video_too_long",
                    status_code=422,
                )

            thumbnail = await self._render_thumbnail(directory, source, media.duration)
            metadata = VideoMetadata(
                title=_title_from_filename(upload.filename or ""),
                duration=round(media.duration, 3),
                thumbnail_url=(
                    f"/api/uploads/{upload_id}/thumbnail" if thumbnail is not None else None
                ),
                uploader=None,
                source="Upload",
                source_url=f"upload://{upload_id}",
                webpage_url=None,
                width=media.width,
                height=media.height,
                fps=round(media.fps, 3),
                has_audio=media.has_audio,
            )
            self._write_meta(directory, upload_id, upload.filename or "", metadata)
            logger.info(
                "upload stored",
                extra={"upload_id": upload_id, "bytes": size, "duration": media.duration},
            )
            return StoredUpload(
                id=upload_id,
                path=source,
                thumbnail_path=thumbnail,
                metadata=metadata,
            )
        except BaseException:
            await asyncio.to_thread(shutil.rmtree, directory, True)
            raise

    def load(self, upload_id: str) -> StoredUpload:
        directory = self.directory(upload_id)
        meta_path = directory / "meta.json"
        source = self._source_file(directory)
        if source is None or not meta_path.exists():
            raise UploadNotFoundError()
        try:
            payload = json.loads(meta_path.read_text(encoding="utf-8"))
            metadata = VideoMetadata.model_validate(payload["video"])
        except (OSError, ValueError, KeyError) as exc:
            logger.warning("upload metadata unreadable", extra={"upload_id": upload_id})
            raise UploadNotFoundError() from exc
        thumbnail = directory / "thumbnail.jpg"
        return StoredUpload(
            id=upload_id,
            path=source,
            thumbnail_path=thumbnail if thumbnail.exists() else None,
            metadata=metadata,
        )

    def thumbnail(self, upload_id: str) -> Path:
        upload = self.load(upload_id)
        if upload.thumbnail_path is None:
            raise UploadNotFoundError("This upload has no preview image.")
        return upload.thumbnail_path

    def cleanup_expired(self, cutoff: datetime, protected: set[str] | None = None) -> int:
        if not self.root.exists():
            return 0
        removed = 0
        for directory in self.root.iterdir():
            if not directory.is_dir() or directory.name in (protected or set()):
                continue
            try:
                modified = datetime.fromtimestamp(directory.stat().st_mtime, UTC)
            except OSError:
                continue
            if modified >= cutoff:
                continue
            shutil.rmtree(directory, ignore_errors=True)
            removed += 1
            logger.info("expired upload removed", extra={"upload_id": directory.name})
        return removed

    async def _stream_to_disk(self, upload: UploadFile, destination: Path) -> int:
        limit = self.settings.max_upload_bytes
        total = 0
        with destination.open("wb") as handle:
            while True:
                chunk = await upload.read(_CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise UploadTooLargeError(limit)
                await asyncio.to_thread(handle.write, chunk)
        return total

    async def _render_thumbnail(
        self, directory: Path, source: Path, duration: float
    ) -> Path | None:
        try:
            tools = get_media_tools(self.settings)
        except ProcessingError:
            return None
        target = directory / "thumbnail.jpg"
        timestamp = min(1.0, max(0.0, duration * 0.1))
        command = [
            tools.ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{timestamp:.3f}",
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-vf",
            "scale=640:-2",
            "-q:v",
            "4",
            str(target),
        ]
        try:
            result = await run_process(command, timeout_seconds=45)
        except Exception:
            logger.warning("upload thumbnail generation failed", exc_info=True)
            return None
        if result.returncode != 0 or not target.exists():
            return None
        return target

    @staticmethod
    def _source_file(directory: Path) -> Path | None:
        try:
            candidates = sorted(directory.glob("source.*"))
        except OSError:
            return None
        return candidates[0] if candidates else None

    @staticmethod
    def _write_meta(
        directory: Path, upload_id: str, filename: str, metadata: VideoMetadata
    ) -> None:
        payload = {
            "id": upload_id,
            "filename": filename,
            "video": metadata.model_dump(mode="json"),
        }
        (directory / "meta.json").write_text(json.dumps(payload), encoding="utf-8")
