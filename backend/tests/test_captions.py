from __future__ import annotations

import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.caption_fonts import CAPTION_FONT_NAMES, CAPTION_FONT_SPECS
from app.pipeline.captions import (
    build_ass,
    build_caption_segments,
    safe_caption_y,
    words_from_segments,
)
from app.pipeline.types import Word
from app.schemas import (
    CaptionFontStyle,
    CaptionPosition,
    CaptionSegment,
    CaptionSettings,
    CaptionStyle,
    CaptionTextCase,
    CreateJobRequest,
    JobMode,
    TranscribeRequest,
)


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


@pytest.mark.parametrize(
    ("style", "expected_fragment"),
    [
        (CaptionStyle.BOUNCE, "\\fscx128"),
        (CaptionStyle.HIGHLIGHT, "\\bord2.5"),
        (CaptionStyle.NEON, "\\blur1.3"),
        (CaptionStyle.SLIDE, "\\move("),
        (CaptionStyle.FADE_UP, "\\fad(160,120)"),
        (CaptionStyle.ZOOM_IN, "\\fscx84"),
        (CaptionStyle.STAMP, "\\fscx142"),
        (CaptionStyle.TILT, "\\frz-5"),
        (CaptionStyle.SPOTLIGHT, "\\alpha&H60&"),
        (CaptionStyle.UNDERLINE, "\\u1"),
        (CaptionStyle.PULSE, "\\fscx112"),
        (CaptionStyle.WIGGLE, "\\frz4"),
        (CaptionStyle.RAINBOW, "&H8A6BFF&"),
        (CaptionStyle.SOFT_BLUR, "\\blur4"),
    ],
)
def test_new_caption_presets_emit_their_signature_tags(
    tmp_path: Path, words: list[Word], style: CaptionStyle, expected_fragment: str
) -> None:
    output = tmp_path / f"{style.value}.ass"
    build_ass(
        words,
        clip_start=0,
        clip_duration=6.5,
        settings=CaptionSettings(enabled=True, style=style),
        output_size=(1080, 1920),
        output_path=output,
    )
    assert expected_fragment in output.read_text(encoding="utf-8")


def test_devanagari_caption_segments_respect_danda_and_pauses() -> None:
    words = [
        Word(0.2, 0.5, "यो"),
        Word(0.55, 1.0, "नेपाली"),
        Word(1.05, 1.4, "भाषा"),
        Word(1.45, 1.7, "हो।"),
        Word(2.6, 3.0, "अर्को"),
        Word(3.05, 3.4, "वाक्य।"),
    ]
    segments = build_caption_segments(words)
    assert len(segments) == 2
    assert segments[0].text == "यो नेपाली भाषा हो।"
    assert segments[1].text == "अर्को वाक्य।"
    assert segments[0].end <= segments[1].start


def test_words_from_segments_preserve_edited_caption_timing() -> None:
    segments = [
        CaptionSegment(start=1.0, end=3.0, text="नमस्ते संसार"),
        CaptionSegment(start=4.0, end=5.0, text="Hello world"),
    ]
    words = words_from_segments(segments)
    assert [word.text for word in words] == ["नमस्ते", "संसार", "Hello", "world"]
    assert words[0].start == pytest.approx(1.0)
    assert words[-1].end == pytest.approx(5.0)
    assert all(word.end > word.start for word in words)


def test_caption_job_requires_upload_and_valid_segments() -> None:
    with pytest.raises(ValidationError):
        CreateJobRequest(mode=JobMode.CAPTIONS, url="https://example.com/video.mp4")
    with pytest.raises(ValidationError):
        CreateJobRequest(
            mode=JobMode.CAPTIONS,
            upload_id="a" * 32,
            segments=[
                CaptionSegment(start=1.0, end=2.0, text="One"),
                CaptionSegment(start=1.5, end=2.5, text="Overlap"),
            ],
        )
    request = CreateJobRequest(
        mode=JobMode.CAPTIONS,
        upload_id="a" * 32,
        segments=[
            CaptionSegment(start=2.0, end=3.0, text="Second"),
            CaptionSegment(start=1.0, end=1.9, text="First"),
        ],
    )
    assert [segment.text for segment in request.segments or []] == ["First", "Second"]


