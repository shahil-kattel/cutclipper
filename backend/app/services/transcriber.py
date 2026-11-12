"""Speech transcription with faster-whisper word timestamps."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import platform
import re
import sys
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from threading import Event
from typing import Any

from app.config import Settings
from app.core.errors import JobCancelledError, ProcessingError
from app.pipeline.types import Sentence, Transcript, Word
from app.services.media import get_media_tools
from app.services.process import run_process

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[float, str], None]
_SENTENCE_END_RE = re.compile(r"""[.!?…。！？]["'”’)\]]*$""")
_BATCH_MIN_SECONDS = 4.0


def _resolve_runtime(settings: Settings) -> tuple[str, str]:
    """Pick the fastest available backend instead of CTranslate2's slow fallback.

    CTranslate2's ``auto`` compute type resolves float16 to float32 on CPUs
    that cannot run it, which is dramatically slower than int8. Apple Silicon
    also exposes an experimental (but substantially faster) Metal backend.
    """

    device = (settings.whisper_device or "auto").strip().lower()
    compute_type = (settings.whisper_compute_type or "auto").strip().lower()
    if device in {"", "auto"}:
        device = (
            "mps"
            if sys.platform == "darwin" and platform.machine().lower() in {"arm64", "aarch64"}
            else "cpu"
        )
    if compute_type in {"", "auto"}:
        compute_type = "float16" if device in {"mps", "cuda"} else "int8"
    return device, compute_type


def _batch_size(device: str) -> int:
    if device == "cuda":
        return 16
    return 8


@lru_cache(maxsize=4)
def _load_model(
    model_size: str,
    device: str,
    compute_type: str,
    cpu_threads: int,
) -> Any:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise ProcessingError(
            "faster-whisper is not installed. Reinstall the backend dependencies.",
            code="whisper_missing",
        ) from exc

    attempts: list[tuple[str, str]] = [(device, compute_type)]
    if device != "cpu":
        attempts.append(("cpu", "int8"))
    if compute_type != "float32":
        attempts.append(("cpu", "float32"))

    last_error: Exception | None = None
    for attempt_device, attempt_compute in dict.fromkeys(attempts):
        logger.info(
            "loading whisper model",
            extra={
                "model": model_size,
                "device": attempt_device,
                "compute_type": attempt_compute,
            },
        )
        kwargs: dict[str, Any] = {
            "device": attempt_device,
            "compute_type": attempt_compute,
        }
        if cpu_threads > 0:
            kwargs["cpu_threads"] = cpu_threads
        try:
            return WhisperModel(model_size, **kwargs)
        except Exception as exc:  # try the next backend before failing the request
            last_error = exc
            logger.warning(
                "whisper backend unavailable",
                extra={
                    "device": attempt_device,
                    "compute_type": attempt_compute,
                    "error": str(exc),
                },
            )
    raise ProcessingError(
        "The Whisper speech model could not be loaded. Check your internet connection "
        "for the first-run model download, or set CUTCLIPPER_WHISPER_MODEL.",
        code="whisper_load_failed",
        retryable=True,
        details={"error": str(last_error)},
    ) from last_error


@lru_cache(maxsize=4)
def _batched_pipeline(
    model_size: str,
    device: str,
    compute_type: str,
    cpu_threads: int,
) -> Any:
    from faster_whisper import BatchedInferencePipeline

    return BatchedInferencePipeline(_load_model(model_size, device, compute_type, cpu_threads))


def _next_segment(iterator: Any) -> Any | None:
    try:
        return next(iterator)
    except StopIteration:
        return None


def _normalize_word(text: str) -> str:
    return " ".join(text.replace("\n", " ").split())


def _word_ends_sentence(text: str) -> bool:
    return bool(_SENTENCE_END_RE.search(text.strip()))


