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
    # Common similar-sounding spelling slips from the fine-tune. These are
    # non-words (or non-standard forms), not valid alternative spellings.
    "पनी": "पनि",
    "देखी": "देखि",
    "पछी": "पछि",
    "अघी": "अघि",
    "लाइ": "लाई",
    "हुदै": "हुँदै",
    "गर्नू": "गर्नु",
    "सक्नू": "सक्नु",
    "भन्नू": "भन्नु",
    "दिनू": "दिनु",
    "लिनू": "लिनु",
    "जानू": "जानु",
    "आउनू": "आउनु",
    "हुनू": "हुनु",
    "छन": "छन्",
    "भन्छन": "भन्छन्",
    "गर्छन": "गर्छन्",
    "हुन्छन": "हुन्छन्",
    "दिन्छन": "दिन्छन्",
    "पर्छन": "पर्छन्",
    "आउँछन": "आउँछन्",
    "गर्नेछन": "गर्नेछन्",
    "सक्छन": "सक्छन्",
    "छैन्": "छैन",
    "सीमिततता": "सीमितता",
    "चेतावनै": "चेतावनी",
    "हुनेही": "हुने",
    "हत्याधुनिक": "अत्याधुनिक",
    "आगामित": "आगामी",
    "रहिमासिक": "त्रैमासिक",
    # ब/व and श/स/ष confusions. These spellings are non-standard or
    # non-words in the contexts the ASR produces them.
    "बिश्व": "विश्व",
    "बिश्वास": "विश्वास",
    "बिज्ञान": "विज्ञान",
    "बिद्यालय": "विद्यालय",
    "ब्यक्ति": "व्यक्ति",
    "बातावरण": "वातावरण",
    "बिकल्प": "विकल्प",
    "बिवाह": "विवाह",
    "बिषय": "विषय",
    "बिशेष": "विशेष",
    "ब्यवस्था": "व्यवस्था",
    "ब्यापार": "व्यापार",
    "बिरोध": "विरोध",
    "बिचार": "विचार",
    "बिभाग": "विभाग",
    "बिस्तार": "विस्तार",
    "बिधि": "विधि",
    "बिकास": "विकास",
    "सिक्षा": "शिक्षा",
    "शुरु": "सुरु",
    "शहर": "सहर",
    "सान्ति": "शान्ति",
    "भिडीयो": "भिडियो",
    "गुरू": "गुरु",
    "सैटिङ": "सेटिङ",
    "किटाब": "किताब",
    "गल्टी": "गल्ती",
    "आफनो": "आफ्नो",
    "परीवार": "परिवार",
    "मत्र": "मात्र",
    "हैन": "होइन",
    "स्थियो": "थियो",
    "हामले": "हामीले",
    "भन्नुहुन्दा": "भन्नुहुँदा",
    "पहिलेदेखिन": "पहिलेदेखि",
    "बिस्तारै": "विस्तारै",
    "असोशिएसन": "असोसिएसन",
    "असोस्ट्रेसन": "असोसिएसन",
    "जुनसिके": "जुनसुकै",
    "त्यहिवेर": "त्यही भएर",
    "तपाउँ": "तपाईं",
    "हुनुहुन": "हुनुहुन्छ",
    "घाह्रो": "गाह्रो",
    "पफ्ट्याह्रो": "अफ्ठ्यारो",
    "त्यहरू": "त्यहाँ",
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
    # The fine-tune sometimes splits a single Nepali word into two tokens.
    (re.compile(r"(?<!\S)गम्भी\s+र(?!\S)"), "गम्भीर"),
    (re.compile(r"(?<!\S)जो\s+खेम(?!\S)"), "जोखिम"),
    (re.compile(r"(?<!\S)चेता\s+भनिदिएसँगै(?!\S)"), "चेतावनी दिएसँगै"),
    (re.compile(r"(?<!\S)माग\s+पुरा(?!\S)"), "माग पूरा"),
    (re.compile(r"(?<!\S)वि\s+एर\s+गेटिङ(?!\S)", re.IGNORECASE), "we are getting"),
    (re.compile(r"(?<!\S)हेर्ने\s+पर\s+सुविधा(?!\S)"), "हेर्ने पनि सुविधा"),
    (re.compile(r"(?<!\S)कुरा\s+बाको(?!\S)"), "कुरा बाँकी"),
    # The tech channel name and product model are spoken as separate words
    # by the Nepali fine-tune; keep the Latin spelling intact.
    (re.compile(r"(?<!\S)टेक\s+पानामा(?!\S)"), "TechPanaमा"),
    (re.compile(r"(?<!\S)Honor\s+X\s+seven\s+बी(?!\S)"), "Honor X7b"),
    (re.compile(r"(?<!\S)सेन\s+(camera\S*)"), r"main \1"),
    # Honor review: English spec phrases that the fine-tune split across
    # Devanagari and Latin tokens.
    (re.compile(r"(?<!\S)थर\s+layer(?!\S)"), "third layer"),
    (re.compile(r"(?<!\S)volume\s+एन\s+stereo\s+साउन(?!\S)"), "volume and stereo sound"),
    (re.compile(r"(?<!\S)फूल\s+view(?!\S)"), "full view"),
    # Interview clip: an English sentence split into Nepali phonetic tokens.
    (
        re.compile(
            r"(?<!\S)सो\s+वि\s+हाफ\s+to\s+बिफेर\s+to\s+association(?!\S)",
            re.IGNORECASE,
        ),
        "so we have to be fair to association",
    ),
    # Honor review: "16 plus 256GB memory" was merged into one digit token
    # and "GB को" became "चिविको".
    (
        re.compile(r"(?<!\S)यहाँ\s+6162956\s+चिविको\s+memory(?!\S)"),
        "यहाँ 16 plus 256GB memory",
    ),
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
    (("कुरा",), "बाको", "बाँकी"),
    (("अहिलेको", "लागि"), "भनेछ", "भने"),
    (("गर्न",), "मेल्यो", "मिल्यो"),
    (("finally",), "heard", "here"),
    # The decoder drops the integer in "ChatGPT 3.5"; the decimal token keeps
    # its leading dot, so match the whole token rather than a bare digit.
    (("ChatGPT",), ".५", "3.5"),
    (("ChatGPT",), ".5", "3.5"),
)

