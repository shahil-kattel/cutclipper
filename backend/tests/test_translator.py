from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.config import Settings
from app.schemas import CaptionSegment
from app.services import translator


def _words(*items: tuple[float, float, str]) -> list[SimpleNamespace]:
    return [SimpleNamespace(start=start, end=end, text=text) for start, end, text in items]


def test_parse_translations_accepts_array_and_wrapped_json() -> None:
    assert translator._parse_translations('["Hello", "World"]', 2) == ["Hello", "World"]
    assert translator._parse_translations(
        '```json\n{"translations": ["Hello", "World"]}\n```', 2
    ) == ["Hello", "World"]
    assert translator._parse_translations('{"translations": ["only one"]}', 2) is None
    assert translator._parse_translations("not json", 1) is None


def test_align_translation_keeps_original_timings() -> None:
    segments = [
        CaptionSegment(start=0.0, end=1.5, text="नमस्ते"),
        CaptionSegment(start=1.6, end=3.5, text="संसार कस्तो छ"),
    ]
    words = _words((0.1, 0.7, "Hello"), (1.8, 2.4, "how"), (2.5, 3.0, "is"), (3.1, 3.4, "it"))
    aligned = translator.align_translation(segments, words, [])
    assert [(item.start, item.end) for item in aligned] == [(0.0, 1.5), (1.6, 3.5)]
    assert [item.text for item in aligned] == ["Hello", "how is it"]


def test_align_translation_falls_back_to_overlapping_sentence() -> None:
    segments = [CaptionSegment(start=2.0, end=4.0, text="नमस्ते")]
    sentences = [SimpleNamespace(start=1.5, end=4.5, text="Hello there")]
    aligned = translator.align_translation(segments, [], sentences)
    assert aligned[0].text == "Hello there"
    assert aligned[0].start == 2.0


@pytest.mark.asyncio
async def test_whisper_translation_is_cached(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    calls = 0

    async def fake_transcribe(*args, **kwargs):
        nonlocal calls
        calls += 1
        words = _words((0.1, 0.6, "Hello"), (2.1, 2.6, " World"))
        return SimpleNamespace(
            words=words,
            sentences=[SimpleNamespace(start=0.1, end=2.6, text="Hello World")],
        )

    monkeypatch.setattr(translator, "transcribe_audio", fake_transcribe)
    settings = Settings(translation_api_url=None)
    segments = [
        CaptionSegment(start=0.0, end=1.0, text="नमस्ते"),
        CaptionSegment(start=2.0, end=3.0, text="संसार"),
    ]
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"x")

    first = await translator.translate_caption_segments(
        segments,
        audio_path=audio,
        duration=5.0,
        settings=settings,
        quality="best",
        language="ne",
        cache_dir=tmp_path,
    )
    assert first.engine == "whisper"
    assert [item.text for item in first.segments] == ["Hello", "World"]
    assert calls == 1

    second = await translator.translate_caption_segments(
        segments,
        audio_path=audio,
        duration=5.0,
        settings=settings,
        quality="best",
        language="ne",
        cache_dir=tmp_path,
    )
    assert [item.text for item in second.segments] == ["Hello", "World"]
    assert calls == 1


@pytest.mark.asyncio
async def test_llm_translation_is_preferred(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    async def fake_llm(segments, settings):
        return [
            CaptionSegment(start=segment.start, end=segment.end, text=f"EN {index}")
            for index, segment in enumerate(segments)
        ]

    async def fail_transcribe(*args, **kwargs):
        raise AssertionError("Whisper must not run when the LLM succeeds")

    monkeypatch.setattr(translator, "_translate_with_llm", fake_llm)
    monkeypatch.setattr(translator, "transcribe_audio", fail_transcribe)
    segments = [CaptionSegment(start=0.0, end=1.0, text="नमस्ते")]
    result = await translator.translate_caption_segments(
        segments,
        audio_path=tmp_path / "audio.wav",
        duration=5.0,
        settings=Settings(translation_api_url="http://example.test/v1/chat/completions"),
        quality=None,
        language="ne",
        cache_dir=tmp_path,
    )
    assert result.engine == "llm"
    assert result.segments[0].text == "EN 0"


@pytest.mark.asyncio
async def test_english_lines_are_kept_and_only_nepali_lines_are_translated(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    async def fake_llm(segments, settings):
        return [
            CaptionSegment(start=segment.start, end=segment.end, text=f"EN {index}")
            for index, segment in enumerate(segments)
        ]

    monkeypatch.setattr(translator, "_translate_with_llm", fake_llm)
    segments = [
        CaptionSegment(start=0.0, end=1.0, text="Hello world", language="en"),
        CaptionSegment(start=1.0, end=2.0, text="नमस्ते", language="ne"),
        CaptionSegment(start=2.0, end=3.0, text="YouTube SSD", language="en"),
    ]
    result = await translator.translate_caption_segments(
        segments,
        audio_path=tmp_path / "audio.wav",
        duration=3.0,
        settings=Settings(translation_api_url="http://example.test/v1/chat/completions"),
        quality=None,
        language="ne",
        cache_dir=tmp_path,
    )
    assert [item.text for item in result.segments] == ["Hello world", "EN 0", "YouTube SSD"]


@pytest.mark.asyncio
async def test_all_english_lines_skip_transcription(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    async def fail_transcribe(*args, **kwargs):
        raise AssertionError("An English-only track must not be transcribed")

    monkeypatch.setattr(translator, "transcribe_audio", fail_transcribe)
    segments = [
        CaptionSegment(start=0.0, end=1.0, text="Hello world", language="en"),
        CaptionSegment(start=1.0, end=2.0, text="YouTube SSD", language="en"),
    ]
    result = await translator.translate_caption_segments(
        segments,
        audio_path=tmp_path / "audio.wav",
        duration=2.0,
        settings=Settings(translation_api_url=None),
        quality=None,
        language="en",
        cache_dir=tmp_path,
    )
    assert result.segments == segments
    assert result.warnings