def build_sentences(words: list[Word]) -> list[Sentence]:
    """Group words by punctuation or natural pauses without losing words."""

    if not words:
        return []
    sentences: list[Sentence] = []
    current_indices: list[int] = []
    for index, word in enumerate(words):
        current_indices.append(index)
        next_word = words[index + 1] if index + 1 < len(words) else None
        gap = (next_word.start - word.end) if next_word else 0.0
        span = word.end - words[current_indices[0]].start
        should_break = (
            _word_ends_sentence(word.text)
            or next_word is None
            or gap >= 0.9
            or (gap >= 0.42 and span >= 22.0)
            or span >= 40.0
        )
        if should_break:
            start = words[current_indices[0]].start
            end = word.end
            text = " ".join(words[i].text for i in current_indices).strip()
            sentences.append(
                Sentence(
                    start=round(start, 3),
                    end=round(end, 3),
                    text=text,
                    word_indices=current_indices[:],
                )
            )
            current_indices = []
    return sentences


def _build_words(segments: list[Any], duration: float) -> list[Word]:
    words: list[Word] = []
    for segment in segments:
        segment_words = getattr(segment, "words", None) or []
        if segment_words:
            for item in segment_words:
                raw_text = _normalize_word(getattr(item, "word", "") or "")
                start = getattr(item, "start", None)
                end = getattr(item, "end", None)
                if not raw_text or start is None or end is None:
                    continue
                start = max(0.0, min(float(start), duration))
                end = max(start, min(float(end), duration))
                if end - start < 0.01:
                    continue
                words.append(
                    Word(
                        start=round(start, 3),
                        end=round(end, 3),
                        text=raw_text,
                        probability=float(getattr(item, "probability", 1.0) or 1.0),
                    )
                )
        else:
            text = _normalize_word(getattr(segment, "text", "") or "")
            start = float(getattr(segment, "start", 0.0) or 0.0)
            end = float(getattr(segment, "end", start) or start)
            if not text or end <= start:
                continue
            parts = text.split()
            if not parts:
                continue
            step = (end - start) / len(parts)
            for i, part in enumerate(parts):
                words.append(
                    Word(
                        start=round(start + i * step, 3),
                        end=round(start + (i + 1) * step, 3),
                        text=part,
                    )
                )
    words.sort(key=lambda word: (word.start, word.end))
    return _dedupe_words(words, duration)


def _dedupe_words(words: list[Word], duration: float) -> list[Word]:
    cleaned: list[Word] = []
    for word in words:
        if word.start < 0 or word.end > duration + 0.25:
            word.start = max(0.0, word.start)
            word.end = min(duration, word.end)
        if word.end - word.start < 0.01:
            continue
        if cleaned:
            previous = cleaned[-1]
            if word.text == previous.text and abs(word.start - previous.start) < 0.12:
                continue
            if word.start < previous.start:
                continue
            previous.end = (
                min(previous.end, word.start) if previous.end > word.start else previous.end
            )
            if previous.end - previous.start < 0.01:
                cleaned.pop()
        cleaned.append(word)
    return cleaned


_NEPALI_PROMPT = "यो नेपाली भाषामा बोलिएको कुराकानी हो।"


def _transcribe_kwargs(
    settings: Settings,
    language: str | None,
    beam_size: int | None = None,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "language": language,
        "beam_size": beam_size or settings.whisper_beam_size,
        "word_timestamps": True,
        "vad_filter": True,
        "vad_parameters": {"min_silence_duration_ms": 450, "speech_pad_ms": 150},
        "condition_on_previous_text": False,
        "temperature": 0.0,
    }
    if language == "ne":
        kwargs["initial_prompt"] = _NEPALI_PROMPT
    return kwargs


def _start_engine(
    model_size: str,
    device: str,
    compute_type: str,
    cpu_threads: int,
    audio_path: Path,
    duration: float,
    kwargs: dict[str, Any],
) -> tuple[Any, Any]:
    """Start a batched transcription when possible, with a sequential fallback."""

    model = _load_model(model_size, device, compute_type, cpu_threads)
    if duration >= _BATCH_MIN_SECONDS:
        try:
            pipeline = _batched_pipeline(model_size, device, compute_type, cpu_threads)
            return pipeline.transcribe(
                str(audio_path),
                batch_size=_batch_size(device),
                **kwargs,
            )
        except Exception as exc:
            logger.warning(
                "batched transcription unavailable; using sequential decoding",
                extra={"error": str(exc)},
            )
    return model.transcribe(str(audio_path), **kwargs)