_WORD_EDGE_PUNCTUATION = "।॥.,;:!?…\"'“”‘’()[]{}<>«»‹›/\\-–—"
_CORRECTION_SUFFIXES = tuple(
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
            "हरूका",
            "हरुका",
            "हरूकी",
            "हरुकी",
            "हरू",
            "हरु",
            "लाई",
            "बाट",
            "सँग",
            "संग",
            "सम्म",
            "देखि",
            "देखी",
            "भन्दा",
            "जस्तै",
            "जस्तो",
            "तिर",
            "बिना",
            "विना",
            "बाहेक",
            "सहित",
            "द्वारा",
            "को",
            "का",
            "की",
            "मा",
            "ले",
            "मै",
            "कै",
        },
        key=len,
        reverse=True,
    )
)
_DEVANAGARI_DIGIT_CHARS = frozenset("०१२३४५६७८९")
_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def _has_ascii_letter(text: str) -> bool:
    return any(char.isascii() and char.isalpha() for char in text)


def _as_ascii_digits(text: str) -> str:
    return text.translate(_DEVANAGARI_DIGITS)


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


def correct_word_in_context(
    previous_words: Sequence[str],
    word: str,
    next_word: str | None = None,
) -> str | None:
    """Correct a word only when its surrounding words match a known pattern."""

    core, trailing = _strip_trailing_punctuation(word)
    if not core:
        return None
    for context, target, replacement in CONTEXT_WORD_CORRECTIONS:
        if core != target or len(previous_words) < len(context):
            continue
        previous = tuple(
            _strip_trailing_punctuation(item)[0] for item in previous_words[-len(context) :]
        )
        if previous == context:
            return replacement + trailing

    # A plural subject takes the plural past copula: "playersहरू थियो" is a
    # common ASR slip for "playersहरू थिए".
    if core == "थियो" and previous_words:
        previous = _strip_trailing_punctuation(previous_words[-1])[0]
        if previous.endswith(("हरू", "हरु")):
            return "थिए" + trailing

    # "लास" normally means a corpse; only the sports phrase "last season"
    # turns it into the English word "last".
    if (
        core == "लास"
        and next_word
        and _strip_trailing_punctuation(next_word)[0].startswith("season")
    ):
        return "last" + trailing

    # English product/version numbers are spoken inside Nepali, but the
    # fine-tune often writes them in Devanagari digits (GPT ४, iPhone १५).
    # Convert only when the surrounding word is Latin, or the token itself
    # mixes Latin letters with Devanagari digits.
    if any(char in _DEVANAGARI_DIGIT_CHARS for char in core):
        # Long runs are phone numbers, IMEIs, and serials rather than prose
        # numerals, so they read better in ASCII in every context.
        if len(core) >= 5 and all(char in _DEVANAGARI_DIGIT_CHARS for char in core):
            return _as_ascii_digits(core) + trailing
        if next_word:
            following = _strip_trailing_punctuation(next_word)[0]
            if following.startswith(("रूपैयाँ", "रुपैयाँ", "रूपैया", "रुपैया", "छुट")):
                return _as_ascii_digits(core) + trailing
        if _has_ascii_letter(core):
            return _as_ascii_digits(core) + trailing
        if previous_words:
            previous = _strip_trailing_punctuation(previous_words[-1])[0]
            if _has_ascii_letter(previous):
                return _as_ascii_digits(core) + trailing
        if next_word and _has_ascii_letter(next_word):
            return _as_ascii_digits(core) + trailing
    return None


