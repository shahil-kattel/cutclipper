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
    CaptionWord,
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


def test_build_caption_segments_keeps_exact_word_timings_and_script() -> None:
    words = [
        Word(0.2, 0.55, "नमस्ते"),
        Word(0.6, 0.9, "साथी"),
        Word(0.95, 1.4, "YouTube"),
    ]
    segments = build_caption_segments(words)
    assert len(segments) == 1
    segment = segments[0]
    assert segment.language == "mixed"
    assert segment.words is not None
    assert [word.text for word in segment.words] == ["नमस्ते", "साथी", "YouTube"]
    assert [(word.start, word.end) for word in segment.words] == [
        (0.2, 0.55),
        (0.6, 0.9),
        (0.95, 1.4),
    ]


def test_words_from_segments_prefers_exact_word_timings() -> None:
    segment = CaptionSegment(
        start=0.5,
        end=3.0,
        text="नमस्ते साथी",
        words=[
            CaptionWord(start=0.6, end=0.9, text="नमस्ते"),
            CaptionWord(start=2.2, end=2.8, text="साथी"),
        ],
        language="ne",
    )
    words = words_from_segments([segment])
    assert [(word.start, word.end, word.text) for word in words] == [
        (0.6, 0.9, "नमस्ते"),
        (2.2, 2.8, "साथी"),
    ]


def test_words_from_segments_falls_back_when_edit_changes_token_count() -> None:
    segment = CaptionSegment(
        start=0.0,
        end=2.0,
        text="नमस्ते साथी हो",
        words=[
            CaptionWord(start=0.1, end=0.5, text="नमस्ते"),
            CaptionWord(start=0.6, end=1.0, text="साथी"),
        ],
    )
    words = words_from_segments([segment])
    assert [word.text for word in words] == ["नमस्ते", "साथी", "हो"]
    assert words[-1].end == pytest.approx(2.0)
    assert all(word.end > word.start for word in words)


def test_mixed_script_groups_use_the_fallback_font_only_where_needed(
    tmp_path: Path,
) -> None:
    output = tmp_path / "mixed.ass"
    build_ass(
        [Word(0.2, 0.6, "Hello"), Word(0.7, 1.2, "नमस्ते")],
        clip_start=0,
        clip_duration=2,
        settings=CaptionSettings(word_style=CaptionStyle.KARAOKE, font="Inter"),
        output_size=(1080, 1920),
        output_path=output,
    )
    text = output.read_text(encoding="utf-8")
    assert "Style: CutClipper,Inter,80" in text
    assert "{\\fnMukta}" in text


def test_nepali_caption_segments_correct_common_asr_mistakes() -> None:
    words = [
        Word(0.0, 0.4, "प्रमुख"),
        Word(0.4, 0.8, "त्यति"),
        Word(0.8, 1.2, "विशिष्ट"),
        Word(1.2, 1.6, "अत्यति"),
        Word(1.6, 2.0, "अत्यति"),
        Word(2.0, 2.4, "एउटा"),
        Word(2.4, 2.8, "एउटा"),
        Word(2.8, 3.2, "भिडियो"),
    ]
    segments = build_caption_segments(words)
    text = " ".join(segment.text for segment in segments)
    assert "प्रमुख अतिथि, विशिष्ट अतिथि, अतिथि" in text
    assert "एउटा एउटा" not in text


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


def test_secondary_caption_track_requires_caption_mode_and_ordered_lines() -> None:
    secondary = [CaptionSegment(start=1.0, end=2.0, text="नमस्ते")]
    with pytest.raises(ValidationError):
        CreateJobRequest(
            url="https://example.com/video.mp4",
            mode=JobMode.CLIPS,
            secondary_segments=secondary,
        )
    with pytest.raises(ValidationError):
        CreateJobRequest(
            mode=JobMode.CAPTIONS,
            upload_id="a" * 32,
            secondary_segments=secondary,
        )
    with pytest.raises(ValidationError):
        CreateJobRequest(
            mode=JobMode.CAPTIONS,
            upload_id="a" * 32,
            segments=[CaptionSegment(start=0.0, end=1.0, text="Hello")],
            secondary_segments=[
                CaptionSegment(start=1.0, end=2.0, text="नमस्ते"),
                CaptionSegment(start=1.5, end=2.5, text="संसार"),
            ],
        )
    request = CreateJobRequest(
        mode=JobMode.CAPTIONS,
        upload_id="a" * 32,
        segments=[CaptionSegment(start=0.0, end=2.0, text="Hello world")],
        secondary_segments=[
            CaptionSegment(start=1.0, end=2.0, text="संसार"),
            CaptionSegment(start=0.0, end=1.0, text="नमस्ते"),
        ],
    )
    assert [segment.text for segment in request.secondary_segments or []] == [
        "नमस्ते",
        "संसार",
    ]