async def transcribe_audio(
    audio_path: Path,
    duration: float,
    settings: Settings,
    *,
    cancel_event: Event,
    on_progress: ProgressCallback | None = None,
    language: str | None = None,
    model_size: str | None = None,
    beam_size: int | None = None,
) -> Transcript:
    """Transcribe an extracted WAV file, yielding to the event loop between segments."""

    if on_progress:
        on_progress(0.02, "Loading the speech model")
    selected_language = (
        language if language not in {None, "", "auto"} else settings.whisper_language
    )
    selected_model = model_size or (
        settings.nepali_whisper_model if selected_language == "ne" else settings.whisper_model
    )
    device, compute_type = _resolve_runtime(settings)
    if cancel_event.is_set():
        raise JobCancelledError()

    kwargs = _transcribe_kwargs(settings, selected_language, beam_size)
    try:
        iterator, info = await asyncio.to_thread(
            _start_engine,
            selected_model,
            device,
            compute_type,
            settings.whisper_cpu_threads,
            audio_path,
            duration,
            kwargs,
        )
    except Exception as exc:
        raise ProcessingError(
            "Speech transcription could not start.",
            code="transcription_failed",
            retryable=True,
            details={"error": str(exc)},
        ) from exc

    language = getattr(info, "language", None)
    language_probability = getattr(info, "language_probability", None)
    segments: list[Any] = []
    if on_progress:
        on_progress(0.05, "Transcribing speech")

    try:
        while True:
            if cancel_event.is_set():
                raise JobCancelledError()
            segment = await asyncio.to_thread(_next_segment, iterator)
            if segment is None:
                break
            segments.append(segment)
            if duration > 0:
                fraction = min(0.97, 0.05 + 0.92 * (float(segment.end) / duration))
                if on_progress:
                    on_progress(fraction, "Transcribing speech")
    finally:
        close = getattr(iterator, "close", None)
        if close:
            with contextlib.suppress(Exception):
                await asyncio.to_thread(close)

    words = _build_words(segments, duration)
    sentences = build_sentences(words)
    warnings: list[str] = []
    logger.info(
        "transcription complete",
        extra={
            "segments": len(segments),
            "words": len(words),
            "sentences": len(sentences),
            "language": language,
        },
    )
    if on_progress:
        on_progress(1.0, "Speech transcribed")
    return Transcript(
        words=words,
        sentences=sentences,
        language=language,
        language_probability=language_probability,
        duration=duration,
        warnings=warnings,
    )


def _window_bounds(window: Any) -> tuple[float, float]:
    if isinstance(window, tuple | list) and len(window) >= 2:
        return float(window[0]), float(window[1])
    return float(window.start), float(window.end)


