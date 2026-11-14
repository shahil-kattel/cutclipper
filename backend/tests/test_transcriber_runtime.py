from __future__ import annotations

import asyncio
import itertools
from threading import Event
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.services import transcriber


def test_auto_runtime_uses_mps_on_apple_silicon(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(transcriber.sys, "platform", "darwin")
    monkeypatch.setattr(transcriber.platform, "machine", lambda: "arm64")
    device, compute_type = transcriber._resolve_runtime(
        Settings(whisper_device="auto", whisper_compute_type="auto")
    )
    assert (device, compute_type) == ("mps", "float16")


def test_auto_runtime_uses_int8_on_cpu(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(transcriber.sys, "platform", "linux")
    device, compute_type = transcriber._resolve_runtime(
        Settings(whisper_device="cpu", whisper_compute_type="auto")
    )
    assert (device, compute_type) == ("cpu", "int8")


def test_accurate_nepali_model_avoids_the_mps_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(transcriber.sys, "platform", "darwin")
    monkeypatch.setattr(transcriber.platform, "machine", lambda: "arm64")
    settings = Settings(whisper_device="auto", whisper_compute_type="auto")
    accurate = transcriber._accurate_nepali_model(settings)
    assert transcriber._resolve_runtime_for_model(accurate, settings) == ("cpu", "int8")
    assert transcriber._resolve_runtime_for_model("medium", settings) == ("mps", "float16")


def test_explicit_runtime_settings_are_respected() -> None:
    device, compute_type = transcriber._resolve_runtime(
        Settings(whisper_device="cuda", whisper_compute_type="float32")
    )
    assert (device, compute_type) == ("cuda", "float32")


def test_maximum_quality_uses_the_accurate_nepali_model() -> None:
    settings = Settings()
    model = "Dragneel/whisper-medium-nepali-openslr-ct2"
    assert transcriber._model_for("ne", "best", settings) == model
    assert transcriber._model_for("ne", "maximum", settings) == model
    assert transcriber._beam_for("maximum", settings) == 5
    assert transcriber._beam_for("maximum", settings, "ne") == 10
    assert transcriber._beam_for_model("best", settings, "ne", model) == 5
    assert transcriber._beam_for_model("maximum", settings, "ne", model) == 5


def test_accurate_chunks_overlap_and_cover_the_audio() -> None:
    bounds = transcriber._accurate_chunk_bounds(92.0)
    assert bounds[0] == (0.0, 12.0)
    assert bounds[1] == (9.0, 21.0)
    assert bounds[-1][1] == 92.0
    assert all(0 < end - start <= 12.0 for start, end in bounds)
    for (_, previous_end), (next_start, _) in itertools.pairwise(bounds):
        assert previous_end - next_start == pytest.approx(3.0)


def test_every_nepali_quality_tier_uses_the_accurate_model() -> None:
    settings = Settings()
    accurate = "Dragneel/whisper-medium-nepali-openslr-ct2"
    for quality in ("fast", "balanced", "best", "maximum", None):
        assert transcriber._model_for("ne", quality, settings) == accurate
    assert transcriber._beam_for("balanced", settings, "ne") == 5


def test_vanilla_tiers_return_when_accurate_model_is_unset() -> None:
    settings = Settings(nepali_accurate_whisper_model="")
    for quality in ("fast", "balanced", "best", "maximum", None):
        assert transcriber._model_for("ne", quality, settings) == "large-v3"


def test_accurate_nepali_model_skips_the_prompt_and_uses_short_fallback() -> None:
    settings = Settings(nepali_hotwords="Kathmandu")
    model = transcriber._accurate_nepali_model(settings)
    kwargs = transcriber._transcribe_kwargs(settings, "ne", beam_size=5, model_size=model)
    assert "initial_prompt" not in kwargs
    assert "hotwords" not in kwargs
    assert kwargs["temperature"] == 0.0
    assert kwargs["word_timestamps"] is True

    vanilla = transcriber._transcribe_kwargs(settings, "ne", beam_size=5, model_size="large-v3")
    assert "initial_prompt" in vanilla
    assert vanilla["hotwords"] == "Kathmandu"
    assert vanilla["temperature"] == [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
    assert vanilla["word_timestamps"] is True


def test_nepali_decoding_uses_fallback_and_hotwords() -> None:
    settings = Settings(nepali_hotwords="Kathmandu, Pokhara")
    kwargs = transcriber._transcribe_kwargs(settings, "ne", beam_size=5)
    assert kwargs["temperature"] == [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]
    assert kwargs["compression_ratio_threshold"] == 2.4
    assert kwargs["vad_parameters"]["min_silence_duration_ms"] == 300
    assert kwargs["hotwords"] == "Kathmandu, Pokhara"
    assert "नेपाली" in kwargs["initial_prompt"]


def test_long_audio_language_detection_samples_three_regions() -> None:
    windows = transcriber._detection_windows(600.0)
    assert len(windows) == 3
    assert windows[0][0] == 0.0
    assert windows[-1][0] > 0.0
    assert len(transcriber._detection_windows(60.0)) == 1


def test_broken_utf8_word_fragments_are_dropped() -> None:
    segments = [
        SimpleNamespace(
            start=0.0,
            end=1.0,
            text="नमस्ते प",
            words=[
                SimpleNamespace(start=0.0, end=0.5, word="नमस्ते", probability=1.0),
                SimpleNamespace(start=0.5, end=1.0, word="प�", probability=1.0),
            ],
        )
    ]
    words = transcriber._build_words(segments, 1.0)
    assert [word.text for word in words] == ["नमस्ते"]

    fallback = [SimpleNamespace(start=0.0, end=1.0, text="नमस्ते प�", words=None)]
    words = transcriber._build_words(fallback, 1.0)
    assert [word.text for word in words] == ["नमस्ते"]


def test_runaway_word_timestamp_is_capped_without_losing_words() -> None:
    segments = [
        SimpleNamespace(
            start=0.0,
            end=30.0,
            text="छिटो प्रभावकारी चैँ",
            words=[
                SimpleNamespace(start=0.0, end=0.8, word="छिटो", probability=1.0),
                SimpleNamespace(start=0.8, end=1.6, word="प्रभावकारी", probability=1.0),
                SimpleNamespace(start=1.6, end=30.0, word="चैँ", probability=1.0),
            ],
        )
    ]
    words = transcriber._build_words(segments, 30.0)
    assert [word.text for word in words] == ["छिटो", "प्रभावकारी", "चैँ"]
    assert words[-1].end <= words[-1].start + 1.0


def test_wordless_segment_distributes_time_by_syllable_weight() -> None:
    segments = [SimpleNamespace(start=0.0, end=2.0, text="छिटो प्रभावकारी", words=None)]
    words = transcriber._build_words(segments, 2.0)
    assert [word.text for word in words] == ["छिटो", "प्रभावकारी"]
    assert words[1].end - words[1].start > words[0].end - words[0].start
    assert words[-1].end == pytest.approx(2.0)


def test_nepali_text_normalisation_cleans_danda_and_zero_width() -> None:
    assert transcriber._normalize_word("नमस्ते​|") == "नमस्ते।"
    assert transcriber._join_words(["नमस्ते", "।", "संसार"]) == "नमस्ते। संसार"
    assert transcriber._join_words(["Hello", ",", "world"]) == "Hello , world"
    assert transcriber._join_words(["एउटा", "एउटा", "भिडियो"]) == "एउटा भिडियो"
    assert transcriber._join_words(["नमस्ते", "।।।।", "संसार"]) == "नमस्ते। संसार"
    assert (
        transcriber._join_words(["प्रमुख", "त्यति", "विशिष्ट", "अत्यति", "अत्यति"])
        == "प्रमुख अतिथि, विशिष्ट अतिथि, अतिथि"
    )


def test_nepali_spelling_corrections_fix_non_words_only() -> None:
    assert transcriber._normalize_word("सटिग।") == "सटीक।"
    assert transcriber._normalize_word("सवागत") == "स्वागत"
    assert transcriber._normalize_word("सभादक्ष") == "सभाध्यक्ष"
    assert transcriber._normalize_word("राम्रो") == "राम्रो"
    assert transcriber._normalize_word("Kathmandu") == "Kathmandu"


def test_english_words_become_latin_while_nepali_stays_devanagari() -> None:
    assert transcriber._normalize_word("विन्डोज") == "Windows"
    assert transcriber._normalize_word("प्रोसेसर") == "processor"
    assert transcriber._normalize_word("भिडियो") == "video"
    assert transcriber._normalize_word("युटुब") == "YouTube"
    assert transcriber._normalize_word("युटुबमा") == "YouTubeमा"
    assert transcriber._normalize_word("भिडियोको") == "videoको"
    assert transcriber._normalize_word("कम्पनीहरू") == "companyहरू"
    assert transcriber._normalize_word("जिबिदेखि") == "GBदेखि"
    assert transcriber._normalize_word("ल्यापटोपहरूको") == "laptopहरूको"
    assert transcriber._normalize_word("हार्डिक्स") == "hard disk"
    assert transcriber._normalize_word("क्याप्सिटी") == "capacity"
    assert transcriber._normalize_word(" प्रोफेसनल") == "professional"
    assert transcriber._normalize_word("राममा") == "राममा"
    assert transcriber._normalize_word("फाइनली") == "finally"
    assert transcriber._normalize_word("बेनिफेड") == "benefit"
    assert transcriber._normalize_word("युएसमा") == "USAमा"
    assert transcriber._normalize_word("फोन्समा") == "phonesमा"
    assert transcriber._normalize_word("आइओएसबाहेक") == "iOSबाहेक"
    assert transcriber._join_words(["chat", "GPTको", "र", "Open", "AIले"]) == "ChatGPTको र OpenAIले"


def test_translate_disables_the_nepali_prompt() -> None:
    kwargs = transcriber._transcribe_kwargs(Settings(), "ne", beam_size=3, task="translate")
    assert kwargs["task"] == "translate"
    assert "initial_prompt" not in kwargs


def test_quality_beam_override_and_nepali_prompt() -> None:
    settings = Settings(whisper_beam_size=5)
    kwargs = transcriber._transcribe_kwargs(settings, "ne", beam_size=1)
    assert kwargs["beam_size"] == 1
    assert kwargs["language"] == "ne"
    assert "initial_prompt" in kwargs
    assert kwargs["word_timestamps"] is True


def test_batched_inference_is_used_for_long_audio(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    calls: list[tuple[str, float]] = []

    class Model:
        def transcribe(self, path: str, **kwargs: object):
            calls.append(("sequential", 0.0))
            return iter([]), object()

    class Pipeline:
        def transcribe(self, path: str, **kwargs: object):
            calls.append(("batched", kwargs.get("batch_size", 0)))
            return iter([]), object()

    monkeypatch.setattr(transcriber, "_load_model", lambda *args: Model())
    monkeypatch.setattr(transcriber, "_batched_pipeline", lambda *args: Pipeline())

    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"x")
    transcriber._FAILED_BATCHED_ENGINES.clear()
    first = transcriber._start_engine("small", "mps", "float16", 0, audio, 30.0, {})
    second = transcriber._start_engine("small", "mps", "float16", 0, audio, 2.0, {})
    assert calls == [("batched", 8), ("sequential", 0.0)]
    assert first.batched is True
    assert second.batched is False


def test_failed_batched_engine_is_quarantined(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    calls: list[str] = []

    class Model:
        def transcribe(self, path: str, **kwargs: object):
            calls.append("sequential")
            return iter([]), object()

    class Pipeline:
        def transcribe(self, path: str, **kwargs: object):
            calls.append("batched")
            raise RuntimeError("vector")

    monkeypatch.setattr(transcriber, "_load_model", lambda *args: Model())
    monkeypatch.setattr(transcriber, "_batched_pipeline", lambda *args: Pipeline())
    transcriber._FAILED_BATCHED_ENGINES.clear()

    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"x")
    engine = transcriber._start_engine("small", "mps", "float16", 0, audio, 30.0, {})
    again = transcriber._start_engine("small", "mps", "float16", 0, audio, 30.0, {})
    assert engine.batched is False
    assert again.batched is False
    assert calls == ["batched", "sequential", "sequential"]


def test_midstream_batched_failure_resumes_sequentially(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    def broken_batched():
        yield SimpleNamespace(start=0.0, end=1.0, text="hello world", words=None)
        raise IndexError("vector")

    def resumed_sequential():
        yield SimpleNamespace(start=1.0, end=2.5, text="again now", words=None)

    calls: list[dict[str, object]] = []

    def fake_sequential(
        model_size: str,
        device: str,
        compute_type: str,
        cpu_threads: int,
        audio_path,
        kwargs: dict[str, object],
    ) -> transcriber._Engine:
        calls.append(dict(kwargs))
        return transcriber._Engine(
            iterator=resumed_sequential(),
            info=SimpleNamespace(language="en", language_probability=0.99),
            batched=False,
        )

    monkeypatch.setattr(
        transcriber,
        "_start_engine",
        lambda *args: transcriber._Engine(
            iterator=broken_batched(),
            info=SimpleNamespace(language="en", language_probability=0.99),
            batched=True,
        ),
    )
    monkeypatch.setattr(transcriber, "_start_sequential", fake_sequential)
    transcriber._FAILED_BATCHED_ENGINES.clear()

    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"x")
    transcript = asyncio.run(
        transcriber.transcribe_audio(
            audio,
            3.0,
            Settings(whisper_device="cpu"),
            cancel_event=Event(),
            language="en",
        )
    )
    assert [word.text for word in transcript.words] == ["hello", "world", "again", "now"]
    assert calls and calls[0]["clip_timestamps"] == [0.95, 3.0]
    transcriber._FAILED_BATCHED_ENGINES.clear()


def test_speech_regions_are_split_around_silence() -> None:
    stderr = "\n".join(
        [
            "[silencedetect @ 0x1] silence_start: 1.0",
            "[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.5",
            "[silencedetect @ 0x1] silence_start: 4.0",
            "[silencedetect @ 0x1] silence_end: 5.0 | silence_duration: 1.0",
        ]
    )
    assert transcriber._parse_speech_regions(stderr, 6.0) == [
        (0.0, 1.0),
        (2.5, 4.0),
        (5.0, 6.0),
    ]


def test_speech_regions_handle_unclosed_silence_and_no_silence() -> None:
    assert transcriber._parse_speech_regions("silence_start: 2.0", 5.0) == [(0.0, 2.0)]
    assert transcriber._parse_speech_regions("", 7.0) == [(0.0, 7.0)]
    assert (
        transcriber._parse_speech_regions(
            "silence_start: 0.0\nsilence_end: 5.0 | silence_duration: 5.0",
            5.0,
        )
        == []
    )


def test_coverage_repair_detects_a_skipped_phrase() -> None:
    words = [
        transcriber.Word(start=0.0, end=1.0, text="नमस्ते", probability=1.0),
        transcriber.Word(start=6.0, end=7.0, text="संसार", probability=1.0),
    ]
    covered, gap = transcriber._coverage(words, 0.0, 7.0)
    assert covered == pytest.approx(2.0)
    assert gap == pytest.approx(5.0)
    assert transcriber._largest_uncovered_gap(words, 0.0, 7.0) == pytest.approx((1.0, 6.0))
    assert transcriber._region_needs_repair(words, 0.0, 7.0)

    full = [transcriber.Word(start=0.0, end=7.0, text="नमस्ते संसार", probability=1.0)]
    assert not transcriber._region_needs_repair(full, 0.0, 7.0)
    assert transcriber._largest_uncovered_gap(full, 0.0, 7.0) is None
