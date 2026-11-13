from __future__ import annotations

import asyncio
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


def test_explicit_runtime_settings_are_respected() -> None:
    device, compute_type = transcriber._resolve_runtime(
        Settings(whisper_device="cuda", whisper_compute_type="float32")
    )
    assert (device, compute_type) == ("cuda", "float32")


def test_maximum_quality_uses_large_v3() -> None:
    settings = Settings()
    assert transcriber._model_for("ne", "maximum", settings) == "large-v3"
    assert transcriber._beam_for("maximum", settings) == 5


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