async def transcribe_windows(
    audio_path: Path,
    windows: list[Any],
    duration: float,
    settings: Settings,
    *,
    cancel_event: Event,
    on_progress: ProgressCallback | None = None,
    language: str | None = None,
    model_size: str | None = None,
    beam_size: int | None = None,
) -> Transcript:
    """Transcribe only the requested audio windows and offset word timestamps.

    Used for long sources where the user asked for a few short clips: Whisper
    only sees the highlight candidates instead of the full recording.
    """

    bounds = [
        (max(0.0, start), min(duration, end))
        for start, end in (_window_bounds(window) for window in windows)
        if end > start
    ]
    if not bounds:
        return Transcript(
            duration=duration,
            warnings=["No speech windows were selected for transcription."],
        )
    if len(bounds) == 1 and bounds[0][0] <= 0.01 and bounds[0][1] >= duration - 0.1:
        return await transcribe_audio(
            audio_path,
            duration,
            settings,
            cancel_event=cancel_event,
            on_progress=on_progress,
            language=language,
            model_size=model_size,
            beam_size=beam_size,
        )

    selected_language = (
        language if language not in {None, "", "auto"} else settings.whisper_language
    )
    selected_model = model_size or (
        settings.nepali_whisper_model if selected_language == "ne" else settings.whisper_model
    )
    device, compute_type = _resolve_runtime(settings)
    if on_progress:
        on_progress(0.01, "Loading the speech model")
    if cancel_event.is_set():
        raise JobCancelledError()

    tools = get_media_tools(settings)
    work_dir = audio_path.parent / "transcribe-windows"
    work_dir.mkdir(parents=True, exist_ok=True)
    total_seconds = sum(end - start for start, end in bounds)
    completed_seconds = 0.0
    words: list[Word] = []
    detected_language: str | None = None
    language_probability: float | None = None
    warnings: list[str] = []

    for index, (start, end) in enumerate(bounds):
        if cancel_event.is_set():
            raise JobCancelledError()
        window_seconds = end - start
        if window_seconds < 0.05:
            continue
        clip_path = work_dir / f"window_{index:03d}.wav"
        command = [
            tools.ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-t",
            f"{window_seconds:.3f}",
            "-i",
            str(audio_path),
            "-c",
            "copy",
            str(clip_path),
        ]
        try:
            result = await run_process(
                command,
                cancel_event=cancel_event,
                timeout_seconds=120,
            )
            if result.returncode != 0 or not clip_path.exists():
                raise ProcessingError(
                    "A highlight section of the audio could not be prepared for transcription.",
                    code="audio_slice_failed",
                    details={"stderr": result.stderr[-1000:]},
                )
            iterator, info = await asyncio.to_thread(
                _start_engine,
                selected_model,
                device,
                compute_type,
                settings.whisper_cpu_threads,
                clip_path,
                window_seconds,
                _transcribe_kwargs(settings, selected_language, beam_size),
            )
            segments: list[Any] = []
            while True:
                if cancel_event.is_set():
                    raise JobCancelledError()
                segment = await asyncio.to_thread(_next_segment, iterator)
                if segment is None:
                    break
                segments.append(segment)
                if on_progress and total_seconds > 0:
                    window_fraction = min(1.0, float(getattr(segment, "end", 0.0)) / window_seconds)
                    fraction = (
                        completed_seconds + window_seconds * window_fraction
                    ) / total_seconds
                    on_progress(
                        min(0.97, 0.04 + 0.92 * fraction),
                        f"Transcribing section {index + 1} of {len(bounds)}",
                    )
            close = getattr(iterator, "close", None)
            if close:
                with contextlib.suppress(Exception):
                    await asyncio.to_thread(close)
            if detected_language is None:
                detected_language = getattr(info, "language", None)
                language_probability = getattr(info, "language_probability", None)
            for word in _build_words(segments, window_seconds):
                words.append(
                    Word(
                        start=round(min(duration, word.start + start), 3),
                        end=round(min(duration, word.end + start), 3),
                        text=word.text,
                        probability=word.probability,
                    )
                )
        except (JobCancelledError, ProcessingError):
            raise
        except Exception as exc:
            raise ProcessingError(
                "One of the highlight sections could not be transcribed.",
                code="transcription_failed",
                retryable=True,
                details={"error": str(exc), "section": index + 1},
            ) from exc
        finally:
            with contextlib.suppress(OSError):
                clip_path.unlink(missing_ok=True)
        completed_seconds += window_seconds
        if on_progress and total_seconds > 0:
            on_progress(
                min(0.97, 0.04 + 0.92 * (completed_seconds / total_seconds)),
                f"Transcribed section {index + 1} of {len(bounds)}",
            )

    words.sort(key=lambda word: (word.start, word.end))
    words = _dedupe_words(words, duration)
    sentences = build_sentences(words)
    if not words:
        warnings.append("No speech was detected in the selected highlight windows.")
    if on_progress:
        on_progress(1.0, "Speech transcribed")
    logger.info(
        "window transcription complete",
        extra={
            "windows": len(bounds),
            "words": len(words),
            "language": detected_language,
            "audio_seconds": round(total_seconds, 1),
        },
    )
    return Transcript(
        words=words,
        sentences=sentences,
        language=detected_language,
        language_probability=language_probability,
        duration=duration,
        warnings=warnings,
    )
