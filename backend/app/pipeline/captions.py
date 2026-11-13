"""Generate animated ASS captions with safe margins and word-level timing."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.caption_fonts import font_spec
from app.pipeline.types import CaptionRenderResult, Word
from app.schemas import (
    CaptionFontStyle,
    CaptionPosition,
    CaptionSegment,
    CaptionSettings,
    CaptionStyle,
    CaptionTextCase,
)

_SAFE_SIDE_FRACTION = 0.095
_MAX_LINES = 2
_MAX_GROUP_WORDS = 9
_MAX_GROUP_SECONDS = 6.4
_MIN_EVENT_SECONDS = 0.04
# The Nepali source line is secondary to the translated line. Keep it slightly
# smaller so both lines fit inside the same safe area.
_SECONDARY_SIZE_RATIO = 0.8
_SECONDARY_MAX_LINES = 2
_SENTENCE_END_RE = re.compile(r"""[.!?…।॥。！？]["'”’)\]]*$""")
_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")
_DEVANAGARI_PUNCT_SPACE_RE = re.compile(r"\s+([,;:!?%)\]।॥])")
_RAINBOW_COLOURS = ("#FF6B8A", "#FFD166", "#7BD389", "#4CC9F0", "#B69CFF")
_ENTRANCE_DURATIONS_MS: dict[CaptionStyle, int] = {
    CaptionStyle.SLIDE: 420,
    CaptionStyle.FADE_UP: 360,
    CaptionStyle.ZOOM_IN: 280,
    CaptionStyle.STAMP: 150,
    CaptionStyle.TILT: 360,
    CaptionStyle.SOFT_BLUR: 320,
    CaptionStyle.MINIMAL: 100,
}
_ENTRANCE_FADE_MS: dict[CaptionStyle, int] = {
    CaptionStyle.SLIDE: 200,
    CaptionStyle.FADE_UP: 160,
    CaptionStyle.ZOOM_IN: 120,
    CaptionStyle.STAMP: 60,
    CaptionStyle.TILT: 160,
    CaptionStyle.SOFT_BLUR: 160,
    CaptionStyle.MINIMAL: 100,
}


@dataclass(slots=True)
class _WordRef:
    text: str
    start: float
    end: float


@dataclass(slots=True)
class _Group:
    lines: list[list[_WordRef]]
    start: float
    end: float


