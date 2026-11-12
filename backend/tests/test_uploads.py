from __future__ import annotations

import io
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import UploadFile

from app.config import Settings
from app.core.errors import AppError, ProcessingError
from app.services.media import get_media_tools
from app.services.uploads import UploadStore


@pytest.fixture
def sample_bytes() -> bytes:
    return (Path(__file__).parent / "assets" / "sample-speech.mp4").read_bytes()


@pytest.fixture
def store(tmp_path: Path) -> UploadStore:
    try:
        get_media_tools()
    except ProcessingError:
        pytest.skip("FFmpeg is required for upload validation tests")
    settings = Settings(data_dir=tmp_path / "data", max_video_duration_seconds=7200)
    settings.ensure_directories()
    return UploadStore(settings)


async def test_upload_store_validates_persists_and_cleans_up(
    store: UploadStore, sample_bytes: bytes
) -> None:
    upload_file = UploadFile(
        file=io.BytesIO(sample_bytes),
        filename="sample-speech.mp4",
        size=len(sample_bytes),
    )
    stored = await store.save(upload_file)
    await upload_file.close()

    assert stored.id
    assert stored.path.exists()
    assert stored.path.stat().st_size == len(sample_bytes)
    assert stored.thumbnail_path is not None and stored.thumbnail_path.exists()
    assert stored.metadata.source == "Upload"
    assert stored.metadata.title == "Sample Speech"
    assert stored.metadata.duration > 10
    assert stored.metadata.has_audio is True

    loaded = store.load(stored.id)
    assert loaded.metadata.duration == stored.metadata.duration
    assert loaded.path == stored.path
    assert store.thumbnail(stored.id).exists()

    expired = datetime.now(UTC) - timedelta(hours=12)
    stamp = expired.timestamp() - 60
    for directory in store.root.iterdir():
        os.utime(directory, (stamp, stamp))
    protected = store.cleanup_expired(expired, {stored.id})
    assert protected == 0
    assert store.directory(stored.id).exists()

    removed = store.cleanup_expired(expired, set())
    assert removed == 1
    assert not store.directory(stored.id).exists()


async def test_upload_store_rejects_non_video_and_removes_partial_directory(
    store: UploadStore,
) -> None:
    upload_file = UploadFile(
        file=io.BytesIO(b"this is not a video"),
        filename="notes.mp4",
        size=17,
    )
    with pytest.raises(AppError, match="supported video"):
        await store.save(upload_file)
    await upload_file.close()
    assert not store.root.exists() or not any(store.root.iterdir())


async def test_upload_store_rejects_empty_file(store: UploadStore) -> None:
    upload_file = UploadFile(file=io.BytesIO(b""), filename="empty.mp4", size=0)
    with pytest.raises(AppError, match="empty"):
        await store.save(upload_file)
    await upload_file.close()
    assert not store.root.exists() or not any(store.root.iterdir())