def test_bilingual_captions_burn_nepali_line_in_its_own_font(tmp_path: Path) -> None:
    primary = [Word(0.2, 1.0, "Hello,"), Word(1.1, 2.0, "world.")]
    secondary = [Word(0.2, 1.0, "नमस्ते,"), Word(1.1, 2.0, "संसार।")]
    output = tmp_path / "bilingual.ass"
    result = build_ass(
        primary,
        clip_start=0,
        clip_duration=2.2,
        settings=CaptionSettings(
            font="Inter",
            secondary_enabled=True,
            secondary_font="Noto Sans Devanagari",
        ),
        output_size=(1080, 1920),
        output_path=output,
        secondary_words=secondary,
    )
    text = output.read_text(encoding="utf-8")
    assert result.event_count > 0
    assert "नमस्ते," in text
    assert "संसार।" in text
    # The Nepali line selects its own Devanagari face, then resets to the
    # primary font so the animated English words keep the chosen typeface.
    assert "{\\fnNoto Sans Devanagari\\fs64}" in text
    assert "\\N{\\fnInter\\fs80}" in text
    assert text.index("नमस्ते,") < text.index("Hello,")


def test_bilingual_captions_keep_box_alignment_with_secondary_line(tmp_path: Path) -> None:
    primary = [Word(0.2, 1.0, "Hello,"), Word(1.1, 2.0, "world.")]
    secondary = [Word(0.2, 1.0, "नमस्ते,"), Word(1.1, 2.0, "संसार।")]
    output = tmp_path / "bilingual-box.ass"
    result = build_ass(
        primary,
        clip_start=0,
        clip_duration=2.2,
        settings=CaptionSettings(
            word_style=CaptionStyle.BOX,
            line_style=None,
            position=CaptionPosition.TOP,
            secondary_enabled=True,
            secondary_font="Mukta",
        ),
        output_size=(1080, 1920),
        output_path=output,
        secondary_words=secondary,
    )
    assert result.event_count > 0
    text = output.read_text(encoding="utf-8")
    assert "\\p1" in text  # the active-word box still renders
    assert "नमस्ते," in text


def test_bilingual_captions_can_be_disabled(tmp_path: Path) -> None:
    primary = [Word(0.2, 1.0, "Hello,"), Word(1.1, 2.0, "world.")]
    secondary = [Word(0.2, 1.0, "नमस्ते,"), Word(1.1, 2.0, "संसार।")]
    output = tmp_path / "single.ass"
    build_ass(
        primary,
        clip_start=0,
        clip_duration=2.2,
        settings=CaptionSettings(font="Inter", secondary_enabled=False),
        output_size=(1080, 1920),
        output_path=output,
        secondary_words=secondary,
    )
    text = output.read_text(encoding="utf-8")
    assert "नमस्ते" not in text
    assert "संसार" not in text


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
    assert "Style: CutClipper,Inter,80" in text
    assert "{\\fnMukta}" in text


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


def test_caption_density_limits_words_and_lines() -> None:
    from app.pipeline import captions as caption_module

    words = [Word(index * 0.5, index * 0.5 + 0.4, f"word{index}") for index in range(9)]
    groups = caption_module._make_groups(
        words,
        font_size=40,
        target_width=1080,
        max_words=3,
        max_lines=1,
    )
    assert groups
    for group in groups:
        assert sum(len(line) for line in group.lines) <= 3
        assert len(group.lines) == 1


def test_devanagari_combining_marks_do_not_force_an_extra_wrap() -> None:
    from app.pipeline import captions as caption_module

    words = [Word(0.0, 0.9, "नमस्ते"), Word(1.0, 1.9, "संसारा।")]
    groups = caption_module._make_groups(words, font_size=140, target_width=1080)
    assert len(groups) == 1
    assert len(groups[0].lines) == 1
    assert caption_module._estimated_width("नमस्ते संसारा।", 140) < 1080 * 0.81


def _timestamp(value: str) -> float:
    hours, minutes, rest = value.split(":")
    seconds = float(rest)
    return int(hours) * 3600 + int(minutes) * 60 + seconds
