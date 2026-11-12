"""Pydantic request, response, and domain-facing models."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.caption_fonts import CAPTION_FONT_NAMES, is_valid_font

HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
CaptionFont = str
CAPTION_FONTS: tuple[str, ...] = CAPTION_FONT_NAMES


class CaptionFontStyle(StrEnum):
    REGULAR = "regular"
    BOLD = "bold"
    ITALIC = "italic"
    BOLD_ITALIC = "bold_italic"


class CaptionTextCase(StrEnum):
    NONE = "none"
    UPPERCASE = "uppercase"
    LOWERCASE = "lowercase"


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
    BOUNCE = "bounce"
    SLIDE = "slide"
    NEON = "neon"
    HIGHLIGHT = "highlight"
    FADE_UP = "fade_up"
    ZOOM_IN = "zoom_in"
    STAMP = "stamp"
    TILT = "tilt"
    SPOTLIGHT = "spotlight"
    UNDERLINE = "underline"
    PULSE = "pulse"
    WIGGLE = "wiggle"
    RAINBOW = "rainbow"
    SOFT_BLUR = "soft_blur"
    BOX = "box"


# Word-play presets follow the spoken word; line-entrance presets move the whole
# caption block. The two groups can be combined freely, so keep them separate.
WORD_PLAY_STYLES: frozenset[CaptionStyle] = frozenset(
    {
        CaptionStyle.KARAOKE,
        CaptionStyle.POP,
        CaptionStyle.BOUNCE,
        CaptionStyle.NEON,
        CaptionStyle.HIGHLIGHT,
        CaptionStyle.SPOTLIGHT,
        CaptionStyle.UNDERLINE,
        CaptionStyle.PULSE,
        CaptionStyle.WIGGLE,
        CaptionStyle.RAINBOW,
        CaptionStyle.BOX,
    }
)
LINE_ENTRANCE_STYLES: frozenset[CaptionStyle] = frozenset(
    {
        CaptionStyle.SLIDE,
        CaptionStyle.FADE_UP,
        CaptionStyle.ZOOM_IN,
        CaptionStyle.STAMP,
        CaptionStyle.TILT,
        CaptionStyle.TYPEWRITER,
        CaptionStyle.SOFT_BLUR,
        CaptionStyle.MINIMAL,
    }
)


class JobMode(StrEnum):
    CLIPS = "clips"
    CAPTIONS = "captions"


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
    JobStage.RENDERING: "Rendering video",
    JobStage.PACKAGING: "Packaging results",
    JobStage.COMPLETE: "Complete",
    JobStage.FAILED: "Failed",
    JobStage.CANCELLED: "Cancelled",
}


class CaptionSettings(BaseModel):
    enabled: bool = True
    word_style: CaptionStyle | None = CaptionStyle.KARAOKE
    line_style: CaptionStyle | None = None
    # Legacy single-style field. Older clients sent `style`; it is still accepted
    # and folded into word_style / line_style, but never written back out.
    style: CaptionStyle | None = Field(default=None, exclude=True)
    font: CaptionFont = "Inter"
    font_style: CaptionFontStyle = CaptionFontStyle.BOLD
    font_size: int = Field(default=80, ge=32, le=160)
    color: HexColor = "#FFFFFF"
    highlight_color: HexColor = "#22D3EE"
    position: CaptionPosition = CaptionPosition.BOTTOM
    outline_width: float = Field(default=3.0, ge=0, le=10)
    shadow: float = Field(default=2.0, ge=0, le=10)
    letter_spacing: float = Field(default=0.0, ge=-5.0, le=20.0)
    word_spacing: float = Field(default=0.0, ge=0.0, le=40.0)
    text_case: CaptionTextCase = CaptionTextCase.NONE

    @field_validator("font")
    @classmethod
    def supported_font(cls, value: str) -> str:
        if not is_valid_font(value):
            raise ValueError("Choose one of the caption fonts offered by CutClipper.")
        return value

    @model_validator(mode="after")
    def resolve_motion_styles(self) -> CaptionSettings:
        declared = self.model_fields_set
        if "word_style" not in declared and "line_style" not in declared and self.style is not None:
            legacy = self.style
            if legacy in WORD_PLAY_STYLES:
                self.word_style = legacy
                self.line_style = None
            else:
                self.word_style = None
                self.line_style = legacy
        if self.word_style is not None and self.word_style not in WORD_PLAY_STYLES:
            raise ValueError("Choose a word-play effect for the word style.")
        if self.line_style is not None and self.line_style not in LINE_ENTRANCE_STYLES:
            raise ValueError("Choose a line-entrance effect for the line style.")
        return self


class CaptionSegment(BaseModel):
    """A user-editable caption line with absolute source timing."""

    start: float = Field(ge=0, le=86_400)
    end: float = Field(ge=0, le=86_400)
    text: str = Field(min_length=1, max_length=1000)

    @field_validator("text")
    @classmethod
    def clean_text(cls, value: str) -> str:
        cleaned = " ".join(value.replace("\r", " ").replace("\n", " ").split()).strip()
        if not cleaned:
            raise ValueError("Caption text cannot be empty.")
        return cleaned

    @model_validator(mode="after")
    def valid_range(self) -> CaptionSegment:
        if self.end <= self.start:
            raise ValueError("Caption end time must be after its start time.")
        return self


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


class RestyleCaptionsRequest(BaseModel):
    captions: CaptionSettings
    title_suffix: str | None = Field(default=None, max_length=80)


class CreateJobRequest(BaseModel):
    url: str | None = Field(default=None, min_length=4, max_length=4096)
    upload_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    settings: ClipSettings = Field(default_factory=ClipSettings)
    mode: JobMode = JobMode.CLIPS
    language: str | None = Field(default=None, pattern=r"^(auto|[a-z]{2,3})$")
    segments: list[CaptionSegment] | None = Field(default=None, max_length=5000)

    @field_validator("url")
    @classmethod
    def strip_url(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @model_validator(mode="after")
    def validate_source_and_mode(self) -> CreateJobRequest:
        if bool(self.url) == bool(self.upload_id):
            raise ValueError("Provide either a video link or an uploaded file.")
        if self.mode == JobMode.CAPTIONS:
            if not self.upload_id:
                raise ValueError("Caption jobs require an uploaded file.")
            if not self.settings.captions.enabled:
                raise ValueError("Captions must be enabled for a caption job.")
            if self.segments is not None:
                ordered = sorted(self.segments, key=lambda segment: segment.start)
                previous_end = -1.0
                for segment in ordered:
                    if segment.start < previous_end - 0.001:
                        raise ValueError("Caption segments must not overlap.")
                    previous_end = segment.end
                self.segments = ordered
        elif self.segments:
            raise ValueError("Caption edits are only supported in caption mode.")
        return self


class TranscribeRequest(BaseModel):
    upload_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    language: str | None = Field(default=None, pattern=r"^(auto|[a-z]{2,3})$")
    quality: Literal["fast", "balanced", "best"] | None = None
    force: bool = False


class TranscriptWordOut(BaseModel):
    start: float
    end: float
    text: str


class TranscriptResponse(BaseModel):
    upload_id: str
    duration: float
    language: str | None = None
    language_probability: float | None = None
    segments: list[CaptionSegment] = Field(default_factory=list)
    words: list[TranscriptWordOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    cached: bool = False


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
    mode: JobMode = JobMode.CLIPS
    clips: list[ClipOut] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = False
    can_cancel: bool = False
    download_all_url: str | None = None
    is_restyle: bool = False
    restyled_from: str | None = None


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
    max_upload_bytes: int
    max_clip_count: int
    supported_aspect_ratios: list[str]
    caption_fonts: list[str]
    caption_styles: list[str]
    transcription_languages: list[dict[str, str]]
    default_settings: ClipSettings
