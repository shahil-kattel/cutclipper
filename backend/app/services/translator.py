"""Nepali → English subtitle translation that preserves caption timings."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event

import httpx

from app.config import Settings
from app.pipeline.captions import build_caption_segments
from app.schemas import CaptionSegment
from app.services.transcriber import transcribe_audio

logger = logging.getLogger(__name__)

_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


@dataclass(slots=True)
class TranslationResult:
    segments: list[CaptionSegment]
    engine: str
    warnings: list[str] = field(default_factory=list)


def _clean(text: str) -> str:
    return " ".join(str(text).replace("\r", " ").replace("\n", " ").split())


def _parse_translations(content: str, count: int) -> list[str] | None:
    text = _CODE_FENCE_RE.sub("", content.strip())
    data: object
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start = min(
            (index for index in (text.find("["), text.find("{")) if index >= 0),
            default=-1,
        )
        if start < 0:
            return None
        end = max(text.rfind("]"), text.rfind("}"))
        if end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    if isinstance(data, dict):
        data = data.get("translations") or data.get("lines") or data.get("subtitles")
    if not isinstance(data, list) or len(data) != count:
        return None
    cleaned = [
        _clean(item.get("text", "") if isinstance(item, dict) else str(item)) for item in data
    ]
    if any(not item for item in cleaned):
        return None
    return cleaned


async def _translate_with_llm(
    segments: list[CaptionSegment],
    settings: Settings,
) -> list[CaptionSegment] | None:
    url = (settings.translation_api_url or "").strip()
    if not url:
        return None
    headers = {"Content-Type": "application/json"}
    if settings.translation_api_key:
        headers["Authorization"] = f"Bearer {settings.translation_api_key}"
    translated: list[CaptionSegment] = []
    batch_size = 40
    try:
        async with httpx.AsyncClient(timeout=settings.translation_timeout_seconds) as client:
            for start in range(0, len(segments), batch_size):
                batch = segments[start : start + batch_size]
                payload = {
                    "model": settings.translation_model,
                    "temperature": 0,
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You are a professional Nepali-to-English subtitle translator. "
                                "Translate each input line into natural, concise English suitable "
                                "for burned-in captions. Preserve meaning and keep the same order. "
                                'Return only JSON: {"translations": ["line 1", "line 2", ...]} '
                                "with exactly one translation per input line."
                            ),
                        },
                        {
                            "role": "user",
                            "content": json.dumps(
                                [segment.text for segment in batch],
                                ensure_ascii=False,
                            ),
                        },
                    ],
                }
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                body = response.json()
                content = body["choices"][0]["message"]["content"]
                lines = _parse_translations(str(content), len(batch))
                if lines is None:
                    logger.warning("translation API returned an unexpected payload")
                    return None
                translated.extend(
                    CaptionSegment(start=segment.start, end=segment.end, text=line)
                    for segment, line in zip(batch, lines, strict=True)
                )
        return translated
    except Exception as exc:
        logger.warning("LLM translation failed; falling back to Whisper", extra={"error": str(exc)})
        return None


def align_translation(
    segments: list[CaptionSegment],
    words: list[object],
    sentences: list[object],
) -> list[CaptionSegment]:
    """Assign translated words to the user's subtitle timings."""

    word_items = sorted(
        (
            (float(getattr(word, "start", 0.0)) + float(getattr(word, "end", 0.0))) / 2,
            str(getattr(word, "text", "")),
        )
        for word in words
    )
    sentence_items = [
        (
            float(getattr(sentence, "start", 0.0)),
            float(getattr(sentence, "end", 0.0)),
            str(getattr(sentence, "text", "")),
        )
        for sentence in sentences
    ]
    aligned: list[CaptionSegment] = []
    cursor = 0
    for segment in segments:
        while cursor < len(word_items) and word_items[cursor][0] < segment.start - 0.05:
            cursor += 1
        probe = cursor
        selected: list[str] = []
        while probe < len(word_items) and word_items[probe][0] <= segment.end + 0.05:
            selected.append(word_items[probe][1])
            probe += 1
        cursor = probe
        text = _clean(" ".join(selected))
        if not text:
            text = _clean(
                " ".join(
                    sentence_text
                    for start, end, sentence_text in sentence_items
                    if end > segment.start + 0.01 and start < segment.end - 0.01
                )
            )
        if text:
            aligned.append(CaptionSegment(start=segment.start, end=segment.end, text=text[:1000]))
    return aligned


def _read_cached_words(path: Path) -> tuple[list[object], list[object]] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    class _Item:
        __slots__ = ("end", "start", "text")

        def __init__(self, start: float, end: float, text: str) -> None:
            self.start = start
            self.end = end
            self.text = text

    words = [
        _Item(float(item["start"]), float(item["end"]), str(item["text"]))
        for item in payload.get("words", [])
        if isinstance(item, dict)
    ]
    sentences = [
        _Item(float(item["start"]), float(item["end"]), str(item["text"]))
        for item in payload.get("sentences", [])
        if isinstance(item, dict)
    ]
    return words, sentences


async def translate_caption_segments(
    segments: list[CaptionSegment],
    *,
    audio_path: Path,
    duration: float,
    settings: Settings,
    quality: str | None,
    language: str,
    cache_dir: Path,
) -> TranslationResult:
    """Translate lines to English, keeping the original subtitle timings."""

    llm = await _translate_with_llm(segments, settings)
    if llm:
        return TranslationResult(segments=llm, engine="llm")

    cache_path = cache_dir / f"translation_v1_{language}_{quality or 'default'}.json"
    downloaded = _read_cached_words(cache_path)
    if downloaded is None:
        transcript = await transcribe_audio(
            audio_path,
            duration,
            settings,
            cancel_event=Event(),
            language=language,
            quality=quality,
            task="translate",
        )
        words = transcript.words
        sentences = transcript.sentences
        try:
            cache_path.write_text(
                json.dumps(
                    {
                        "words": [
                            {"start": word.start, "end": word.end, "text": word.text}
                            for word in words
                        ],
                        "sentences": [
                            {"start": s.start, "end": s.end, "text": s.text} for s in sentences
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
        except OSError:
            logger.warning("translation cache write failed", extra={"path": str(cache_path)})
    else:
        words, sentences = downloaded

    aligned = align_translation(segments, words, sentences)
    warnings: list[str] = []
    if settings.translation_api_url:
        warnings.append(
            "The configured translation endpoint was unavailable; Whisper's English pass was "
            "used instead."
        )
    if len(aligned) < max(1, len(segments) // 2):
        # Word alignment could not cover the edited lines; fall back to the
        # English pass's own segmentation and explain the timing change.
        fallback = build_caption_segments(words, max_words=10, max_seconds=8.0)  # type: ignore[arg-type]
        if fallback:
            warnings.append(
                "The English pass could not align to every edited line; line timings were rebuilt "
                "from the audio."
            )
            return TranslationResult(segments=fallback, engine="whisper", warnings=warnings)
        warnings.append(
            "No English speech was detected in the audio. Configure an LLM translation endpoint "
            "to translate edited Nepali text."
        )
        return TranslationResult(segments=[], engine="whisper", warnings=warnings)

    warnings.append(
        "English came from Whisper's audio translation. Configure "
        "CUTCLIPPER_TRANSLATION_API_URL to translate edited Nepali lines exactly."
    )
    return TranslationResult(segments=aligned, engine="whisper", warnings=warnings)
