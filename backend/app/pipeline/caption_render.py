"""Render a full-length captioned video without clipping or reframing."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event

from app.config import Settings
from app.core.errors import JobCancelledError, ProcessingError
from app.pipeline.captions import build_ass
from app.pipeline.types import Word
from app.schemas import CaptionSettings, ExportResolution
from app.services.media import (
    MediaInfo,
    MediaTools,
    audio_bitrate_for,
    encoder_args,
    escape_filter_path,
    filter_fonts_dir,
    filter_relative_path,
    get_media_tools,
    probe_output_sync,
)
from app.services.process import run_process

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class RenderedCaption:
    video_path: Path
    thumbnail_path: Path
    width: int
    height: int
    filename: str
    event_count: int
    warnings: list[str] = field(default_factory=list)


def _even(value: int) -> int:
    return max(2, value - value % 2)


async def _thumbnail(
    video_path: Path,
    thumbnail_path: Path,
    duration: float,
    tools: MediaTools,
    cancel_event: Event,
    seek: float | None = None,
) -> None:
    duration = max(0.0, duration)
    target = seek if seek is not None else duration * 0.18
    # Keep a minimum seek only when the video is long enough to have one; a
    # sub-second upload has no frame at 0.4s.
    floor = 0.4 if duration > 0.6 else 0.0
    target = min(max(floor, target), max(0.0, duration - 0.05))

    for attempt_target in dict.fromkeys((target, 0.0)):
        command = [
            tools.ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{attempt_target:.3f}",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            "-vf",
            "scale=540:-2",
            "-q:v",
            "4",
            str(thumbnail_path),
        ]
        result = await run_process(command, cancel_event=cancel_event, timeout_seconds=60)
        if result.returncode == 0 and thumbnail_path.exists() and thumbnail_path.stat().st_size > 0:
            return
    raise ProcessingError(
        "The captioned video rendered, but its preview image could not be created.",
        code="thumbnail_failed",
        retryable=True,
    )


def _build_command(
    *,
    tools: MediaTools,
    settings: Settings,
    source: Path,
    output_path: Path,
    ass_path: Path,
    media: MediaInfo,
    width: int,
    height: int,
    work_dir: Path,
    quality: str,
) -> list[str]:
    # Relative references keep apostrophes in installation paths out of the
    # quoted filtergraph value; the command runs with cwd=work_dir.
    fonts_dir = filter_fonts_dir(work_dir, settings.fonts_dir)
    escaped_ass = escape_filter_path(filter_relative_path(ass_path, work_dir))
    escaped_fonts = escape_filter_path(filter_relative_path(fonts_dir, work_dir))
    filter_complex = (
        f"[0:v]scale={width}:{height}:flags=lanczos,setsar=1,"
        f"ass=filename='{escaped_ass}':fontsdir='{escaped_fonts}',"
        f"format=yuv420p[vout]"
    )
    command = [
        tools.ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-filter_complex",
        filter_complex,
        "-map",
        "[vout]",
    ]
    if media.has_audio:
        command.extend(
            [
                "-map",
                "0:a:0?",
                "-c:a",
                "aac",
                "-b:a",
                audio_bitrate_for(quality),
                "-ar",
                "48000",
                "-ac",
                "2",
            ]
        )
    else:
        command.append("-an")
    command.extend(encoder_args(tools, settings, width=width, height=height, quality=quality))
    command.extend(
        [
            "-pix_fmt",
            "yuv420p",
            "-t",
            f"{media.duration:.3f}",
            "-movflags",
            "+faststart",
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-progress",
            "pipe:1",
            "-nostats",
            str(output_path),
        ]
    )
    return command


async def render_captioned_video(
    *,
    source: Path,
    media: MediaInfo,
    settings: Settings,
    captions: CaptionSettings,
    words: list[Word],
    title_slug: str,
    work_dir: Path,
    output_dir: Path,
    cancel_event: Event,
    on_progress: Callable[[float], None],
    resolution: ExportResolution = ExportResolution.HD,
    quality: str = "high",
) -> RenderedCaption:
    """Burn captions onto the full source video while preserving its aspect ratio."""

    tools = get_media_tools(settings)
    if not tools.has_libass:
        raise ProcessingError(
            "Captions require an FFmpeg build with libass. Install FFmpeg with libass "
            "(for example, ffmpeg-full) and restart.",
            code="libass_missing",
        )

    width, height = _even(media.width), _even(media.height)
    if resolution == ExportResolution.UHD_4K:
        # Preserve the source aspect ratio and only ever upscale: exporting a
        # 4K source at the default setting must not quietly downscale it.
        upscale = max(1.0, 2160 / max(1, min(width, height)))
        width = _even(round(width * upscale))
        height = _even(round(height * upscale))
    render_timeout = settings.render_timeout_seconds * (2 if max(width, height) >= 2160 else 1)
    ass_path = work_dir / "captions" / "full.ass"
    caption_result = build_ass(
        words,
        clip_start=0.0,
        clip_duration=media.duration,
        settings=captions,
        output_size=(width, height),
        output_path=ass_path,
    )
    if caption_result.event_count == 0:
        raise ProcessingError(
            "There was no caption text to render. Transcribe the video or add caption lines.",
            code="empty_captions",
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "captioned.mp4"
    thumbnail_path = output_dir / "thumb_01.jpg"
    on_progress(0.02)

    def handle_progress_line(line: str) -> None:
        if not line.startswith("out_time_"):
            return
        _, _, raw = line.partition("=")
        try:
            microseconds = float(raw)
        except ValueError:
            return
        fraction = max(0.0, min(1.0, microseconds / 1_000_000 / max(0.1, media.duration)))
        on_progress(fraction)

    warnings: list[str] = []
    command = _build_command(
        tools=tools,
        settings=settings,
        source=source,
        output_path=output_path,
        ass_path=ass_path,
        media=media,
        width=width,
        height=height,
        work_dir=work_dir,
        quality=quality,
    )
    try:
        result = await run_process(
            command,
            cancel_event=cancel_event,
            timeout_seconds=render_timeout,
            cwd=work_dir,
            on_stdout_line=handle_progress_line,
        )
    except JobCancelledError:
        output_path.unlink(missing_ok=True)
        raise
    except ProcessingError as exc:
        raise ProcessingError(
            "The captioned video took too long to render.",
            code="render_timeout",
            retryable=True,
            details={"error": str(exc)},
        ) from exc

    if result.returncode != 0 and tools.video_encoder != "libx264" and not cancel_event.is_set():
        logger.warning(
            "hardware encode failed; falling back to CPU",
            extra={"stderr": result.stderr[-1500:]},
        )
        warnings.append("Hardware encoding failed; CPU encoding was used.")
        cpu_tools = MediaTools(
            ffmpeg=tools.ffmpeg,
            ffprobe=tools.ffprobe,
            has_libass=tools.has_libass,
            video_encoder="libx264",
        )
        command = _build_command(
            tools=cpu_tools,
            settings=settings,
            source=source,
            output_path=output_path,
            ass_path=ass_path,
            media=media,
            width=width,
            height=height,
            work_dir=work_dir,
            quality=quality,
        )
        try:
            result = await run_process(
                command,
                cancel_event=cancel_event,
                timeout_seconds=render_timeout,
                cwd=work_dir,
                on_stdout_line=handle_progress_line,
            )
        except (JobCancelledError, ProcessingError):
            output_path.unlink(missing_ok=True)
            raise

    if result.returncode != 0 or not output_path.exists():
        output_path.unlink(missing_ok=True)
        stderr_tail = "\n".join(result.stderr_lines[-16:])
        raise ProcessingError(
            "The captioned video could not be rendered. The source may use an unsupported "
            "codec, or the caption font may be unavailable.",
            code="render_failed",
            details={"stderr": stderr_tail[-3000:]},
        )
    if output_path.stat().st_size < 10_000:
        output_path.unlink(missing_ok=True)
        raise ProcessingError("The captioned video rendered empty.", code="empty_output")

    try:
        probe = await asyncio.to_thread(probe_output_sync, output_path)
        stream = (probe.get("streams") or [{}])[0]
        if stream.get("codec_name") != "h264":
            raise ProcessingError(
                "The captioned video was not encoded as H.264.",
                code="output_codec_mismatch",
            )
    except ProcessingError:
        raise
    except Exception as exc:  # pragma: no cover - verification is best-effort
        logger.warning("output verification failed", extra={"error": str(exc)})

    caption_seek = words[0].start + 0.25 if words else None
    await _thumbnail(
        output_path,
        thumbnail_path,
        media.duration,
        tools,
        cancel_event,
        seek=caption_seek,
    )
    on_progress(1.0)
    logger.info(
        "captioned video rendered",
        extra={
            "duration": media.duration,
            "events": caption_result.event_count,
            "size": output_path.stat().st_size,
        },
    )
    return RenderedCaption(
        video_path=output_path,
        thumbnail_path=thumbnail_path,
        width=width,
        height=height,
        filename=f"{title_slug}_captioned.mp4",
        event_count=caption_result.event_count,
        warnings=warnings,
    )
