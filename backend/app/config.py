"""Application configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent


class Settings(BaseSettings):
    """Runtime settings.

    All settings can be overridden with ``CUTCLIPPER_*`` environment variables.
    """

    model_config = SettingsConfigDict(
        env_prefix="CUTCLIPPER_",
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "CutClipper"
    environment: str = "development"
    log_level: str = "INFO"
    log_json: bool = True

    data_dir: Path = Field(default=BACKEND_ROOT / "data")
    assets_dir: Path = Field(default=BACKEND_ROOT / "assets")
    frontend_dist: Path | None = Field(default=PROJECT_ROOT / "frontend" / "dist")

    max_video_duration_seconds: int = Field(default=7200, ge=60)
    max_download_bytes: int = Field(default=3_000_000_000, ge=100_000_000)
    max_upload_bytes: int = Field(default=3_000_000_000, ge=100_000_000)
    job_ttl_seconds: int = Field(default=6 * 3600, ge=600)
    cleanup_interval_seconds: int = Field(default=1800, ge=60)
    max_concurrent_jobs: int = Field(default=1, ge=1, le=4)

    whisper_model: str = "base"
    whisper_device: str = "auto"
    whisper_compute_type: str = "auto"
    whisper_language: str | None = None
    whisper_beam_size: int = Field(default=5, ge=1, le=10)
    whisper_cpu_threads: int = Field(default=0, ge=0)

    ffmpeg_binary: str | None = None
    ffprobe_binary: str | None = None
    video_encoder: str = "auto"
    output_fps: int = Field(default=30, ge=24, le=60)
    output_crf: int = Field(default=20, ge=14, le=30)
    output_bitrate: str = "8M"

    ytdlp_cookies_file: str | None = None
    ytdlp_extra_args: str = ""
    download_timeout_seconds: int = Field(default=900, ge=60)
    preview_timeout_seconds: int = Field(default=90, ge=15)
    render_timeout_seconds: int = Field(default=900, ge=120)

    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
        ]
    )

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def fonts_dir(self) -> Path:
        return self.assets_dir / "fonts"

    def ensure_directories(self) -> None:
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