def _ass_time(seconds: float) -> str:
    centiseconds = max(0, round(seconds * 100))
    hours, remainder = divmod(centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    secs, cs = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{cs:02d}"


def _ass_colour(value: str, alpha: int = 0) -> str:
    value = value.lstrip("#")
    red, green, blue = (int(value[i : i + 2], 16) for i in (0, 2, 4))
    return f"&H{alpha:02X}{blue:02X}{green:02X}{red:02X}"


def _ass_inline_colour(value: str) -> str:
    value = value.lstrip("#")
    red, green, blue = (int(value[i : i + 2], 16) for i in (0, 2, 4))
    return f"&H{blue:02X}{green:02X}{red:02X}&"


def _clean_caption_text(value: str) -> str:
    cleaned = value.replace("\\", "").replace("{", "(").replace("}", ")")
    return " ".join(cleaned.replace("\r", " ").replace("\n", " ").split()).strip()


def _join_caption_text(parts: list[str]) -> str:
    text = " ".join(parts).strip()
    if _DEVANAGARI_RE.search(text):
        text = _DEVANAGARI_PUNCT_SPACE_RE.sub(r"\1", text)
    return text


def _case_text(value: str, text_case: CaptionTextCase) -> str:
    if text_case == CaptionTextCase.UPPERCASE:
        return value.upper()
    if text_case == CaptionTextCase.LOWERCASE:
        return value.lower()
    return value


def _char_units(char: str) -> float:
    if char == " ":
        return 0.28
    if char in "ilI.,'!:;|":
        return 0.32
    if char in "mwMW@":
        return 0.85
    if char.isupper():
        return 0.63
    return 0.53


def _estimated_width(text: str, font_size: int) -> float:
    return sum(_char_units(char) for char in text) * font_size


def _line_width(
    words: list[_WordRef],
    font_size: int,
    *,
    letter_spacing: float = 0.0,
    word_spacing: float = 0.0,
) -> float:
    if not words:
        return 0.0
    gap = font_size * 0.26 + letter_spacing + word_spacing
    return (
        sum(
            _estimated_width(word.text, font_size) + len(word.text) * letter_spacing
            for word in words
        )
        + max(0, len(words) - 1) * gap
    )


def _make_groups(
    words: list[_WordRef],
    *,
    font_size: int,
    target_width: int,
    letter_spacing: float = 0.0,
    word_spacing: float = 0.0,
) -> list[_Group]:
    available_width = target_width * (1 - 2 * _SAFE_SIDE_FRACTION)
    groups: list[_Group] = []
    lines: list[list[_WordRef]] = [[]]
    group_start = words[0].start if words else 0.0
    previous: _WordRef | None = None

    def flush() -> None:
        nonlocal lines
        populated = [line for line in lines if line]
        if populated:
            groups.append(
                _Group(
                    lines=populated,
                    start=group_start,
                    end=populated[-1][-1].end,
                )
            )
        lines = [[]]

    for word in words:
        if previous is not None:
            gap = word.start - previous.end
            sentence_ended = bool(_SENTENCE_END_RE.search(previous.text))
            too_long = word.end - group_start > _MAX_GROUP_SECONDS
            too_many = sum(len(line) for line in lines) >= _MAX_GROUP_WORDS
            if gap > 0.72 or sentence_ended or too_long or too_many:
                flush()
                group_start = word.start
        if lines == [[]]:
            group_start = word.start

        current_line = lines[-1]
        projected = [*current_line, word]
        if (
            current_line
            and _line_width(
                projected,
                font_size,
                letter_spacing=letter_spacing,
                word_spacing=word_spacing,
            )
            > available_width
        ):
            if len(lines) >= _MAX_LINES:
                flush()
                group_start = word.start
            else:
                lines.append([])
        if not lines:
            lines = [[]]
        if not lines[-1] and len(lines) > _MAX_LINES:
            flush()
            group_start = word.start
        lines[-1].append(word)
        previous = word

    populated = [line for line in lines if line]
    if populated:
        groups.append(_Group(lines=populated, start=group_start, end=populated[-1][-1].end))
    return groups


def _position(
    position: CaptionPosition,
    width: int,
    height: int,
) -> tuple[int, int, int]:
    if position == CaptionPosition.TOP:
        return width // 2, round(height * 0.165), 8
    if position == CaptionPosition.MIDDLE:
        return width // 2, round(height * 0.49), 5
    return width // 2, round(height * 0.80), 2


def _separator(word_spacing: float, letter_spacing: float) -> str:
    """Widen the gap between words with a scoped Spacing override.

    The override is applied to the space glyph only and reset to the line's
    letter spacing afterwards, so letters keep their configured tracking.
    """

    if word_spacing <= 0:
        return " "
    return f"{{\\fsp{word_spacing + letter_spacing:g}}} " f"{{\\fsp{letter_spacing:g}}}"


def _space_width(font_size: int) -> float:
    return _estimated_width(" ", font_size)


def _typed_word_text(word: _WordRef, reveal_before: float) -> str:
    """Reveal a word character by character, keeping the line width stable."""

    duration = max(0.001, word.end - word.start)
    visible = 0
    for char_index in range(len(word.text)):
        reveal_at = word.start + duration * (char_index / max(1, len(word.text)))
        if reveal_at <= reveal_before + 0.0001:
            visible = char_index + 1
    if visible <= 0:
        return f"{{\\alpha&HFF&}}{word.text}{{\\alpha&H00&}}"
    if visible >= len(word.text):
        return word.text
    return f"{word.text[:visible]}" f"{{\\alpha&HFF&}}{word.text[visible:]}{{\\alpha&H00&}}"


def _word_style_tags(
    style: CaptionStyle | None,
    *,
    flat_index: int,
    active: bool,
    base_colour: str,
    active_colour: str,
    outline_width: float,
    shadow: float,
) -> tuple[str, str]:
    """Return the ASS tags that wrap a single word for the chosen word play."""

    if style is None:
        return "", ""
    base = _ass_inline_colour(base_colour)
    active_ink = _ass_inline_colour(active_colour)
    if style == CaptionStyle.RAINBOW:
        colour = _ass_inline_colour(_RAINBOW_COLOURS[flat_index % len(_RAINBOW_COLOURS)])
        if active:
            return (
                f"{{\\c{colour}\\fscx112\\fscy112\\t(0,140,\\fscx100\\fscy100)}}",
                f"{{\\c{base}\\fscx100\\fscy100}}",
            )
        return f"{{\\c{colour}}}", ""
    if style == CaptionStyle.POP:
        if active:
            return (
                f"{{\\alpha&H00&\\c{active_ink}\\fscx114\\fscy114" "\\t(0,130,\\fscx100\\fscy100)}",
                f"{{\\c{base}}}",
            )
        return "", ""
    if style == CaptionStyle.SPOTLIGHT:
        if active:
            return f"{{\\alpha&H00&\\c{active_ink}}}", f"{{\\c{base}\\alpha&H60&}}"
        return "{\\alpha&H60&}", ""
    if not active:
        return "", ""
    if style == CaptionStyle.KARAOKE:
        return f"{{\\c{active_ink}}}", f"{{\\c{base}}}"
    if style == CaptionStyle.BOUNCE:
        return (
            f"{{\\c{active_ink}\\fscx128\\fscy128\\t(0,110,\\fscx100\\fscy100)}}",
            f"{{\\c{base}}}",
        )
    if style == CaptionStyle.UNDERLINE:
        return f"{{\\c{active_ink}\\u1}}", f"{{\\c{base}\\u0}}"
    if style == CaptionStyle.PULSE:
        return (
            f"{{\\c{active_ink}\\fscx112\\fscy112"
            "\\t(0,150,\\fscx100\\fscy100)"
            "\\t(150,300,\\fscx108\\fscy108)"
            "\\t(300,450,\\fscx100\\fscy100)}}",
            f"{{\\c{base}\\fscx100\\fscy100}}",
        )
    if style == CaptionStyle.WIGGLE:
        return (
            f"{{\\c{active_ink}\\frz4\\fscx108\\fscy108"
            "\\t(0,90,\\frz-4)\\t(90,180,\\frz4)\\t(180,280,\\frz0)"
            "\\t(0,120,\\fscx100\\fscy100)}}",
            f"{{\\c{base}\\frz0\\fscx100\\fscy100}}",
        )
    if style == CaptionStyle.NEON:
        # Keep the glyph fill readable and put the glow in the outline/shadow.
        return (
            f"{{\\c{base}\\3c{active_ink}\\4c{active_ink}"
            "\\blur1.3\\bord4\\shad2\\fscx106\\fscy106}",
            f"{{\\c{base}\\3c&H000000&\\4c&H000000&\\blur0"
            f"\\bord{outline_width:.1f}\\shad{shadow:.1f}\\fscx100\\fscy100}}",
        )
    if style == CaptionStyle.HIGHLIGHT:
        # Accent fill with a crisp dark outline reads like a marker stroke.
        return (
            f"{{\\c{active_ink}\\3c&H12070B&\\bord2.5\\shad0\\fscx106\\fscy106}}",
            f"{{\\c{base}\\3c&H000000&\\bord{outline_width:.1f}"
            f"\\shad{shadow:.1f}\\fscx100\\fscy100}}",
        )
    # BOX keeps the text plain; the rectangle is emitted as its own drawing event.
    return "", ""


def _styled_group_text(
    group: _Group,
    active_word: int,
    *,
    word_style: CaptionStyle | None,
    base_colour: str,
    active_colour: str,
    outline_width: float,
    shadow: float,
    separator: str,
    reveal_before: float | None = None,
) -> str:
    """Build one ASS text line with word-level styling and optional typing reveal."""

    parts: list[str] = []
    flat_index = 0
    hide_after_active = word_style == CaptionStyle.POP and reveal_before is None
    for line_index, line in enumerate(group.lines):
        for word_index, word in enumerate(line):
            active = flat_index == active_word
            text = _typed_word_text(word, reveal_before) if reveal_before is not None else word.text
            prefix, suffix = _word_style_tags(
                word_style,
                flat_index=flat_index,
                active=active,
                base_colour=base_colour,
                active_colour=active_colour,
                outline_width=outline_width,
                shadow=shadow,
            )
            if hide_after_active and flat_index > active_word:
                prefix = "{\\alpha&HFF&}" + prefix
                suffix = suffix + "{\\alpha&H00&}"
            parts.append(prefix)
            parts.append(text)
            parts.append(suffix)
            flat_index += 1
            if word_index + 1 < len(line):
                parts.append(separator)
        if line_index + 1 < len(group.lines):
            parts.append("\\N")
    return "".join(parts)


def _group_entrance_tag(
    line_style: CaptionStyle | None,
    *,
    x: int,
    y: int,
    alignment: int,
    height: int,
) -> str:
    """Whole-block entrance animation used when no word play is selected."""

    if line_style is None:
        return f"{{\\an{alignment}\\pos({x},{y})\\q0}}"
    if line_style == CaptionStyle.SLIDE:
        return (
            f"{{\\an{alignment}\\move({x},{y + round(height * 0.035)},{x},{y},0,420)"
            "\\fad(200,140)}"
        )
    if line_style == CaptionStyle.FADE_UP:
        return (
            f"{{\\an{alignment}\\move({x},{y + round(height * 0.045)},{x},{y},0,360)"
            "\\fad(160,120)}"
        )
    if line_style == CaptionStyle.ZOOM_IN:
        return (
            f"{{\\an{alignment}\\pos({x},{y})\\q0\\fscx84\\fscy84"
            "\\t(0,280,\\fscx100\\fscy100)\\fad(120,100)}"
        )
    if line_style == CaptionStyle.STAMP:
        return (
            f"{{\\an{alignment}\\pos({x},{y})\\q0\\fscx142\\fscy142\\frz-5"
            "\\t(0,150,\\fscx100\\fscy100\\frz0)\\fad(60,80)}"
        )
    if line_style == CaptionStyle.TILT:
        return f"{{\\an{alignment}\\pos({x},{y})\\q0\\frz-5" "\\t(0,360,\\frz0)\\fad(160,100)}"
    if line_style == CaptionStyle.SOFT_BLUR:
        return f"{{\\an{alignment}\\pos({x},{y})\\q0\\blur4" "\\t(0,320,\\blur0)\\fad(160,120)}"
    if line_style == CaptionStyle.MINIMAL:
        return f"{{\\an{alignment}\\pos({x},{y})\\q0}}{{\\fad(100,120)}}"
    return f"{{\\an{alignment}\\pos({x},{y})\\q0}}"


def _word_event_entrance_tag(
    line_style: CaptionStyle | None,
    *,
    elapsed: float,
    x: int,
    y: int,
    alignment: int,
    height: int,
    drawing: bool = False,
) -> str:
    """Continue a block entrance on a later word event without restarting it."""

    anchor = 7 if drawing else alignment
    base = f"\\an{anchor}\\pos({x},{y})\\q0"
    if line_style is None or line_style == CaptionStyle.TYPEWRITER:
        return "{" + base + "}"
    duration_ms = _ENTRANCE_DURATIONS_MS.get(line_style)
    if not duration_ms:
        return "{" + base + "}"
    elapsed_ms = max(0.0, elapsed * 1000.0)
    if elapsed_ms >= duration_ms:
        return "{" + base + "}"
    progress = min(1.0, elapsed_ms / duration_ms)
    remaining = max(1, round(duration_ms - elapsed_ms))
    fade_ms = _ENTRANCE_FADE_MS.get(line_style, duration_ms)
    fade_remaining = max(0, round(fade_ms - elapsed_ms))
    fade_tags = ""
    if fade_remaining > 0:
        alpha = max(0, min(255, round(255 * (1 - elapsed_ms / max(1, fade_ms)))))
        fade_tags = f"\\alpha&H{alpha:02X}&\\t(0,{fade_remaining},\\alpha&H00&)"
    if line_style in (CaptionStyle.SLIDE, CaptionStyle.FADE_UP):
        dy_fraction = 0.035 if line_style == CaptionStyle.SLIDE else 0.045
        dy = round(height * dy_fraction)
        eased = 1 - (1 - progress) ** 3
        dy_now = round(dy * (1 - eased))
        return f"{{\\an{anchor}\\move({x},{y + dy_now},{x},{y},0,{remaining})" f"\\q0{fade_tags}}}"
    if line_style == CaptionStyle.ZOOM_IN:
        scale = round(84 + 16 * progress)
        return (
            f"{{\\an{anchor}\\pos({x},{y})\\q0\\fscx{scale}\\fscy{scale}"
            f"\\t(0,{remaining},\\fscx100\\fscy100){fade_tags}}}"
        )
    if line_style == CaptionStyle.STAMP:
        eased = 1 - (1 - progress) ** 2
        scale = round(142 - 42 * eased)
        rotation = round(-5 * (1 - eased))
        return (
            f"{{\\an{anchor}\\pos({x},{y})\\q0\\fscx{scale}\\fscy{scale}"
            f"\\frz{rotation}\\t(0,{remaining},\\fscx100\\fscy100\\frz0)"
            f"{fade_tags}}}"
        )
    if line_style == CaptionStyle.TILT:
        eased = 1 - (1 - progress) ** 3
        rotation = round(-5 * (1 - eased))
        return (
            f"{{\\an{anchor}\\pos({x},{y})\\q0\\frz{rotation}"
            f"\\t(0,{remaining},\\frz0){fade_tags}}}"
        )
    if line_style == CaptionStyle.SOFT_BLUR:
        eased = 1 - (1 - progress) ** 3
        blur = 4 * (1 - eased)
        return (
            f"{{\\an{anchor}\\pos({x},{y})\\q0\\blur{blur:.2f}"
            f"\\t(0,{remaining},\\blur0){fade_tags}}}"
        )
    if line_style == CaptionStyle.MINIMAL:
        return f"{{\\an{anchor}\\pos({x},{y})\\q0{fade_tags}}}"
    return "{" + base + "}"


def _box_rectangle(
    group: _Group,
    active_word: int,
    *,
    font_size: int,
    letter_spacing: float,
    word_spacing: float,
    x: int,
    y: int,
    alignment: int,
    colour: str,
    leading_height: float = 0.0,
) -> str | None:
    """Draw a marker rectangle behind the active word.

    Coordinates are relative to the ASS anchor (x, y) so the rectangle shares
    the same entrance transform as the text event it accompanies.
    """

    gap_width = _space_width(font_size) + letter_spacing + word_spacing
    line_height = font_size * 1.2
    block_height = line_height * len(group.lines)
    if alignment == 2:
        # Bottom-aligned: the primary lines stay where they were and the
        # secondary line grows above them.
        block_top = y - block_height
    elif alignment == 5:
        # Centred: extra leading lines push the primary block down by half
        # of their height.
        block_top = y - block_height / 2 + leading_height / 2
    else:
        block_top = y + leading_height

    flat_index = 0
    for line_index, line in enumerate(group.lines):
        widths = [
            _estimated_width(word.text, font_size) + len(word.text) * letter_spacing
            for word in line
        ]
        line_width = sum(widths) + gap_width * max(0, len(line) - 1)
        left = x - line_width / 2
        for width in widths:
            if flat_index == active_word:
                baseline = block_top + line_index * line_height + font_size * 0.92
                pad_x = font_size * 0.07
                pad_y = font_size * 0.1
                top = baseline - font_size * 0.78 - pad_y
                bottom = baseline + font_size * 0.2 + pad_y
                right = left + width
                return (
                    f"{{\\p1\\c{_ass_inline_colour(colour)}\\alpha&H4D&}}"
                    f"m {round(left - x - pad_x)} {round(top - y)} "
                    f"l {round(right - x + pad_x)} {round(top - y)} "
                    f"l {round(right - x + pad_x)} {round(bottom - y)} "
                    f"l {round(left - x - pad_x)} {round(bottom - y)}"
                    "{\\p0}"
                )
            left += width + gap_width
            flat_index += 1
    return None


def _active_word_index(words: list[_WordRef], time: float) -> int:
    active = -1
    for index, word in enumerate(words):
        if word.start <= time + 0.0001:
            active = index
        else:
            break
    return active


def _event_end(flat_words: list[_WordRef], index: int, fallback: float) -> float:
    return flat_words[index + 1].start if index + 1 < len(flat_words) else fallback


def _caption_font_for(refs: list[_WordRef], requested: str) -> str:
    """Fall back to a Devanagari-capable face when the text needs one.

    Auto-detected Nepali can arrive while the user still has a Latin-only font
    selected; rendering that with Inter would produce empty boxes.
    """

    if not any(_DEVANAGARI_RE.search(ref.text) for ref in refs):
        return requested
    spec = font_spec(requested)
    if spec is None or "devanagari" not in spec.scripts:
        return "Mukta"
    return requested


def _clip_refs(
    words: list[Word],
    *,
    clip_start: float,
    clip_duration: float,
    text_case: CaptionTextCase | None = None,
) -> list[_WordRef]:
    """Keep the words inside a clip and convert them to renderer references."""

    clip_end = clip_start + clip_duration
    refs: list[_WordRef] = []
    for word in words:
        if word.end <= clip_start + 0.01 or word.start >= clip_end - 0.01:
            continue
        text = _clean_caption_text(word.text)
        if text_case is not None:
            text = _case_text(text, text_case)
        if not text:
            continue
        local_start = max(0.0, word.start - clip_start)
        local_end = min(clip_duration, word.end - clip_start)
        if local_end - local_start < 0.015:
            continue
        refs.append(_WordRef(text=text, start=local_start, end=local_end))
    return refs


def _secondary_line_prefix(
    group: _Group,
    secondary_refs: list[_WordRef],
    *,
    font_size: int,
    target_width: int,
    secondary_font: str,
    primary_font: str,
    primary_font_size: int,
) -> tuple[str, int]:
    """Wrap the Nepali line that belongs above this caption group.

    The secondary text is a plain, non-animated line in its own Devanagari
    font. The ASS reset tags after the line switch the event back to the
    primary font and size for the animated translation line.
    """

    selected = [
        ref
        for ref in secondary_refs
        if ref.end > group.start + 0.01 and ref.start < group.end - 0.01
    ]
    if not selected:
        return "", 0
    available_width = target_width * (1 - 2 * _SAFE_SIDE_FRACTION)
    lines: list[list[_WordRef]] = [[]]
    for ref in selected:
        projected = [*lines[-1], ref]
        if (
            lines[-1]
            and _line_width(projected, font_size) > available_width
            and len(lines) < _SECONDARY_MAX_LINES
        ):
            lines.append([ref])
        else:
            lines[-1].append(ref)
    populated = [line for line in lines if line]
    if not populated:
        return "", 0
    text = "\\N".join(" ".join(ref.text for ref in line) for line in populated)
    prefix = (
        f"{{\\fn{secondary_font}\\fs{font_size}}}{text}"
        f"\\N{{\\fn{primary_font}\\fs{primary_font_size}}}"
    )
    return prefix, len(populated)


def build_ass(
    words: list[Word],
    *,
    clip_start: float,
    clip_duration: float,
    settings: CaptionSettings,
    output_size: tuple[int, int],
    output_path: Path,
    secondary_words: list[Word] | None = None,
) -> CaptionRenderResult:
    """Render a subtitle file for a clip. Returns zero events when there is no speech."""

    base_colour = settings.color
    active_colour = settings.highlight_color
    width, height = output_size
    # Presets are authored against a 1080-wide canvas. Scale type metrics with
    # the output size so a 4K export keeps the same relative caption size.
    scale = max(0.1, min(width, height) / 1080)
    font_size = max(1, round(settings.font_size * scale))
    letter_spacing = settings.letter_spacing * scale
    word_spacing = settings.word_spacing * scale
    outline_width = settings.outline_width * scale
    shadow = settings.shadow * scale
    refs = _clip_refs(
        words,
        clip_start=clip_start,
        clip_duration=clip_duration,
        text_case=settings.text_case,
    )
    if not refs:
        return CaptionRenderResult(path="", event_count=0, word_count=0)
    secondary_refs = (
        _clip_refs(
            secondary_words,
            clip_start=clip_start,
            clip_duration=clip_duration,
        )
        if secondary_words and settings.secondary_enabled
        else []
    )

    groups = _make_groups(
        refs,
        font_size=font_size,
        target_width=width,
        letter_spacing=letter_spacing,
        word_spacing=word_spacing,
    )
    x, y, alignment = _position(settings.position, width, height)
    word_style = settings.word_style
    line_style = settings.line_style
    separator = _separator(word_spacing, letter_spacing)
    caption_font = _caption_font_for(refs, settings.font)
    secondary_font_size = max(1, round(font_size * _SECONDARY_SIZE_RATIO))
    secondary_font = (
        _caption_font_for(secondary_refs, settings.secondary_font) if secondary_refs else ""
    )
    bold = -1 if settings.font_style in (CaptionFontStyle.BOLD, CaptionFontStyle.BOLD_ITALIC) else 0
    italic = (
        -1 if settings.font_style in (CaptionFontStyle.ITALIC, CaptionFontStyle.BOLD_ITALIC) else 0
    )
    header = f"""[Script Info]
; Generated by CutClipper
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CutClipper,{caption_font},{font_size},{_ass_colour(settings.color)},&H000000FF,&H00000000,&H80000000,{bold},{italic},0,0,100,100,{letter_spacing:.1f},0,1,{outline_width:.1f},{shadow:.1f},{alignment},0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events: list[str] = []

    def add_event(
        start: float,
        end: float,
        text: str,
        *,
        tag: str,
        layer: int = 0,
    ) -> None:
        start = max(0.0, min(clip_duration, start))
        end = max(0.0, min(clip_duration, end))
        if end - start < 0.01 or not text:
            return
        escaped_text = text.replace("\n", "\\N")
        events.append(
            f"Dialogue: {layer},{_ass_time(start)},{_ass_time(end)},CutClipper,,0,0,0,,"
            f"{tag}{escaped_text}"
        )

    def style_text(
        target_group: _Group,
        active_word: int,
        *,
        reveal_before: float | None = None,
    ) -> str:
        return _styled_group_text(
            target_group,
            active_word,
            word_style=word_style,
            base_colour=base_colour,
            active_colour=active_colour,
            outline_width=outline_width,
            shadow=shadow,
            separator=separator,
            reveal_before=reveal_before,
        )

    for group_index, group in enumerate(groups):
        next_start = (
            groups[group_index + 1].start if group_index + 1 < len(groups) else clip_duration
        )
        hold_end = min(clip_duration, group.end + 0.16, max(group.end, next_start - 0.01))
        flat_words = [word for line in group.lines for word in line]
        secondary_prefix, secondary_lines = _secondary_line_prefix(
            group,
            secondary_refs,
            font_size=secondary_font_size,
            target_width=width,
            secondary_font=secondary_font,
            primary_font=caption_font,
            primary_font_size=font_size,
        )
        leading_height = secondary_lines * secondary_font_size * 1.2

        if line_style == CaptionStyle.TYPEWRITER:
            position_tag = f"{{\\an{alignment}\\pos({x},{y})\\q0}}"
            if word_style == CaptionStyle.BOX:
                for word_index, word in enumerate(flat_words):
                    rectangle = _box_rectangle(
                        group,
                        word_index,
                        font_size=font_size,
                        letter_spacing=letter_spacing,
                        word_spacing=word_spacing,
                        x=x,
                        y=y,
                        alignment=alignment,
                        colour=active_colour,
                        leading_height=leading_height,
                    )
                    if rectangle:
                        add_event(
                            word.start,
                            _event_end(flat_words, word_index, hold_end),
                            rectangle,
                            tag=position_tag,
                            layer=0,
                        )
            reveal_times: list[float] = []
            for word in flat_words:
                duration = max(0.001, word.end - word.start)
                for char_index in range(len(word.text)):
                    reveal_times.append(
                        word.start + duration * (char_index / max(1, len(word.text)))
                    )
            reveal_times.sort()
            deduped: list[float] = []
            for reveal in reveal_times:
                if not deduped or reveal - deduped[-1] >= 0.018:
                    deduped.append(reveal)
            for index, reveal in enumerate(deduped):
                end = deduped[index + 1] if index + 1 < len(deduped) else hold_end
                text = style_text(
                    group,
                    _active_word_index(flat_words, reveal),
                    reveal_before=reveal,
                )
                add_event(reveal, end, secondary_prefix + text, tag=position_tag)
        elif word_style is not None:
            for word_index, word in enumerate(flat_words):
                start = word.start
                end = _event_end(flat_words, word_index, hold_end)
                elapsed = max(0.0, start - group.start)
                if word_style == CaptionStyle.BOX:
                    rectangle = _box_rectangle(
                        group,
                        word_index,
                        font_size=font_size,
                        letter_spacing=letter_spacing,
                        word_spacing=word_spacing,
                        x=x,
                        y=y,
                        alignment=alignment,
                        colour=active_colour,
                        leading_height=leading_height,
                    )
                    if rectangle:
                        add_event(
                            start,
                            end,
                            rectangle,
                            tag=_word_event_entrance_tag(
                                line_style,
                                elapsed=elapsed,
                                x=x,
                                y=y,
                                alignment=alignment,
                                height=height,
                                drawing=True,
                            ),
                            layer=0,
                        )
                add_event(
                    start,
                    end,
                    secondary_prefix + style_text(group, word_index),
                    tag=_word_event_entrance_tag(
                        line_style,
                        elapsed=elapsed,
                        x=x,
                        y=y,
                        alignment=alignment,
                        height=height,
                    ),
                )
        else:
            text = style_text(group, -1)
            add_event(
                group.start,
                hold_end,
                secondary_prefix + text,
                tag=_group_entrance_tag(
                    line_style,
                    x=x,
                    y=y,
                    alignment=alignment,
                    height=height,
                ),
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(header + "\n".join(events) + "\n", encoding="utf-8")
    return CaptionRenderResult(
        path=str(output_path),
        event_count=len(events),
        word_count=len(refs),
    )


def build_caption_segments(
    words: list[Word],
    *,
    max_words: int = 10,
    max_seconds: float = 8.0,
) -> list[CaptionSegment]:
    """Group word timings into editable caption lines for the caption editor."""

    segments: list[CaptionSegment] = []
    current: list[Word] = []
    start = 0.0

    def flush() -> None:
        nonlocal current
        text = _join_caption_text([_clean_caption_text(word.text) for word in current])
        if current and text:
            segments.append(
                CaptionSegment(
                    start=round(start, 3),
                    end=round(max(start + 0.05, current[-1].end), 3),
                    text=text,
                )
            )
        current = []

    for word in words:
        text = _clean_caption_text(word.text)
        if not text:
            continue
        if current:
            gap = word.start - current[-1].end
            if (
                gap > 0.62
                or _SENTENCE_END_RE.search(current[-1].text)
                or word.end - start > max_seconds
                or len(current) >= max_words
            ):
                flush()
        if not current:
            start = word.start
        current.append(Word(start=word.start, end=word.end, text=text))
    flush()
    return segments


def words_from_segments(segments: list[CaptionSegment]) -> list[Word]:
    """Rebuild word timings for user-edited captions so ASS animation still works."""

    words: list[Word] = []
    for segment in segments:
        parts = [part for part in segment.text.split() if part]
        if not parts:
            continue
        span = max(0.02, segment.end - segment.start)
        weights = [max(1, len(part)) for part in parts]
        total_weight = sum(weights)
        cursor = segment.start
        for index, (part, weight) in enumerate(zip(parts, weights, strict=True)):
            end = segment.end if index == len(parts) - 1 else cursor + span * weight / total_weight
            words.append(
                Word(
                    start=round(cursor, 3),
                    end=round(max(cursor + 0.01, end), 3),
                    text=part,
                )
            )
            cursor = end
    return words


def safe_caption_y(position: CaptionPosition, height: int) -> int:
    _, y, _ = _position(position, 1080, height)
    return y
