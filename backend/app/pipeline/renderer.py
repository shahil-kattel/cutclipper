"""FFmpeg composition: smart crop, transitions, captions, and exports."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event

from app.config import Settings
from app.core.errors import JobCancelledError, ProcessingError
from app.pipeline.captions import build_ass
from app.pipeline.types import ClipPlan, Transcript
from app.schemas import (
    AspectRatio,
    ClipSettings,
    JobStage,
    ReframeMode,
    TransitionSettings,
    TransitionStyle,
)
from app.services.faces import FaceTrack, track_faces
from app.services.media import (
    MediaInfo,
    MediaTools,
    encoder_args,
    escape_filter_path,
    get_media_tools,
    probe_output_sync,
)
from app.services.process import run_process

logger = logging.getLogger(__name__)

ASPECT_DIMENSIONS: dict[AspectRatio, tuple[int, int]] = {
    AspectRatio.VERTICAL: (1080, 1920),
    AspectRatio.SQUARE: (1080, 1080),
    AspectRatio.PORTRAIT: (1080, 1350),
}

StageCallback = Callable[[JobStage, str, float], None]
ProgressCallback = Callable[[float], None]

_SLUG_RE = re.compile(r"[^a-zA-Z0-9]+")


@dataclass(slots=True)
class RenderedClip:
    index: int
    plan: ClipPlan
    video_path: Path
    thumbnail_path: Path
    width: int
    height: int
    filename: str
    warnings: list[str] = field(default_factory=list)


def safe_title_slug(title: str, limit: int = 46) -> str:
    slug = _SLUG_RE.sub("-", title).strip("-").lower()
    slug = slug[:limit].rstrip("-")
    return slug or "clip"


def output_dimensions(aspect: AspectRatio) -> tuple[int, int]:
    return ASPECT_DIMENSIONS[aspect]


def _crop_dimensions(
    source_width: int, source_height: int, target_width: int, target_height: int
) -> tuple[int, int]:
    source_aspect = source_width / max(1, source_height)
    target_aspect = target_width / target_height
    if source_aspect >= target_aspect:
        crop_height = source_height
        crop_width = round(crop_height * target_aspect)
    else:
        crop_width = source_width
        crop_height = round(crop_width / target_aspect)
    crop_width = max(2, min(source_width, crop_width) // 2 * 2)
    crop_height = max(2, min(source_height, crop_height) // 2 * 2)
    return crop_width, crop_height


def _piecewise_expression(samples: list[tuple[float, float]], duration: float) -> str:
    """Build a linear-interpolated FFmpeg expression from (time, value) samples."""

    if not samples:
        return "0"
    prepared = sorted(samples, key=lambda item: item[0])
    if prepared[0][0] > 0:
        prepared.insert(0, (0.0, prepared[0][1]))
    if prepared[-1][0] < duration:
        prepared.append((duration, prepared[-1][1]))
    prepared = [(max(0.0, min(duration, t)), value) for t, value in prepared]
    deduped: list[tuple[float, float]] = []
    for time, value in prepared:
        if deduped and abs(time - deduped[-1][0]) < 1e-5:
            deduped[-1] = (time, value)
        else:
            deduped.append((time, value))
    prepared = deduped
    if (
        len(prepared) == 1
        or max(value for _, value in prepared) - min(value for _, value in prepared) < 0.05
    ):
        return f"{prepared[0][1]:.3f}"

    segments: list[tuple[float, str]] = []
    for index in range(len(prepared) - 1):
        t0, v0 = prepared[index]
        t1, v1 = prepared[index + 1]
        dt = max(1e-5, t1 - t0)
        if abs(v1 - v0) < 0.01:
            segments.append((t1, f"{v0:.3f}"))
        else:
            segments.append(
                (
                    t1,
                    f"{v0:.3f}+({v1 - v0:.3f})*clip((t-{t0:.3f})/{dt:.4f},0,1)",
                )
            )
    expression = segments[-1][1]
    for end_time, segment in reversed(segments[:-1]):
        expression = f"if(lt(t,{end_time:.3f}),{segment},{expression})"
    return expression


def _crop_expr(
    face_track: FaceTrack,
    *,
    source_width: int,
    source_height: int,
    crop_width: int,
    crop_height: int,
    duration: float,
    mode: ReframeMode,
) -> tuple[str, str]:
    max_x = source_width - crop_width
    max_y = source_height - crop_height
    if mode == ReframeMode.CENTER or not face_track.samples:
        center_x = max_x / 2
        center_y = max_y / 2
        return f"{center_x:.3f}", f"{center_y:.3f}"

    x_values: list[tuple[float, float]] = []
    y_values: list[tuple[float, float]] = []
    for time, norm_x, norm_y in face_track.samples:
        clamped_x = min(max(0.0, norm_x * source_width - crop_width / 2), float(max_x))
        clamped_y = min(max(0.0, norm_y * source_height - crop_height * 0.42), float(max_y))
        x_values.append((max(0.0, min(duration, time)), clamped_x))
        y_values.append((max(0.0, min(duration, time)), clamped_y))
    return (
        _piecewise_expression(x_values, duration),
        _piecewise_expression(y_values, duration),
    )


def _smoothstep(percent: str) -> str:
    return f"({percent}*{percent}*(3-2*{percent}))"


def _video_filters(
    *,
    plan: ClipPlan,
    index: int,
    media: MediaInfo,
    output_size: tuple[int, int],
    face_track: FaceTrack | None,
    caption_path: Path | None,
    transitions: TransitionSettings,
    settings: Settings,
    fonts_dir: Path,
    reframe_mode: ReframeMode,
) -> tuple[str, str]:
    width, height = output_size
    fps = settings.output_fps
    duration = plan.duration
    pre_label = f"clip{index}reframed"
    out_label = "vout"

    if media.width <= 0 or media.height <= 0:
        raise ProcessingError("The source video has invalid dimensions.")
    caption_filter = ""
    if caption_path is not None:
        escaped_ass = escape_filter_path(str(caption_path))
        escaped_fonts = escape_filter_path(str(fonts_dir))
        caption_filter = f",ass=filename='{escaped_ass}':fontsdir='{escaped_fonts}'"

    if reframe_mode == ReframeMode.BLUR:
        chain = (
            f"[0:v]split=2[bg0][fg0];"
            f"[bg0]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},boxblur=28:2,eq=brightness=-0.07[bg];"
            f"[fg0]scale={width}:{height}:force_original_aspect_ratio=decrease[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2,fps={fps},setsar=1"
            f"{caption_filter},format=yuv420p[{pre_label}]"
        )
    else:
        crop_width, crop_height = _crop_dimensions(media.width, media.height, width, height)
        track = face_track or FaceTrack.centered()
        x_expr, y_expr = _crop_expr(
            track,
            source_width=media.width,
            source_height=media.height,
            crop_width=crop_width,
            crop_height=crop_height,
            duration=duration,
            mode=reframe_mode,
        )
        chain = (
            f"[0:v]crop=w={crop_width}:h={crop_height}:x='{x_expr}':y='{y_expr}',"
            f"scale={width}:{height}:flags=lanczos,setsar=1,fps={fps}"
            f"{caption_filter},format=yuv420p[{pre_label}]"
        )

    if not transitions.enabled:
        chain += f";[{pre_label}]null[{out_label}]"
        return chain, out_label

    transition_duration = max(0.2, min(transitions.duration, duration / 3.0))
    if transitions.style == TransitionStyle.FADE:
        chain += (
            f";[{pre_label}]fade=t=in:st=0:d={transition_duration:.3f},"
            f"fade=t=out:st={max(0.0, duration - transition_duration):.3f}:"
            f"d={transition_duration:.3f},format=yuv420p[{out_label}]"
        )
    elif transitions.style == TransitionStyle.ZOOM:
        zoom = 0.10
        position = f"clip(on/({transition_duration:.3f}*{fps}),0,1)"
        end_position = (
            f"clip((on-{max(0.0, duration - transition_duration) * fps:.1f})/"
            f"({transition_duration:.3f}*{fps}),0,1)"
        )
        zoom_expr = (
            f"{1 + zoom:.3f}-{zoom:.3f}*{_smoothstep(position)}"
            f"+{zoom:.3f}*{_smoothstep(end_position)}"
        )
        chain += (
            f";[{pre_label}]zoompan=z='{zoom_expr}':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:"
            f"s={width}x{height}:fps={fps},format=yuv420p[{out_label}]"
        )
    else:
        percent = f"clip(t/{transition_duration:.3f},0,1)"
        end_percent = (
            f"clip((t-{max(0.0, duration - transition_duration):.3f})/"
            f"{transition_duration:.3f},0,1)"
        )
        x_expr = (
            f"if(lt(t,{transition_duration:.3f}),"
            f"{width}*(1-{_smoothstep(percent)}),"
            f"if(gt(t,{max(0.0, duration - transition_duration):.3f}),"
            f"-{width}*{_smoothstep(end_percent)},0))"
        )
        source = f"[{pre_label}]"
        if transitions.style == TransitionStyle.WHIP_PAN:
            chain += (
                f";[{pre_label}]avgblur=sizeX=18:sizeY=1:"
                f"enable='lt(t,{transition_duration:.3f})+"
                f"gt(t,{max(0.0, duration - transition_duration):.3f})'[motion]"
            )
            source = "[motion]"
        chain += (
            f";color=c=black:s={width}x{height}:r={fps}:"
            f"d={duration:.3f}[canvas];"
            f"[canvas]{source}overlay=x='{x_expr}':y=0:eval=frame:shortest=1,"
            f"format=yuv420p[{out_label}]"
        )
    return chain, out_label


def _audio_chain(
    duration: float,
    transitions: TransitionSettings,
) -> str:
    fade = max(0.08, min(transitions.duration * 0.8, 0.6)) if transitions.enabled else 0.04
    return (
        f"[0:a]atrim=end={duration:.3f},asetpts=PTS-STARTPTS,"
        f"aresample=async=1:first_pts=0,"
        f"afade=t=in:st=0:d={fade:.3f},"
        f"afade=t=out:st={max(0.0, duration - fade):.3f}:d={fade:.3f}[aout]"
    )


async def _generate_thumbnail(
    video_path: Path,
    thumbnail_path: Path,
    *,
    duration: float,
    tools: MediaTools,
    cancel_event: Event,
) -> None:
    seek = min(max(0.4, duration * 0.18), max(0.4, duration - 0.1))
    command = [
        tools.ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{seek:.3f}",
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
    result = await run_process(
        command,
        cancel_event=cancel_event,
        timeout_seconds=60,
    )
    if result.returncode != 0 or not thumbnail_path.exists():
        width, height = 540, 960
        fallback = [
            tools.ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=0x080b18:s={width}x{height}:d=1",
            "-frames:v",
            "1",
            str(thumbnail_path),
        ]
        await run_process(
            fallback,
            cancel_event=cancel_event,
            timeout_seconds=30,
        )


class ClipRenderer:
    def __init__(
        self,
        *,
        source: Path,
        media: MediaInfo,
        settings: Settings,
        clip_settings: ClipSettings,
        work_dir: Path,
        output_dir: Path,
        cancel_event: Event,
    ) -> None:
        self.source = source
        self.media = media
        self.settings = settings
        self.clip_settings = clip_settings
        self.work_dir = work_dir
        self.output_dir = output_dir
        self.cancel_event = cancel_event
        self.tools = get_media_tools(settings)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        (work_dir / "captions").mkdir(parents=True, exist_ok=True)

    async def render(
        self,
        plan: ClipPlan,
        index: int,
        transcript: Transcript,
        *,
        on_stage: StageCallback,
        on_progress: ProgressCallback,
        title_slug: str,
    ) -> RenderedClip:
        if self.cancel_event.is_set():
            raise JobCancelledError()
        duration = plan.duration
        width, height = output_dimensions(self.clip_settings.aspect_ratio)
        reframe_mode = self.clip_settings.reframe_mode
        captions = self.clip_settings.captions
        transitions = self.clip_settings.transitions
        warnings: list[str] = []

        face_track: FaceTrack | None = None
        if reframe_mode == ReframeMode.SMART:
            on_stage(
                JobStage.REFRAMING,
                f"Tracking the speaker for clip {index}",
                0.02,
            )
            face_track = await track_faces(
                self.source,
                self.work_dir,
                plan.start,
                duration,
                cancel_event=self.cancel_event,
            )
            if face_track.warning:
                warnings.append(face_track.warning)
        else:
            on_stage(JobStage.REFRAMING, f"Reframing clip {index}", 0.05)

        caption_path: Path | None = None
        if captions.enabled:
            on_stage(
                JobStage.CAPTIONING,
                f"Animating captions for clip {index}",
                0.09,
            )
            clip_words = transcript.words_between(plan.start, plan.end)
            if clip_words:
                if not self.tools.has_libass:
                    raise ProcessingError(
                        "Captions require an FFmpeg build with libass. Install "
                        "FFmpeg with libass (for example, ffmpeg-full) and restart.",
                        code="libass_missing",
                    )
                caption_file = self.work_dir / "captions" / f"clip_{index:02d}.ass"
                result = build_ass(
                    clip_words,
                    clip_start=plan.start,
                    clip_duration=duration,
                    settings=captions,
                    output_size=(width, height),
                    output_path=caption_file,
                )
                if result.event_count > 0:
                    caption_path = Path(result.path)
                else:
                    warnings.append(
                        f"Clip {index} had no captionable speech; captions were skipped."
                    )
            elif transcript.has_speech:
                warnings.append(f"Clip {index} has no speech; captions were skipped for this clip.")

        output_path = self.output_dir / f"clip_{index:02d}.mp4"
        thumbnail_path = self.output_dir / f"thumb_{index:02d}.jpg"
        on_stage(JobStage.RENDERING, f"Rendering clip {index}", 0.14)

        video_chain, video_label = _video_filters(
            plan=plan,
            index=index,
            media=self.media,
            output_size=(width, height),
            face_track=face_track,
            caption_path=caption_path,
            transitions=transitions,
            settings=self.settings,
            fonts_dir=self.settings.fonts_dir,
            reframe_mode=reframe_mode,
        )
        filter_complex = video_chain
        audio_map: str | None = None
        if self.media.has_audio:
            filter_complex += ";" + _audio_chain(duration, transitions)
            audio_map = "[aout]"

        last_progress = 0.0

        def handle_progress_line(line: str) -> None:
            nonlocal last_progress
            if not line.startswith("out_time_"):
                return
            _, _, raw = line.partition("=")
            try:
                microseconds = float(raw)
            except ValueError:
                return
            fraction = max(0.0, min(1.0, microseconds / 1_000_000 / max(0.1, duration)))
            if fraction >= last_progress + 0.006 or fraction >= 0.999:
                last_progress = fraction
                on_progress(0.15 + 0.80 * fraction)

        command = self._build_command(
            plan=plan,
            output_path=output_path,
            filter_complex=filter_complex,
            video_label=video_label,
            audio_map=audio_map,
            force_encoder=None,
        )
        result = None
        try:
            result = await run_process(
                command,
                cancel_event=self.cancel_event,
                timeout_seconds=self.settings.render_timeout_seconds,
                on_stdout_line=handle_progress_line,
            )
        except JobCancelledError:
            output_path.unlink(missing_ok=True)
            raise
        except ProcessingError as exc:
            raise ProcessingError(
                f"Clip {index} could not be rendered.",
                code="render_timeout",
                details={"error": str(exc)},
            ) from exc

        if (
            result.returncode != 0
            and self.tools.video_encoder != "libx264"
            and not self.cancel_event.is_set()
        ):
            logger.warning(
                "hardware encode failed; falling back to CPU",
                extra={"clip": index, "stderr": result.stderr[-1500:]},
            )
            warnings.append("Hardware encoding failed for one clip; CPU encoding was used.")
            on_stage(
                JobStage.RENDERING,
                "Hardware encoder unavailable · switching to CPU",
                0.2,
            )
            command = self._build_command(
                plan=plan,
                output_path=output_path,
                filter_complex=filter_complex,
                video_label=video_label,
                audio_map=audio_map,
                force_encoder="libx264",
            )
            try:
                result = await run_process(
                    command,
                    cancel_event=self.cancel_event,
                    timeout_seconds=self.settings.render_timeout_seconds,
                    on_stdout_line=handle_progress_line,
                )
            except (JobCancelledError, ProcessingError):
                output_path.unlink(missing_ok=True)
                raise

        if result is None or result.returncode != 0 or not output_path.exists():
            output_path.unlink(missing_ok=True)
            stderr_tail = "\n".join((result.stderr_lines if result else [])[-16:])
            raise ProcessingError(
                f"Clip {index} could not be rendered. The source may use an unsupported "
                "codec, or the transition/caption filters may have failed.",
                code="render_failed",
                details={"stderr": stderr_tail[-3000:]},
            )
        if output_path.stat().st_size < 10_000:
            output_path.unlink(missing_ok=True)
            raise ProcessingError(
                f"Clip {index} rendered empty. Try a different source link.",
                code="empty_output",
            )

        on_progress(0.97)
        try:
            probe = await asyncio.to_thread(probe_output_sync, output_path)
            stream = (probe.get("streams") or [{}])[0]
            actual_width = int(stream.get("width") or 0)
            actual_height = int(stream.get("height") or 0)
            if (actual_width, actual_height) != (width, height):
                raise ProcessingError(
                    f"Clip {index} rendered at {actual_width}×{actual_height}, "
                    f"expected {width}×{height}.",
                    code="output_dimension_mismatch",
                )
            if stream.get("codec_name") != "h264":
                raise ProcessingError(
                    f"Clip {index} was not encoded as H.264.", code="output_codec_mismatch"
                )
        except ProcessingError:
            raise
        except Exception as exc:
            logger.warning("output verification failed", extra={"error": str(exc)})

        await _generate_thumbnail(
            output_path,
            thumbnail_path,
            duration=duration,
            tools=self.tools,
            cancel_event=self.cancel_event,
        )
        on_progress(1.0)
        filename = f"{title_slug}_clip_{index:02d}.mp4"
        logger.info(
            "clip rendered",
            extra={
                "clip": index,
                "start": plan.start,
                "end": plan.end,
                "size": output_path.stat().st_size,
            },
        )
        return RenderedClip(
            index=index,
            plan=plan,
            video_path=output_path,
            thumbnail_path=thumbnail_path,
            width=width,
            height=height,
            filename=filename,
            warnings=warnings,
        )

    def _build_command(
        self,
        *,
        plan: ClipPlan,
        output_path: Path,
        filter_complex: str,
        video_label: str,
        audio_map: str | None,
        force_encoder: str | None,
    ) -> list[str]:
        tools = self.tools
        if force_encoder:
            tools = MediaTools(
                ffmpeg=self.tools.ffmpeg,
                ffprobe=self.tools.ffprobe,
                has_libass=self.tools.has_libass,
                video_encoder=force_encoder,
            )
        command = [
            tools.ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{plan.start:.3f}",
            "-t",
            f"{plan.duration:.3f}",
            "-i",
            str(self.source),
            "-filter_complex",
            filter_complex,
            "-map",
            f"[{video_label}]",
        ]
        if audio_map:
            command.extend(["-map", audio_map])
        command.extend(["-t", f"{plan.duration:.3f}"])
        command.extend(encoder_args(tools, self.settings))
        command.extend(["-pix_fmt", "yuv420p", "-fps_mode", "cfr"])
        if self.media.has_audio and audio_map:
            command.extend(["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"])
        else:
            command.append("-an")
        command.extend(
            [
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
