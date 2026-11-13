"""Small text-timing helpers shared by ASR and caption rendering.

Whisper word timestamps are exact when they are available. The Nepali
fine-tune does not always produce them, and user-edited caption lines have no
word timings at all, so both paths fall back to distributing a line's duration
across its words. A syllable-aware weight is much closer to real speech than
an equal split, especially for Devanagari and code-mixed lines.
"""

from __future__ import annotations

import unicodedata

_PAUSE_CHARS = set("।॥,;:!?…")
_SENTENCE_END_CHARS = set(".!?")


def text_timing_weight(text: str) -> float:
    """Estimate how much of a line's duration a token should occupy.

    Devanagari vowel signs and viramas are part of the same syllable, so they
    add less weight than a full consonant or vowel letter. Latin words use one
    unit per letter, which is a reasonable approximation for short captions.
    Punctuation gets a small pause so a comma does not land on the next word.
    """

    weight = 0.0
    for char in text.strip():
        if char.isspace():
            weight += 0.35
        elif char in _PAUSE_CHARS:
            weight += 1.4
        elif char in _SENTENCE_END_CHARS:
            weight += 1.0
        elif "ऀ" <= char <= "ॿ":
            category = unicodedata.category(char)
            if char == "्":  # virama joins the next consonant
                weight += 0.1
            elif category in {"Mn", "Mc"}:  # matras and other dependent signs
                weight += 0.35
            else:
                weight += 1.0
        elif char.isalnum():
            weight += 1.0
        else:
            weight += 0.4
    return max(1.0, weight)


def max_word_duration(text: str) -> float:
    """Cap a single word's duration so a bad final alignment cannot linger.

    A real word rarely takes longer than roughly a quarter second per timing
    unit. The floor protects short interjections; the ceiling keeps long
    compounds from being cut too aggressively.
    """

    return max(0.9, min(2.8, 0.24 * text_timing_weight(text)))


def clamp_word_end(
    text: str,
    start: float,
    end: float,
    next_start: float | None = None,
) -> float:
    """Return a sane end time for one word."""

    limit = start + max_word_duration(text)
    if next_start is not None:
        limit = min(limit, next_start)
    if end <= start:
        return start + 0.04
    return max(start + 0.04, min(end, limit))
