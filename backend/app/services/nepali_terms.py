"""Shared Nepali spelling corrections and Devanagari → English glossary helpers.

The ASR often writes English loanwords in Devanagari (``विन्डोज``) and repeats a
small set of non-word spellings. Both the transcriber and the Roman caption
transliterator need the same mapping, so it lives here instead of inside the
Whisper service.
"""

from __future__ import annotations

import json
from pathlib import Path

# Conservative spelling fixes for tokens the Nepali ASR repeatedly mangles.
# Only non-words and standard spellings are listed; real Nepali words and
# names are never rewritten.
NEPALI_WORD_CORRECTIONS = {
    "सटिग": "सटीक",
    "सटिक": "सटीक",
    "सट्टिक": "सटीक",
    "संबोधन": "सम्बोधन",
    "संबोदन": "सम्बोधन",
    "सभादक्ष": "सभाध्यक्ष",
    "सभाधक्ष": "सभाध्यक्ष",
    "सवागत": "स्वागत",
    "सभागत": "स्वागत",
    "बिल्से": "बिर्से",
    "बिल्सेका": "बिर्सेका",
    "कालिक्रम": "कार्यक्रम",
    "कालिक्रमको": "कार्यक्रमको",
    "डाइभर्ट": "डाइभर्ड",
    "भेडियो": "भिडियो",
    "युटुब": "युट्युब",
    "युटुबमा": "युट्युबमा",
    "दोष्लो": "दोस्रो",
    "तव्य": "तपाईँ",
    "अतिति": "अतिथि",
    "विशेष्ट": "विशिष्ट",
    "श्वागत": "स्वागत",
}

_NEPALI_ENGLISH_TERMS_PATH = (
    Path(__file__).resolve().parents[2] / "assets" / "nepali-english-terms.json"
)


def _load_nepali_english_terms() -> dict[str, str]:
    """Common English words that Nepali speakers use inside Nepali speech.

    The Nepali fine-tune writes these phonetically in Devanagari (for example
    ``विन्डोज``). This map turns the known ones back into their Latin spelling
    so captions keep English words in English and Nepali words in Devanagari.
    """

    try:
        raw = json.loads(_NEPALI_ENGLISH_TERMS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        str(key): str(value)
        for key, value in raw.items()
        if str(key).strip() and str(value).strip()
    }


NEPALI_ENGLISH_TERMS = _load_nepali_english_terms()

NEPALI_CASE_SUFFIXES = tuple(
    sorted(
        {
            "हरूलाई",
            "हरुलाई",
            "हरूले",
            "हरुले",
            "हरूको",
            "हरुको",
            "हरूमा",
            "हरुमा",
            "हरूबाट",
            "हरुबाट",
            "हरूसँग",
            "हरुसँग",
            "हरूसंग",
            "हरुसंग",
            "हरूका",
            "हरुका",
            "हरूकी",
            "हरुकी",
            "हरूकै",
            "हरुकै",
            "हरू",
            "हरु",
            "देखि",
            "देखी",
            "भन्दा",
            "जस्तै",
            "जस्तो",
            "जस्ता",
            "जस्ती",
            "लाई",
            "बाट",
            "बाटै",
            "सँग",
            "संग",
            "सँगै",
            "संगै",
            "सम्म",
            "सम्मै",
            "तिर",
            "बिना",
            "विना",
            "बाहेक",
            "द्वारा",
            "को",
            "का",
            "की",
            "कै",
            "मा",
            "मै",
            "ले",
        },
        key=len,
        reverse=True,
    )
)


def english_term_for(word: str) -> str | None:
    """Return the English spelling of a known Nepali loanword, if any."""

    direct = NEPALI_ENGLISH_TERMS.get(word)
    if direct:
        return direct
    for suffix in NEPALI_CASE_SUFFIXES:
        if len(word) <= len(suffix) or not word.endswith(suffix):
            continue
        stem = word[: -len(suffix)]
        corrected_stem = NEPALI_WORD_CORRECTIONS.get(stem, stem)
        direct = NEPALI_ENGLISH_TERMS.get(corrected_stem)
        if direct:
            return direct + suffix
    return None


def correct_nepali_word(text: str) -> str:
    """Fix a known ASR token spelling, then restore a known English loanword."""

    # Decoder word tokens usually start with a space (" प्रोफेसनल"), while
    # caption segments are split on whitespace. Strip both before lookup.
    stripped = text.strip(" \t\r\n।॥,;:!?\"'()[]{}")
    if not stripped:
        return text
    corrected = NEPALI_WORD_CORRECTIONS.get(stripped, stripped)
    english = english_term_for(corrected)
    if english:
        return text.replace(stripped, english, 1)
    if corrected != stripped:
        return text.replace(stripped, corrected, 1)
    return text