def test_transcribe_request_validates_nepali_quality() -> None:
    request = TranscribeRequest(upload_id="a" * 32, language="ne", quality="best")
    assert request.quality == "best"
    with pytest.raises(ValidationError):
        TranscribeRequest(upload_id="a" * 32, language="ne", quality="ultra")


def test_new_fonts_are_accepted_by_caption_settings() -> None:
    for font in (
        "Space Grotesk",
        "Poppins",
        "Bebas Neue",
        "Mukta",
        "Noto Sans Devanagari",
        "Hind",
        "Kalam",
    ):
        settings = CaptionSettings(font=font)
        assert settings.font == font


def test_caption_font_catalog_has_about_fifty_fonts_with_assets() -> None:
    assert len(CAPTION_FONT_NAMES) >= 50
    assert len(CAPTION_FONT_NAMES) == len(set(CAPTION_FONT_NAMES))
    categories = {spec.category for spec in CAPTION_FONT_SPECS}
    assert {
        "Sans Serif",
        "Serif",
        "Display",
        "Handwritten",
        "Monospace",
        "Rounded",
        "Devanagari",
        "System",
    } <= categories
    root = Path(__file__).resolve().parents[1] / "assets" / "fonts"
    for spec in CAPTION_FONT_SPECS:
        if spec.category == "System":
            continue
        assert spec.files.get("regular"), spec.name
        for filename in spec.files.values():
            assert (root / filename).is_file(), filename
    for name in CAPTION_FONT_NAMES:
        assert CaptionSettings(font=name).font == name


def test_font_style_case_and_spacing_reach_the_ass_style_line(
    tmp_path: Path, words: list[Word]
) -> None:
    output = tmp_path / "style.ass"
    build_ass(
        words,
        clip_start=0,
        clip_duration=6.5,
        settings=CaptionSettings(
            font="Lora",
            font_style=CaptionFontStyle.BOLD_ITALIC,
            letter_spacing=4.5,
            text_case=CaptionTextCase.UPPERCASE,
            style=CaptionStyle.KARAOKE,
        ),
        output_size=(1080, 1920),
        output_path=output,
    )
    text = output.read_text(encoding="utf-8")
    assert "Style: CutClipper,Lora,80" in text
    assert ",80,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,-1,0,0,100,100,4.5,0" in text
    assert "WELCOME" in text
    assert "Welcome" not in text


def test_restyle_request_only_accepts_known_fonts() -> None:
    with pytest.raises(ValidationError):
        CaptionSettings(font="Definitely Not A Font")


