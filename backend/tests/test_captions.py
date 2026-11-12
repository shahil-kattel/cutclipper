from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.pipeline.captions import build_ass, safe_caption_y
from app.pipeline.types import Word
from app.schemas import CaptionPosition, CaptionSettings, CaptionStyle


@pytest.fixture
def words() -> list[Word]:
    return [
        Word(0.2, 0.55, "Welcome"),
        Word(0.6, 0.9, "to"),
        Word(0.95, 1.5, "CutClipper,"),
        Word(1.55, 2.0, "where"),
        Word(2.05, 2.5, "captions"),
        Word(2.55, 3.0, "move"),
        Word(3.05, 3.5, "fast."),
        Word(4.1, 4.55, "Every"),
        Word(4.6, 5.0, "word"),
        Word(5.05, 5.5, "lands"),
        Word(5.55, 6.1, "cleanly."),
    ]


def test_karaoke_ass_contains_events_style_and_highlight(tmp_path: Path, words: list[Word]) -> None:
    output = tmp_path / "captions.ass"
    settings = CaptionSettings(
        enabled=True,
        style=CaptionStyle.KARAOKE,
        font="Inter",
        font_size=80,
        color="#FFFFFF",
        highlight_color="#22D3EE",
        position=CaptionPosition.BOTTOM,
        outline_width=3,
        shadow=2,
    )
    result = build_ass(
        words,
        clip_start=0,
        clip_duration=6.5,
        settings=settings,
        output_size=(1080, 1920),
        output_path=output,
    )
    text = output.read_text(encoding="utf-8")
    assert result.event_count > 0
    assert result.word_count == len(words)
    assert "PlayResX: 1080" in text
    assert "PlayResY: 1920" in text
    assert "Style: CutClipper,Inter,80" in text
    assert "\\pos(540," in text
    assert "\\c&HEED322&" in text  # cyan in ASS BGR order, active word
    assert "Dialogue:" in text
    assert "Welcome" in text


def test_all_caption_styles_generate_valid_event_times(tmp_path: Path, words: list[Word]) -> None:
    for style in CaptionStyle:
        output = tmp_path / f"{style.value}.ass"
        settings = CaptionSettings(enabled=True, style=style)
        result = build_ass(
            words,
            clip_start=0,
            clip_duration=6.5,
            settings=settings,
            output_size=(1080, 1920),
            output_path=output,
        )
        assert result.event_count > 0
        event_lines = [
            line
            for line in output.read_text(encoding="utf-8").splitlines()
            if line.startswith("Dialogue:")
        ]
        assert len(event_lines) == result.event_count
        for line in event_lines:
            match = re.match(
                r"Dialogue: 0,(\d+:\d{2}:\d{2}\.\d{2}),(\d+:\d{2}:\d{2}\.\d{2}),", line
            )
            assert match, line
            assert _timestamp(match.group(2)) > _timestamp(match.group(1))


def test_captions_are_clipped_to_the_plan(tmp_path: Path) -> None:
    words = [Word(9.0, 9.4, "Outside"), Word(10.2, 10.8, "Inside"), Word(15.0, 15.4, "Later")]
    output = tmp_path / "clip.ass"
    result = build_ass(
        words,
        clip_start=10.0,
        clip_duration=2.0,
        settings=CaptionSettings(enabled=True),
        output_size=(1080, 1920),
        output_path=output,
    )
    text = output.read_text(encoding="utf-8")
    assert result.word_count == 1
    assert "Inside" in text
    assert "Outside" not in text.replace("\\N", "")
    assert "Later" not in text.replace("\\N", "")


def test_no_speech_produces_no_events(tmp_path: Path) -> None:
    output = tmp_path / "empty.ass"
    result = build_ass(
        [],
        clip_start=0,
        clip_duration=10,
        settings=CaptionSettings(enabled=True),
        output_size=(1080, 1920),
        output_path=output,
    )
    assert result.event_count == 0
    assert not output.exists()


def test_safe_caption_positions_stay_inside_safe_area() -> None:
    assert safe_caption_y(CaptionPosition.TOP, 1920) == pytest.approx(317)
    assert safe_caption_y(CaptionPosition.MIDDLE, 1920) == pytest.approx(941)
    assert safe_caption_y(CaptionPosition.BOTTOM, 1920) == 1536


def test_ass_text_escapes_override_characters(tmp_path: Path) -> None:
    output = tmp_path / "escape.ass"
    build_ass(
        [Word(0.2, 1.0, "{hello}\\world")],
        clip_start=0,
        clip_duration=2,
        settings=CaptionSettings(enabled=True, style=CaptionStyle.MINIMAL),
        output_size=(1080, 1920),
        output_path=output,
    )
    text = output.read_text(encoding="utf-8")
    assert "(hello)world" in text


def _timestamp(value: str) -> float:
    hours, minutes, rest = value.split(":")
    seconds = float(rest)
    return int(hours) * 3600 + int(minutes) * 60 + seconds
