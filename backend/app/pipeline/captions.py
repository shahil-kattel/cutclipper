"""Generate animated ASS captions with safe margins and word-level timing."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.pipeline.types import CaptionRenderResult, Word
from app.schemas import CaptionPosition, CaptionSettings, CaptionStyle

_SAFE_SIDE_FRACTION = 0.095
_MAX_LINES = 2
_MAX_GROUP_WORDS = 9
_MAX_GROUP_SECONDS = 6.4
_MIN_EVENT_SECONDS = 0.04


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


def _line_width(words: list[_WordRef], font_size: int) -> float:
    if not words:
        return 0.0
    return (
        sum(_estimated_width(word.text, font_size) for word in words)
        + len(words) * font_size * 0.26
    )


def _make_groups(
    words: list[_WordRef],
    *,
    font_size: int,
    target_width: int,
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
            sentence_ended = previous.text.rstrip()[-1:] in ".!?…。！？"
            too_long = word.end - group_start > _MAX_GROUP_SECONDS
            too_many = sum(len(line) for line in lines) >= _MAX_GROUP_WORDS
            if gap > 0.72 or sentence_ended or too_long or too_many:
                flush()
                group_start = word.start
        if lines == [[]]:
            group_start = word.start

        current_line = lines[-1]
        projected = [*current_line, word]
        if current_line and _line_width(projected, font_size) > available_width:
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


def _karaoke_text(
    group: _Group,
    active_word: int,
    *,
    base_colour: str,
    active_colour: str,
) -> str:
    parts: list[str] = []
    flat_index = 0
    for line_index, line in enumerate(group.lines):
        for word_index, word in enumerate(line):
            if flat_index == active_word:
                parts.append(
                    f"{{\\c{_ass_inline_colour(active_colour)}}}{word.text}{{\\c{_ass_inline_colour(base_colour)}}}"
                )
            else:
                parts.append(word.text)
            flat_index += 1
            if word_index + 1 < len(line):
                parts.append(" ")
        if line_index + 1 < len(group.lines):
            parts.append("\\N")
    return "".join(parts)


def _visible_word_text(
    group: _Group,
    active_word: int,
    *,
    base_colour: str,
    active_colour: str,
    pop: bool,
) -> str:
    parts: list[str] = []
    flat_index = 0
    for line_index, line in enumerate(group.lines):
        for word_index, word in enumerate(line):
            if flat_index < active_word:
                parts.append(word.text)
            elif flat_index == active_word:
                if pop:
                    parts.append(
                        "{\\alpha&H00&"
                        f"\\c{_ass_inline_colour(active_colour)}"
                        "\\fscx114\\fscy114"
                        "\\t(0,130,\\fscx100\\fscy100)}"
                        f"{word.text}"
                        "{\\c"
                        f"{_ass_inline_colour(base_colour)}"
                        "}"
                    )
                else:
                    parts.append(
                        f"{{\\c{_ass_inline_colour(active_colour)}}}{word.text}"
                        f"{{\\c{_ass_inline_colour(base_colour)}}}"
                    )
            else:
                parts.append(f"{{\\alpha&HFF&}}{word.text}{{\\alpha&H00&}}")
            flat_index += 1
            if word_index + 1 < len(line):
                parts.append(" ")
        if line_index + 1 < len(group.lines):
            parts.append("\\N")
    return "".join(parts)


def _typewriter_text(group: _Group, reveal_before: float) -> str:
    parts: list[str] = []
    for line_index, line in enumerate(group.lines):
        for word_index, word in enumerate(line):
            word_duration = max(0.001, word.end - word.start)
            for char_index, char in enumerate(word.text):
                reveal_at = word.start + word_duration * (char_index / max(1, len(word.text)))
                if reveal_at <= reveal_before + 0.0001:
                    parts.append(char)
                else:
                    parts.append(f"{{\\alpha&HFF&}}{char}{{\\alpha&H00&}}")
            if word_index + 1 < len(line):
                parts.append(" ")
        if line_index + 1 < len(group.lines):
            parts.append("\\N")
    return "".join(parts)


def _full_text(group: _Group) -> str:
    lines: list[str] = []
    for line in group.lines:
        lines.append(" ".join(word.text for word in line))
    return "\\N".join(lines)


def build_ass(
    words: list[Word],
    *,
    clip_start: float,
    clip_duration: float,
    settings: CaptionSettings,
    output_size: tuple[int, int],
    output_path: Path,
) -> CaptionRenderResult:
    """Render a subtitle file for a clip. Returns zero events when there is no speech."""

    base_colour = settings.color
    active_colour = settings.highlight_color
    width, height = output_size
    clip_end = clip_start + clip_duration
    refs: list[_WordRef] = []
    for word in words:
        if word.end <= clip_start + 0.01 or word.start >= clip_end - 0.01:
            continue
        text = _clean_caption_text(word.text)
        if not text:
            continue
        local_start = max(0.0, word.start - clip_start)
        local_end = min(clip_duration, word.end - clip_start)
        if local_end - local_start < 0.015:
            continue
        refs.append(_WordRef(text=text, start=local_start, end=local_end))
    if not refs:
        return CaptionRenderResult(path="", event_count=0, word_count=0)

    groups = _make_groups(refs, font_size=settings.font_size, target_width=width)
    x, y, alignment = _position(settings.position, width, height)
    position_tag = f"{{\\an{alignment}\\pos({x},{y})\\q0}}"
    fade_tag = "{\\fad(100,120)}" if settings.style == CaptionStyle.MINIMAL else ""
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
Style: CutClipper,{settings.font},{settings.font_size},{_ass_colour(settings.color)},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,{settings.outline_width:.1f},{settings.shadow:.1f},{alignment},0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events: list[str] = []

    def add_event(start: float, end: float, text: str) -> None:
        start = max(0.0, min(clip_duration, start))
        end = max(0.0, min(clip_duration, end))
        if end - start < 0.01 or not text:
            return
        escaped_text = text.replace("\n", "\\N")
        events.append(
            f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},CutClipper,,0,0,0,,"
            f"{position_tag}{fade_tag}{escaped_text}"
        )

    for group_index, group in enumerate(groups):
        next_start = (
            groups[group_index + 1].start if group_index + 1 < len(groups) else clip_duration
        )
        hold_end = min(clip_duration, group.end + 0.16, max(group.end, next_start - 0.01))
        flat_words = [word for line in group.lines for word in line]
        if settings.style in {CaptionStyle.KARAOKE, CaptionStyle.POP}:
            for word_index, word in enumerate(flat_words):
                start = word.start
                end = (
                    flat_words[word_index + 1].start
                    if word_index + 1 < len(flat_words)
                    else hold_end
                )
                text = (
                    _karaoke_text(
                        group,
                        word_index,
                        base_colour=base_colour,
                        active_colour=active_colour,
                    )
                    if settings.style == CaptionStyle.KARAOKE
                    else _visible_word_text(
                        group,
                        word_index,
                        base_colour=base_colour,
                        active_colour=active_colour,
                        pop=True,
                    )
                )
                add_event(start, end, text)
        elif settings.style == CaptionStyle.TYPEWRITER:
            char_events: list[tuple[float, float]] = []
            for word in flat_words:
                duration = max(0.001, word.end - word.start)
                for char_index in range(len(word.text)):
                    reveal = word.start + duration * (char_index / max(1, len(word.text)))
                    char_events.append((reveal, reveal))
            char_events.sort(key=lambda item: item[0])
            deduped: list[float] = []
            for reveal, _ in char_events:
                if not deduped or reveal - deduped[-1] >= 0.018:
                    deduped.append(reveal)
            for index, reveal in enumerate(deduped):
                end = deduped[index + 1] if index + 1 < len(deduped) else hold_end
                add_event(reveal, end, _typewriter_text(group, reveal))
        else:
            add_event(group.start, hold_end, _full_text(group))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(header + "\n".join(events) + "\n", encoding="utf-8")
    return CaptionRenderResult(
        path=str(output_path),
        event_count=len(events),
        word_count=len(refs),
    )


def safe_caption_y(position: CaptionPosition, height: int) -> int:
    _, y, _ = _position(position, 1080, height)
    return y
