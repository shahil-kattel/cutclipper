from __future__ import annotations

import asyncio
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.pipeline.types import Transcript
from app.services import transcriber
from app.services.process import ProcessResult


class _FakeWord:
    def __init__(self, word: str, start: float, end: float) -> None:
        self.word = word
        self.start = start
        self.end = end
        self.probability = 0.99


class _FakeSegment:
    def __init__(self) -> None:
        self.start = 0.2
        self.end = 0.9
        self.text = "नमस्ते world"
        self.words = [_FakeWord("नमस्ते", 0.2, 0.5), _FakeWord("world", 0.55, 0.9)]


class _FakeModel:
    def transcribe(self, path: str, **kwargs: object) -> tuple[object, object]:
        return iter([_FakeSegment()]), SimpleNamespace(language="en", language_probability=0.99)


def test_transcribe_windows_offsets_words_and_uses_the_slice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"fake")

    monkeypatch.setattr(transcriber, "_load_model", lambda *args, **kwargs: _FakeModel())
    monkeypatch.setattr(
        transcriber,
        "get_media_tools",
        lambda settings=None: SimpleNamespace(ffmpeg="ffmpeg"),
    )

    async def fake_run_process(command: list[str], **kwargs: object) -> ProcessResult:
        Path(command[-1]).write_bytes(b"slice")
        return ProcessResult(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(transcriber, "run_process", fake_run_process)

    result = asyncio.run(
        transcriber.transcribe_windows(
            audio,
            [(10.0, 12.0), (20.0, 22.0)],
            100.0,
            Settings(),
            cancel_event=Event(),
            language="en",
        )
    )

    assert result.language == "en"
    assert [word.text for word in result.words] == ["नमस्ते", "world", "नमस्ते", "world"]
    assert result.words[0].start == pytest.approx(10.2)
    assert result.words[1].start == pytest.approx(10.55)
    assert result.words[2].start == pytest.approx(20.2)
    assert result.words[-1].end == pytest.approx(20.9)
    assert result.sentences
    assert not list((tmp_path / "transcribe-windows").glob("*.wav"))


def test_transcribe_windows_full_window_delegates_to_full_transcription(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"fake")
    calls: list[tuple[float, float]] = []

    async def fake_full(path: Path, duration: float, settings: Settings, **kwargs: object):
        calls.append((0.0, duration))
        return Transcript(duration=duration)

    monkeypatch.setattr(transcriber, "transcribe_audio", fake_full)
    result = asyncio.run(
        transcriber.transcribe_windows(
            audio,
            [(0.0, 30.0)],
            30.0,
            Settings(),
            cancel_event=Event(),
        )
    )
    assert calls == [(0.0, 30.0)]
    assert result.duration == 30.0
