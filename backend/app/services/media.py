"""FFmpeg discovery, media probing, and encoder selection."""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.config import Settings, get_settings
from app.core.errors import ProcessingError

logger = logging.getLogger(__name__)

_FFMPEG_CANDIDATES = (
    "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
    "/usr/local/opt/ffmpeg-full/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
)


@dataclass(frozen=True, slots=True)
class MediaTools:
    ffmpeg: str
    ffprobe: str
    has_libass: bool
    video_encoder: str


@dataclass(slots=True)
class MediaInfo:
    duration: float
    width: int
    height: int
    fps: float
    has_audio: bool
    has_video: bool
    video_codec: str | None = None
    audio_codec: str | None = None
    rotation: int = 0
    bitrate: int | None = None


def _ffmpeg_supports_ass(binary: str) -> bool:
    try:
        result = subprocess.run(
            [binary, "-hide_banner", "-filters"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    names = set()
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 3:
            names.add(parts[1])
    return "ass" in names and "subtitles" in names


def _encoder_names(binary: str) -> set[str]:
    try:
        result = subprocess.run(
            [binary, "-hide_banner", "-encoders"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return set()
    names: set[str] = set()
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].startswith("V"):
            names.add(parts[1])
    return names


def _select_encoder(encoders: set[str], configured: str) -> str:
    if configured != "auto":
        if configured in encoders:
            return configured
        logger.warning("Configured encoder %s is unavailable; falling back to libx264", configured)
    if sys.platform == "darwin" and "h264_videotoolbox" in encoders:
        return "h264_videotoolbox"
    if "h264_nvenc" in encoders and shutil.which("nvidia-smi"):
        return "h264_nvenc"
    if "libx264" in encoders:
        return "libx264"
    # Extremely minimal FFmpeg builds may only expose a hardware encoder.
    for candidate in ("h264_videotoolbox", "h264_nvenc"):
        if candidate in encoders:
            return candidate
    raise ProcessingError(
        "FFmpeg has no H.264 encoder. Install FFmpeg with libx264.",
        code="encoder_missing",
    )


@lru_cache
def _discover_tools(
    configured_ffmpeg: str | None,
    configured_ffprobe: str | None,
    configured_encoder: str,
) -> MediaTools:
    candidates: list[str] = []
    if configured_ffmpeg:
        candidates.append(configured_ffmpeg)
    candidates.extend(_FFMPEG_CANDIDATES)
    discovered = shutil.which("ffmpeg")
    if discovered:
        candidates.append(discovered)

    chosen: str | None = None
    chosen_has_ass = False
    for candidate in dict.fromkeys(candidates):
        if not Path(candidate).exists() and not shutil.which(candidate):
            continue
        # Prefer a build with libass. Plain FFmpeg still works when captions are off.
        has_ass = _ffmpeg_supports_ass(candidate)
        if chosen is None or (has_ass and not chosen_has_ass):
            chosen, chosen_has_ass = candidate, has_ass
        if has_ass and not configured_ffmpeg:
            break

    if not chosen:
        raise ProcessingError(
            "FFmpeg is not installed. Install it and restart CutClipper.",
            code="ffmpeg_missing",
        )

    ffprobe_candidate: str | None = None
    if configured_ffprobe:
        ffprobe_candidate = configured_ffprobe
    else:
        sibling = Path(chosen).with_name("ffprobe")
        ffprobe_candidate = str(sibling) if sibling.exists() else shutil.which("ffprobe")
    if not ffprobe_candidate or (
        not Path(ffprobe_candidate).exists() and not shutil.which(ffprobe_candidate)
    ):
        raise ProcessingError(
            "ffprobe was not found alongside FFmpeg.",
            code="ffprobe_missing",
        )

    encoders = _encoder_names(chosen)
    selected_encoder = _select_encoder(encoders, configured_encoder)
    tools = MediaTools(
        ffmpeg=chosen,
        ffprobe=ffprobe_candidate,
        has_libass=chosen_has_ass,
        video_encoder=selected_encoder,
    )
    logger.info(
        "media tools discovered",
        extra={
            "ffmpeg": tools.ffmpeg,
            "ffprobe": tools.ffprobe,
            "libass": tools.has_libass,
            "encoder": tools.video_encoder,
        },
    )
    return tools


def get_media_tools(settings: Settings | None = None) -> MediaTools:
    settings = settings or get_settings()
    return _discover_tools(
        settings.ffmpeg_binary,
        settings.ffprobe_binary,
        settings.video_encoder,
    )


def _parse_rate(value: str | None) -> float:
    if not value or value in {"0/0", "N/A"}:
        return 0.0
    if "/" in value:
        numerator, _, denominator = value.partition("/")
        try:
            denominator_float = float(denominator)
            return float(numerator) / denominator_float if denominator_float else 0.0
        except ValueError:
            return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def _rotation_from_stream(stream: dict[str, Any]) -> int:
    for side_data in stream.get("side_data_list", []):
        if "rotation" in side_data:
            try:
                return round(float(side_data["rotation"]))
            except (TypeError, ValueError):
                pass
    tags = stream.get("tags") or {}
    if "rotate" in tags:
        try:
            return round(float(tags["rotate"]))
        except (TypeError, ValueError):
            pass
    return 0


def probe_media_sync(
    path_or_url: str,
    *,
    ffprobe: str | None = None,
    timeout: int = 45,
    user_agent: str | None = None,
    max_redirects: int | None = None,
) -> MediaInfo:
    tools = get_media_tools() if ffprobe is None else None
    ffprobe_bin = ffprobe or (tools.ffprobe if tools else "ffprobe")
    command = [
        ffprobe_bin,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
    ]
    if user_agent:
        command.extend(["-user_agent", user_agent])
    if max_redirects is not None:
        command.extend(["-max_redirects", str(max_redirects)])
    command.extend(["-i", path_or_url])
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout, check=False
        )
    except subprocess.TimeoutExpired as exc:
        raise ProcessingError(
            "Inspecting the video timed out.", code="probe_timeout", retryable=True
        ) from exc
    except OSError as exc:
        raise ProcessingError(
            "FFprobe could not be started.", code="ffprobe_failed", details={"error": str(exc)}
        ) from exc
    if result.returncode != 0:
        detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else ""
        raise ProcessingError(
            "The video file could not be read. It may be incomplete or use an unsupported codec.",
            code="probe_failed",
            details={"stderr": detail},
        )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ProcessingError("FFprobe returned invalid metadata.", code="probe_invalid") from exc

    streams = payload.get("streams", [])
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not video_stream:
        raise ProcessingError("That link does not contain a video stream.", code="no_video_stream")

    rotation = _rotation_from_stream(video_stream)
    width = int(video_stream.get("width") or 0)
    height = int(video_stream.get("height") or 0)
    if abs(rotation) in {90, 270}:
        width, height = height, width
    if width <= 0 or height <= 0:
        raise ProcessingError("The video dimensions are invalid.", code="invalid_dimensions")

    duration_raw = payload.get("format", {}).get("duration") or video_stream.get("duration")
    try:
        duration = float(duration_raw or 0)
    except (TypeError, ValueError):
        duration = 0.0
    if duration <= 0:
        raise ProcessingError(
            "The video duration could not be determined. Live streams are not supported.",
            code="unknown_duration",
        )

    fps = _parse_rate(video_stream.get("avg_frame_rate")) or _parse_rate(
        video_stream.get("r_frame_rate")
    )
    bitrate_raw = payload.get("format", {}).get("bit_rate")
    try:
        bitrate = int(bitrate_raw) if bitrate_raw else None
    except (TypeError, ValueError):
        bitrate = None

    return MediaInfo(
        duration=duration,
        width=width,
        height=height,
        fps=fps or 30.0,
        has_audio=audio_stream is not None,
        has_video=True,
        video_codec=video_stream.get("codec_name"),
        audio_codec=audio_stream.get("codec_name") if audio_stream else None,
        rotation=rotation,
        bitrate=bitrate,
    )


async def probe_media(path: str, *, timeout: int = 45, user_agent: str | None = None) -> MediaInfo:
    import asyncio

    return await asyncio.to_thread(probe_media_sync, path, timeout=timeout, user_agent=user_agent)


def encoder_args(tools: MediaTools, settings: Settings) -> list[str]:
    if tools.video_encoder == "h264_videotoolbox":
        return [
            "-c:v",
            "h264_videotoolbox",
            "-b:v",
            settings.output_bitrate,
            "-maxrate",
            settings.output_bitrate,
            "-bufsize",
            "16M",
            "-allow_sw",
            "1",
            "-profile:v",
            "high",
        ]
    if tools.video_encoder == "h264_nvenc":
        return [
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p5",
            "-rc",
            "vbr",
            "-cq",
            str(settings.output_crf),
            "-b:v",
            settings.output_bitrate,
            "-maxrate",
            settings.output_bitrate,
            "-bufsize",
            "16M",
            "-profile:v",
            "high",
        ]
    return [
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        str(settings.output_crf),
        "-profile:v",
        "high",
        "-level",
        "4.1",
        "-tune",
        "film",
    ]


def escape_filter_path(path: str) -> str:
    """Escape a path for use inside an FFmpeg filter option.

    Note that FFmpeg's quoting rules cannot represent an apostrophe inside a
    quoted filter value. Callers should keep filter paths relative to the
    render working directory (see :func:`filter_fonts_dir`) so user-controlled
    installation paths never reach the filtergraph.
    """

    return path.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")


def filter_fonts_dir(work_dir: Path, fonts_dir: Path) -> Path:
    """Expose the bundled fonts inside the render cwd for safe filter paths.

    A symlink keeps the filtergraph reference ASCII-only (``caption-fonts``)
    even when the app lives under a path containing an apostrophe, which
    FFmpeg cannot escape inside ``ass=filename='…'``.
    """

    link = work_dir / "caption-fonts"
    if link.exists() or link.is_symlink():
        return link
    try:
        os.symlink(fonts_dir, link, target_is_directory=True)
    except OSError:
        return fonts_dir
    return link


def filter_relative_path(path: Path, work_dir: Path) -> str:
    """Render a filter path relative to the FFmpeg working directory."""

    try:
        return os.path.relpath(path, work_dir)
    except (OSError, ValueError):
        return str(path)


def probe_output_sync(path: Path) -> dict[str, Any]:
    tools = get_media_tools()
    command = [
        tools.ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,codec_name,pix_fmt:format=duration",
        "-of",
        "json",
        str(path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=30, check=False)
    if result.returncode != 0:
        raise ProcessingError("The rendered clip could not be verified.", code="output_invalid")
    return json.loads(result.stdout)
