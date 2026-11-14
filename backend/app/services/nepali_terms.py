"""Shared Nepali spelling corrections and Devanagari → English glossary helpers.

The ASR often writes English loanwords in Devanagari (``विन्डोज``) and repeats a
small set of non-word spellings. Both the transcriber and the Roman caption
transliterator need the same mapping, so it lives here instead of inside the
Whisper service.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from pathlib import Path

# Conservative spelling fixes for tokens the Nepali ASR repeatedly mangles.
# Only non-words and standard spellings are listed; real Nepali words and
# names are never rewritten. Context-dependent fixes live in
# ``CONTEXT_WORD_CORRECTIONS`` below instead of this global map.
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
    # Real transcript errors from Nepali→English code-switched speech. These
    # spellings are not Nepali words, so they are safe to correct globally.
    "साँढै": "चाँडै",
    "सिद्धै": "सिधै",
    "छै": "छ",
    "चै": "चाहिँ",
    "चे": "चाहिँ",
    "लाइचे": "लाई",
    # "गरिहेरे" is not a Nepali word; the speaker says "मैले … download गरें".
    "गरिहेरे": "गरें",
}

# Two-word English terms are split by the ASR in several ways. A phrase
# correction keeps joined sentence text readable and a word merger (see
# ``merge_english_phrase``) keeps caption word timings intact.
_PHRASE_REPLACEMENTS = (
    (
        re.compile(
            r"प्रमुख\s+(?:त्यति|अत्यति)\s+विश[ेि]ष्ट\s+(?:अत्यति|अतिति)" r"(?:\s+(?:अत्यति|अतिति))?"
        ),
        "प्रमुख अतिथि, विशिष्ट अतिथि, अतिथि",
    ),
    (re.compile(r"स्वागतमन्तव्यको\s+मुख्य\s+भाषा"), "स्वागतमन्तव्यको मुख्य भाग"),
    (re.compile(r"मुख्य\s+भाषा\s+हो"), "मुख्य भाग हो"),
    # Context-dependent spelling fixes: "भनेछ" and "मेल्यो" are real words in
    # other contexts, so only rewrite the ASR's habitual phrase.
    (re.compile(r"(?<!\S)अहिलेको\s+लागि\s+भनेछ(?!\S)"), "अहिलेको लागि भने"),
    (re.compile(r"(?<!\S)गर्न\s+मेल्यो(?!\S)"), "गर्न मिल्यो"),
    # Whisper repeatedly hears "here" as "heard" after "finally".
    (re.compile(r"(?<!\S)is\s+finally\s+heard(?!\S)", re.IGNORECASE), "is finally here"),
    # The fine-tune drops the integer in "ChatGPT 3.5"; a second model on the
    # same audio returns "ChatGPT 3.5 model", and ".5" alone is never a valid
    # version label here.
    (re.compile(r"(?<!\S)ChatGPT\s*\.\s*५(?![\d०-९])"), "ChatGPT 3.5"),
)

_CHATGPT_SPLIT_RE = re.compile(
    r"(?:चार|च्याट|च्याड|chat)\s+"
    r"(?:GPT|जिपिटी|जीपीटी|जिपिटि|जीपीटी)"
    r"((?:को|ले|मा|का|की|कै|सँग|संग|बाट|बाटै)?)",
    re.IGNORECASE,
)
_OPENAI_SPLIT_RE = re.compile(
    r"(?:Open|ओपन)\s+AI((?:को|ले|मा|का|की|कै|सँग|संग|बाट|बाटै)?)",
    re.IGNORECASE,
)

# Phrase-level replacements applied after tokens are joined. Each entry works
# on whole words, so it cannot corrupt a longer word that merely contains the
# pattern.
NEPALI_PHRASE_CORRECTIONS = (
    *_PHRASE_REPLACEMENTS[:5],
    (
        re.compile(rf"(?<!\S){_CHATGPT_SPLIT_RE.pattern}(?!\S)", re.IGNORECASE),
        r"ChatGPT\1",
    ),
    (
        re.compile(rf"(?<!\S){_OPENAI_SPLIT_RE.pattern}(?!\S)", re.IGNORECASE),
        r"OpenAI\1",
    ),
    *_PHRASE_REPLACEMENTS[5:],
)

# Small context-sensitive fixes for words that are valid Nepali or English in
# another context. ``(previous words..., target, replacement)``.
CONTEXT_WORD_CORRECTIONS: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (("अहिलेको", "लागि"), "भनेछ", "भने"),
    (("गर्न",), "मेल्यो", "मिल्यो"),
    (("finally",), "heard", "here"),
    # The decoder drops the integer in "ChatGPT 3.5"; the decimal token keeps
    # its leading dot, so match the whole token rather than a bare digit.
    (("ChatGPT",), ".५", "3.5"),
)

_WORD_EDGE_PUNCTUATION = "।॥.,;:!?…\"'“”‘’()[]{}<>«»‹›/\\-–—"


def _strip_trailing_punctuation(text: str) -> tuple[str, str]:
    end = len(text)
    while end > 0 and text[end - 1] in _WORD_EDGE_PUNCTUATION:
        end -= 1
    return text[:end], text[end:]


def correct_nepali_phrases(text: str) -> str:
    """Apply phrase-level fixes that need more than one token of context."""

    for pattern, replacement in NEPALI_PHRASE_CORRECTIONS:
        text = pattern.sub(replacement, text)
    return text


def merge_english_phrase(first: str, second: str) -> str | None:
    """Return one canonical token when two adjacent words form a known name.

    The ASR splits ``ChatGPT`` and ``OpenAI`` inconsistently (``चार GPT``,
    ``chat GPT``, ``Open AI``). Merging them at word level lets the caption
    renderer, karaoke timing, and Roman transliterator see one word while
    keeping the first word's start and the second word's end.
    """

    if not first or not second:
        return None
    if first != first.strip(_WORD_EDGE_PUNCTUATION):
        return None
    second_core, second_trailing = _strip_trailing_punctuation(second)
    if not second_core:
        return None
    joined = f"{first} {second_core}"
    for pattern, replacement in (
        (_CHATGPT_SPLIT_RE, r"ChatGPT\1"),
        (_OPENAI_SPLIT_RE, r"OpenAI\1"),
    ):
        if pattern.fullmatch(joined):
            return pattern.sub(replacement, joined) + second_trailing
    return None


def correct_word_in_context(previous_words: Sequence[str], word: str) -> str | None:
    """Correct a word only when its preceding words match a known ASR error."""

    core, trailing = _strip_trailing_punctuation(word)
    if not core:
        return None
    for context, target, replacement in CONTEXT_WORD_CORRECTIONS:
        if core != target or len(previous_words) < len(context):
            continue
        previous = tuple(
            _strip_trailing_punctuation(item)[0]
            for item in previous_words[-len(context) :]
        )
        if previous == context:
            return replacement + trailing
    return None


def correct_words_in_context(words: Sequence[str]) -> list[str]:
    """Apply :func:`correct_word_in_context` across a sequence of words."""

    corrected = list(words)
    for index, word in enumerate(corrected):
        replacement = correct_word_in_context(corrected[max(0, index - 2) : index], word)
        if replacement is not None:
            corrected[index] = replacement
    return corrected

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