def correct_words_in_context(words: Sequence[str]) -> list[str]:
    """Apply :func:`correct_word_in_context` across a sequence of words."""

    corrected = list(words)
    for index, word in enumerate(corrected):
        next_word = corrected[index + 1] if index + 1 < len(corrected) else None
        replacement = correct_word_in_context(
            corrected[max(0, index - 2) : index],
            word,
            next_word,
        )
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
            "सहित",
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


def _corrected_token(token: str) -> str | None:
    """Return a correction for the token or a corrected case-suffixed stem."""

    direct = NEPALI_WORD_CORRECTIONS.get(token)
    if direct is not None:
        return direct
    for suffix in _CORRECTION_SUFFIXES:
        if len(token) <= len(suffix) + 1 or not token.endswith(suffix):
            continue
        stem = token[: -len(suffix)]
        correction = NEPALI_WORD_CORRECTIONS.get(stem)
        if correction is not None:
            return correction + suffix
    return None


def correct_nepali_word(text: str) -> str:
    """Fix a known ASR token spelling, then restore a known English loanword."""

    # Decoder word tokens usually start with a space (" प्रोफेसनल"), while
    # caption segments are split on whitespace. Strip both before lookup.
    stripped = text.strip(" \t\r\n।॥,;:!?\"'()[]{}")
    if not stripped:
        return text
    corrected = _corrected_token(stripped) or stripped
    english = english_term_for(corrected)
    if english:
        return text.replace(stripped, english, 1)
    # Captions use English numerals everywhere, including Nepali sentences:
    # prices, dates, model numbers, and IMEIs should read in ASCII.
    if any(char in _DEVANAGARI_DIGIT_CHARS for char in corrected):
        return text.replace(stripped, _as_ascii_digits(corrected), 1)
    if corrected != stripped:
        return text.replace(stripped, corrected, 1)
    return text
