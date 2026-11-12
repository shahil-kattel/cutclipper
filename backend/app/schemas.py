"""Pydantic request, response, and domain-facing models."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
CaptionFont = Literal["Inter", "Arial", "Georgia", "DejaVu Sans"]


class ClipSelectionMode(StrEnum):
    AUTO = "auto"
    EVEN = "even"


class AspectRatio(StrEnum):
    VERTICAL = "9:16"
    SQUARE = "1:1"
    PORTRAIT = "4:5"


class ReframeMode(StrEnum):
    SMART = "smart"
    CENTER = "center"
    BLUR = "blur"


class CaptionStyle(StrEnum):
    KARAOKE = "karaoke"
    POP = "pop"
    TYPEWRITER = "typewriter"
    MINIMAL = "minimal"


class CaptionPosition(StrEnum):
    TOP = "top"
    MIDDLE = "middle"
    BOTTOM = "bottom"


class TransitionStyle(StrEnum):
    FADE = "fade"
    ZOOM = "zoom"
    SLIDE = "slide"
    WHIP_PAN = "whip_pan"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobStage(StrEnum):
    QUEUED = "queued"
    FETCHING = "fetching"
    PROBING = "probing"
    TRANSCRIBING = "transcribing"
    FINDING_HIGHLIGHTS = "finding_highlights"
    REFRAMING = "reframing"
    CAPTIONING = "captioning"
    RENDERING = "rendering"
    PACKAGING = "packaging"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"


STAGE_LABELS: dict[JobStage, str] = {
    JobStage.QUEUED: "Waiting for a worker",
    JobStage.FETCHING: "Preparing video",
    JobStage.PROBING: "Inspecting media",
    JobStage.TRANSCRIBING: "Transcribing speech",
    JobStage.FINDING_HIGHLIGHTS: "Finding highlights",
    JobStage.REFRAMING: "Reframing shots",
    JobStage.CAPTIONING: "Building captions",
    JobStage.RENDERING: "Rendering clips",
    JobStage.PACKAGING: "Packaging results",
    JobStage.COMPLETE: "Complete",
    JobStage.FAILED: "Failed",
    JobStage.CANCELLED: "Cancelled",
}


class CaptionSettings(BaseModel):
    enabled: bool = True
    style: CaptionStyle = CaptionStyle.KARAOKE
    font: CaptionFont = "Inter"
    font_size: int = Field(default=80, ge=32, le=120)
    color: HexColor = "#FFFFFF"
    highlight_color: HexColor = "#22D3EE"
    position: CaptionPosition = CaptionPosition.BOTTOM
    outline_width: float = Field(default=3.0, ge=0, le=10)
    shadow: float = Field(default=2.0, ge=0, le=10)


class TransitionSettings(BaseModel):
    enabled: bool = True
    style: TransitionStyle = TransitionStyle.FADE
    duration: float = Field(default=0.5, ge=0.2, le=2.0)


class ClipSettings(BaseModel):
    clip_count: int = Field(default=5, ge=1, le=20)
    min_clip_seconds: float = Field(default=15, ge=5, le=180)
    max_clip_seconds: float = Field(default=60, ge=5, le=180)
    selection_mode: ClipSelectionMode = ClipSelectionMode.AUTO
    aspect_ratio: AspectRatio = AspectRatio.VERTICAL
    reframe_mode: ReframeMode = ReframeMode.SMART
    captions: CaptionSettings = Field(default_factory=CaptionSettings)
    transitions: TransitionSettings = Field(default_factory=TransitionSettings)

    @model_validator(mode="after")
    def validate_length_range(self) -> ClipSettings:
        if self.min_clip_seconds > self.max_clip_seconds:
            raise ValueError("Minimum clip length must not exceed maximum clip length.")
        return self


class PreviewRequest(BaseModel):
    url: str = Field(min_length=4, max_length=4096)

    @field_validator("url")
    @classmethod
    def strip_url(cls, value: str) -> str:
        return value.strip()


class CreateJobRequest(BaseModel):
    url: str | None = Field(default=None, min_length=4, max_length=4096)
    upload_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    settings: ClipSettings = Field(default_factory=ClipSettings)

    @field_validator("url")
    @classmethod
    def strip_url(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @model_validator(mode="after")
    def exactly_one_source(self) -> CreateJobRequest:
        if bool(self.url) == bool(self.upload_id):
            raise ValueError("Provide either a video link or an uploaded file.")
        return self


class VideoMetadata(BaseModel):
    title: str
    duration: float = Field(ge=0)
    thumbnail_url: str | None = None
    uploader: str | None = None
    source: str | None = None
    source_url: str
    webpage_url: str | None = None
    width: int | None = None
    height: int | None = None
    fps: float | None = None
    has_audio: bool | None = None


class ClipOut(BaseModel):
    id: str
    index: int
    start: float
    end: float
    duration: float
    score: int = Field(ge=0, le=100)
    width: int
    height: int
    file_size: int
    filename: str
    video_url: str
    download_url: str
    thumbnail_url: str


class JobOut(BaseModel):
    id: str
    status: JobStatus
    stage: JobStage
    stage_label: str
    progress: float = Field(ge=0, le=100)
    message: str
    created_at: datetime
    updated_at: datetime
    video: VideoMetadata | None = None
    settings: ClipSettings
    clips: list[ClipOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = False
    can_cancel: bool = False
    download_all_url: str | None = None


class PreviewResponse(VideoMetadata):
    normalized_url: str = ""
    upload_id: str | None = None


class ErrorBody(BaseModel):
    code: str
    message: str
    retryable: bool = False
    details: dict = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    error: ErrorBody


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    ffmpeg: bool
    ffmpeg_path: str | None
    libass: bool
    whisper_model: str
    active_jobs: int


class JobAccepted(BaseModel):
    id: str
    status: JobStatus
    job: JobOut


class JobList(BaseModel):
    jobs: list[JobOut]


class ApiConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_video_duration_seconds: int
    max_clip_count: int
    supported_aspect_ratios: list[str]
    default_settings: ClipSettings