def test_word_play_and_line_entrance_combine(tmp_path: Path, words: list[Word]) -> None:
    output = tmp_path / "combined.ass"
    settings = CaptionSettings(
        enabled=True,
        word_style=CaptionStyle.KARAOKE,
        line_style=CaptionStyle.FADE_UP,
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
    # The spoken word still gets its karaoke accent...
    assert "\\c&HEED322&" in text
    # ...while the whole block keeps a fade-up entrance instead of restarting it.
    assert "\\move(540," in text
    assert "\\t(0," in text
    assert "\\alpha&HFF&" in text
    first_word_event = next(
        line for line in text.splitlines() if line.startswith("Dialogue:") and "Welcome" in line
    )
    assert "\\move(" in first_word_event
    assert "\\c&HEED322&" in first_word_event


def test_word_and_line_styles_are_separately_selectable(tmp_path: Path, words: list[Word]) -> None:
    word_only = CaptionSettings(word_style=CaptionStyle.POP, line_style=None)
    line_only = CaptionSettings(word_style=None, line_style=CaptionStyle.ZOOM_IN)
    static = CaptionSettings(word_style=None, line_style=None)

    word_text = build_ass(
        words,
        clip_start=0,
        clip_duration=6.5,
        settings=word_only,
        output_size=(1080, 1920),
        output_path=tmp_path / "word.ass",
    )
    line_text = build_ass(
        words,
        clip_start=0,
        clip_duration=6.5,
        settings=line_only,
        output_size=(1080, 1920),
        output_path=tmp_path / "line.ass",
    )
    static_text = build_ass(
        words,
        clip_start=0,
        clip_duration=6.5,
        settings=static,
        output_size=(1080, 1920),
        output_path=tmp_path / "static.ass",
    )
    word_ass = (tmp_path / "word.ass").read_text(encoding="utf-8")
    line_ass = (tmp_path / "line.ass").read_text(encoding="utf-8")
    static_ass = (tmp_path / "static.ass").read_text(encoding="utf-8")
    assert word_text.event_count > static_text.event_count
    assert line_text.event_count == static_text.event_count
    assert "\\fscx114" in word_ass and "\\fscx84" not in word_ass
    assert "\\fscx84" in line_ass and "\\fscx114" not in line_ass
    assert "\\fscx84" not in static_ass and "\\fscx114" not in static_ass


def test_box_word_style_draws_a_rectangle_behind_the_active_word(
    tmp_path: Path, words: list[Word]
) -> None:
    output = tmp_path / "box.ass"
    result = build_ass(
        words,
        clip_start=0,
        clip_duration=6.5,
        settings=CaptionSettings(word_style=CaptionStyle.BOX, line_style=None),
        output_size=(1080, 1920),
        output_path=output,
    )
    text = output.read_text(encoding="utf-8")
    assert "\\p1" in text
    assert "m " in text and " l " in text
    assert "\\c&HEED322&" in text  # highlight colour, BGR, used for the marker
    # Every spoken word gets a marker event plus its text event.
    assert result.event_count >= 2 * len(words)


def test_word_spacing_scopes_extra_tracking_to_the_space(tmp_path: Path, words: list[Word]) -> None:
    output = tmp_path / "spacing.ass"
    build_ass(
        words,
        clip_start=0,
        clip_duration=6.5,
        settings=CaptionSettings(
            word_style=None,
            line_style=None,
            word_spacing=40,
        ),
        output_size=(1080, 1920),
        output_path=output,
    )
    text = output.read_text(encoding="utf-8")
    assert "{\\fsp40} {\\fsp0}" in text


def test_word_and_line_style_buckets_are_validated() -> None:
    with pytest.raises(ValidationError):
        CaptionSettings(word_style=CaptionStyle.SLIDE)
    with pytest.raises(ValidationError):
        CaptionSettings(line_style=CaptionStyle.KARAOKE)
    with pytest.raises(ValidationError):
        CaptionSettings(word_spacing=-1)


def test_legacy_style_maps_to_the_matching_bucket() -> None:
    word = CaptionSettings(style=CaptionStyle.POP)
    assert word.word_style == CaptionStyle.POP
    assert word.line_style is None

    line = CaptionSettings(style=CaptionStyle.SLIDE)
    assert line.word_style is None
    assert line.line_style == CaptionStyle.SLIDE

    default = CaptionSettings()
    assert default.word_style == CaptionStyle.KARAOKE
    assert default.line_style is None


def test_legacy_style_is_accepted_but_not_serialized() -> None:
    payload = CaptionSettings(style=CaptionStyle.ZOOM_IN).model_dump()
    assert "style" not in payload
    assert payload["word_style"] is None
    assert payload["line_style"] == CaptionStyle.ZOOM_IN
    assert payload["word_spacing"] == 0.0


def test_devanagari_text_falls_back_to_a_devanagari_font(tmp_path: Path) -> None:
    output = tmp_path / "devanagari.ass"
    build_ass(
        [Word(0.2, 0.6, "नमस्ते"), Word(0.7, 1.2, "संसार")],
        clip_start=0,
        clip_duration=2,
        settings=CaptionSettings(word_style=CaptionStyle.KARAOKE, font="Inter"),
        output_size=(1080, 1920),
        output_path=output,
    )
    text = output.read_text(encoding="utf-8")
    assert "Style: CutClipper,Mukta,80" in text
    assert "Style: CutClipper,Inter,80" not in text


def test_latin_text_keeps_the_requested_font(tmp_path: Path) -> None:
    output = tmp_path / "latin.ass"
    build_ass(
        [Word(0.2, 0.6, "Hello")],
        clip_start=0,
        clip_duration=1,
        settings=CaptionSettings(word_style=CaptionStyle.KARAOKE, font="Inter"),
        output_size=(1080, 1920),
        output_path=output,
    )
    assert "Style: CutClipper,Inter,80" in output.read_text(encoding="utf-8")


def _timestamp(value: str) -> float:
    hours, minutes, rest = value.split(":")
    seconds = float(rest)
    return int(hours) * 3600 + int(minutes) * 60 + seconds
