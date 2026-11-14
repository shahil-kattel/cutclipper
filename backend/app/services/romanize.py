"""Devanagari → Roman Nepali transliteration for captions.

The scheme is practical Roman Nepali without diacritics: ``आ`` → ``aa``,
``छ`` → ``chha``, ``ज्ञ`` → ``gya``. A curated lexicon covers the words whose
conventional Roman spelling differs from a letter-by-letter reading (Nepal,
Kathmandu, thik, garna, hudaina), and a rule-based fallback handles names and
uncommon words. English words and technical terms stay in Latin script,
including mixed tokens such as ``YouTubeमा`` → ``YouTubema``.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.pipeline.types import Word
from app.schemas import CaptionSegment
from app.services.nepali_terms import (
    correct_nepali_phrases,
    correct_nepali_word,
    correct_words_in_context,
    english_term_for,
)

_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")
# Word runs exclude danda and Devanagari digits so punctuation and numbers are
# handled separately; ZWNJ/ZWJ are also left out so they cannot leak into Latin.
_DEVANAGARI_WORD_RE = re.compile(r"[ऀ-ॣ॰-ॿ]+")
# A danda can arrive as its own token; keep the Latin full stop attached.
# Pull punctuation onto the preceding word, but keep the space before a
# leading decimal such as "GPT .5" (the token starts with the dot).
_ROMAN_PUNCT_SPACE_RE = re.compile(r"\s+([,;:!?%)\]।॥])|\s+(\.)(?!\d)")
_LEXICON_PATH = Path(__file__).resolve().parents[2] / "assets" / "nepali-roman-lexicon.json"

_VIRAMA = "्"
_NUKTA = "़"
_ANUSVARA = "ं"
_CHANDRABINDU = "ँ"
_VISARGA = "ः"
_ZERO_WIDTH = {"‌", "‍"}

_INDEPENDENT_VOWELS = {
    "अ": "a",
    "आ": "aa",
    "इ": "i",
    "ई": "ee",
    "उ": "u",
    "ऊ": "oo",
    "ऋ": "ri",
    "ॠ": "ri",
    "ऌ": "li",
    "ॡ": "li",
    "ए": "e",
    "ऐ": "ai",
    "ओ": "o",
    "औ": "au",
}

_VOWEL_SIGNS = {
    "ा": "aa",
    "ि": "i",
    "ी": "ee",
    "ु": "u",
    "ू": "oo",
    "ृ": "ri",
    "ॄ": "ri",
    "ॢ": "li",
    "ॣ": "li",
    "े": "e",
    "ै": "ai",
    "ो": "o",
    "ौ": "au",
    "ॅ": "e",
    "ॉ": "o",
    "ॆ": "e",
    "ॊ": "o",
}

_CONSONANTS = {
    "क": "k",
    "ख": "kh",
    "ग": "g",
    "घ": "gh",
    "ङ": "ng",
    "च": "ch",
    "छ": "chh",
    "ज": "j",
    "झ": "jh",
    "ञ": "ny",
    "ट": "t",
    "ठ": "th",
    "ड": "d",
    "ढ": "dh",
    "ण": "n",
    "त": "t",
    "थ": "th",
    "द": "d",
    "ध": "dh",
    "न": "n",
    "प": "p",
    "फ": "ph",
    "ब": "b",
    "भ": "bh",
    "म": "m",
    "य": "y",
    "र": "r",
    "ल": "l",
    "व": "b",
    "श": "sh",
    "ष": "sh",
    "स": "s",
    "ह": "h",
    "ळ": "l",
    "ऱ": "r",
    "ऴ": "l",
}

# Consonants written with nukta in loanwords. Nepali ASR sometimes puts a nukta
# on ड/ढ where the word is plain ड/ढ (पढ़्नु for पढ्नु), so those stay d/dh.
_NUKTA_CONSONANTS = {
    "क": "q",
    "ख": "kh",
    "ग": "gh",
    "ज": "z",
    "ड": "d",
    "ढ": "dh",
    "फ": "f",
    "य": "y",
}

_LABIAL_CONSONANTS = frozenset({"प", "फ", "ब", "भ", "म"})

_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

# Punctuation that may wrap a caption token. Stripping it before the lexicon
# lookup lets ``नमस्ते,`` resolve to ``Namaste`` + comma.
_EDGE_PUNCTUATION = "।॥.,;:!?…\"'“”‘’()[]{}<>«»‹›「」『』【】（）［］｛｝/\\-–—_+=*&%$#@^~`|"
_OPENING_QUOTES = frozenset({"“", '"', "'", "‘"})
# A danda always ends a sentence, even when the next word has no space after
# it (``नमस्ते।धन्यवाद``). Keep a private sentinel until casing has run so an
# ordinary full stop inside a domain or decimal is not treated the same way.
_DANDA_SENTINEL = ""
_SENTENCE_END = frozenset({".", "?", "!", "।", "॥", _DANDA_SENTINEL})
_DANDA_LIKE = frozenset({"।", "॥", _DANDA_SENTINEL})
_CLAUSE_BREAK = frozenset({",", ";", ":", "(", "[", "{", "—", "–"})


@dataclass(frozen=True, slots=True)
class _Lexicon:
    words: dict[str, str]
    suffixes: dict[str, str]
    suffix_order: tuple[str, ...]


@lru_cache(maxsize=1)
def _lexicon() -> _Lexicon:
    try:
        raw = json.loads(_LEXICON_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _Lexicon(words={}, suffixes={}, suffix_order=())
    if not isinstance(raw, dict):
        return _Lexicon(words={}, suffixes={}, suffix_order=())
    words = {
        str(key): str(value)
        for key, value in (raw.get("words") or {}).items()
        if str(key).strip() and str(value).strip()
    }
    suffixes = {
        str(key): str(value)
        for key, value in (raw.get("suffixes") or {}).items()
        if str(key).strip() and str(value).strip()
    }
    suffix_order = tuple(sorted(suffixes, key=len, reverse=True))
    return _Lexicon(words=words, suffixes=suffixes, suffix_order=suffix_order)


def _has_devanagari(text: str) -> bool:
    return bool(_DEVANAGARI_RE.search(text))


def _split_edge_punctuation(token: str) -> tuple[str, str, str]:
    start = 0
    end = len(token)
    while start < end and token[start] in _EDGE_PUNCTUATION:
        start += 1
    while end > start and token[end - 1] in _EDGE_PUNCTUATION:
        end -= 1
    return token[:start], token[start:end], token[end:]


def _normalise_punctuation(text: str) -> str:
    return text.replace("।", _DANDA_SENTINEL).replace("॥", _DANDA_SENTINEL)


def _restore_punctuation(text: str) -> str:
    return text.replace(_DANDA_SENTINEL, ".")


def _lookup_roman(text: str, *, allow_english: bool = True, depth: int = 0) -> str | None:
    """Find a curated Roman spelling, optionally crossing the English glossary."""

    # ASR sometimes adds a nukta to ड/ढ even where the word is plain ड/ढ
    # (पढ़्नु for पढ्नु). Ignore those two nukta spellings for lexicon lookup;
    # the transliterator still handles genuine loanword letters like ज़/फ़.
    lookup = text.replace("ड़", "ड").replace("ढ़", "ढ")

    if allow_english and depth < 4:
        term = english_term_for(lookup)
        if term:
            if _has_devanagari(term):
                return _romanize_mixed_script(term, depth=depth + 1)
            return term

    lexicon = _lexicon()
    direct = lexicon.words.get(lookup)
    if direct:
        return direct
    direct = lexicon.suffixes.get(lookup)
    if direct:
        return direct

    # Longest suffix wins so काठमाडौंमा resolves as Kathmandu + मा, not as an
    # unknown word ending in ा.
    if len(lookup) > 2:
        for suffix in lexicon.suffix_order:
            if len(lookup) <= len(suffix) + 1 or not lookup.endswith(suffix):
                continue
            stem = lookup[: -len(suffix)]
            roman_stem = lexicon.words.get(stem)
            if roman_stem:
                return roman_stem + lexicon.suffixes[suffix]
    return None


def _romanize_dev_run(text: str, *, depth: int = 0) -> str:
    if not text:
        return ""
    # Re-apply the transcriber's conservative spelling fixes so the endpoint
    # and renderer behave the same on uncorrected or freshly edited text.
    corrected = correct_nepali_word(text)
    if corrected != text:
        text = corrected
    # A correction can turn a Devanagari word into an English stem plus a
    # Devanagari suffix (युट्युबमा → YouTubeमा). Re-split so the suffix uses
    # the lexicon (ma) instead of the long-vowel fallback (maa).
    if depth < 4 and _has_devanagari(text) and not all(_DEVANAGARI_RE.match(char) for char in text):
        return _romanize_mixed_script(text, depth=depth + 1)
    looked_up = _lookup_roman(text, depth=depth)
    if looked_up is not None:
        return looked_up
    return _transliterate(text)


def _romanize_non_word(text: str) -> str:
    """Keep Latin text, turn dandas into stops, and map Devanagari digits."""

    return (
        text.translate(_DIGITS)
        .replace("।", _DANDA_SENTINEL)
        .replace("॥", _DANDA_SENTINEL)
        .replace("‌", "")
        .replace("‍", "")
    )


def _romanize_mixed_script(text: str, *, depth: int = 0) -> str:
    parts: list[str] = []
    cursor = 0
    for match in _DEVANAGARI_WORD_RE.finditer(text):
        if match.start() > cursor:
            parts.append(_romanize_non_word(text[cursor : match.start()]))
        parts.append(_romanize_dev_run(match.group(), depth=depth))
        cursor = match.end()
    if cursor < len(text):
        parts.append(_romanize_non_word(text[cursor:]))
    return "".join(parts)


def _next_is_labial(text: str, index: int) -> bool:
    while index < len(text) and text[index] in _ZERO_WIDTH:
        index += 1
    return index < len(text) and text[index] in _LABIAL_CONSONANTS


def _keeps_final_schwa(
    text: str,
    last_consonant: str,
    *,
    after_virama: bool,
    consonant_count: int,
) -> bool:
    """Decide whether a word-final inherent अ belongs in the Roman spelling.

    ``गरेर`` and ``बोलेर`` need the final ``a`` (garera, bolera), while the
    shorter imperative ``हेर`` (her) and ``फेर`` (pher) do not. Dependent
    gerunds all end in र after े/ै/ए, so that shape is the useful signal.
    """

    if after_virama or last_consonant == "छ" or consonant_count <= 1:
        return True
    if last_consonant != "र":
        return False
    index = len(text) - 1
    while index >= 0 and (text[index] in _ZERO_WIDTH or text[index] == _NUKTA):
        index -= 1
    if index <= 0:
        return False
    previous = text[index - 1]
    if previous in "ेै" and len(text) >= 4:
        return True
    return previous in "एऐ" and len(text) >= 3


def _transliterate(text: str) -> str:
    """Letter-by-letter Roman Nepali for words the lexicon does not cover."""

    # ज्ञ is read /gy/ in Nepali; rewriting it as ग्य lets the normal
    # consonant/vowel rules produce gya, gyaan, gyani and so on.
    text = text.replace("ज्ञ", "ग्य")
    output: list[str] = []
    index = 0
    length = len(text)
    consonant_count = 0
    last_consonant = ""
    last_consonant_after_virama = False
    virama_since_consonant = False
    pending_inherent_a = False

    def append(value: str) -> None:
        nonlocal pending_inherent_a
        if not value:
            return
        output.append(value)
        pending_inherent_a = False

    while index < length:
        char = text[index]

        if char == "ॐ":
            append("om")
            index += 1
            continue

        if char in _INDEPENDENT_VOWELS:
            append(_INDEPENDENT_VOWELS[char])
            index += 1
            continue

        if char in _CONSONANTS:
            last_consonant = char
            after_virama = virama_since_consonant
            last_consonant_after_virama = after_virama
            virama_since_consonant = False
            consonant_count += 1
            roman = _CONSONANTS[char]
            # Nepali व is /b/ on its own (विकास → bikaas) but /w/ inside a
            # cluster (स्वागत → swaagat, द्वारा → dwara, विश्व → bishwa).
            if char == "व" and after_virama:
                roman = "w"
            index += 1
            if index < length and text[index] == _NUKTA:
                roman = _NUKTA_CONSONANTS.get(char, roman)
                index += 1
            append(roman)
            while index < length and text[index] in _ZERO_WIDTH:
                index += 1
            if index < length and text[index] == _VIRAMA:
                virama_since_consonant = True
                index += 1
                while index < length and text[index] in _ZERO_WIDTH:
                    index += 1
                continue
            if index < length and text[index] in _VOWEL_SIGNS:
                append(_VOWEL_SIGNS[text[index]])
                index += 1
                continue
            if index < length and text[index] in (_ANUSVARA, _CHANDRABINDU):
                nasal = "m" if _next_is_labial(text, index + 1) else "n"
                append("a" + nasal)
                index += 1
                continue
            if index < length and text[index] == _VISARGA:
                append("ah")
                index += 1
                continue
            append("a")
            pending_inherent_a = True
            continue

        if char in _VOWEL_SIGNS:
            append(_VOWEL_SIGNS[char])
            virama_since_consonant = False
            index += 1
            continue

        if char in (_ANUSVARA, _CHANDRABINDU):
            append("m" if _next_is_labial(text, index + 1) else "n")
            virama_since_consonant = False
            index += 1
            continue

        if char == _VISARGA:
            append("h")
            virama_since_consonant = False
            index += 1
            continue

        if char == _VIRAMA:
            virama_since_consonant = True
            pending_inherent_a = False
            index += 1
            continue

        if char in _ZERO_WIDTH:
            index += 1
            continue

        if char in "।॥":
            append(_DANDA_SENTINEL)
            virama_since_consonant = False
            index += 1
            continue

        if char in "०१२३४५६७८९":
            append(char.translate(_DIGITS))
            virama_since_consonant = False
            index += 1
            continue

        if char == "ऽ":
            append("'")
            virama_since_consonant = False
            index += 1
            continue

        if _DEVANAGARI_RE.match(char):
            # Unhandled Vedic accent or symbol: keep it out of the Latin line.
            index += 1
            continue

        append(char)
        virama_since_consonant = False
        index += 1

    if (
        pending_inherent_a
        and output
        and output[-1] == "a"
        and not _keeps_final_schwa(
            text,
            last_consonant,
            after_virama=last_consonant_after_virama,
            consonant_count=consonant_count,
        )
    ):
        output.pop()

    roman = "".join(output)
    return roman or text


def _romanize_core(core: str) -> str:
    if not core or not _has_devanagari(core):
        return core
    # The mixed-script pass also handles pure Devanagari: it looks up each
    # word run separately, so ``नमस्ते।धन्यवाद`` cannot bypass the lexicon just
    # because the two sentences share a token.
    return _romanize_mixed_script(core)


def _romanize_token_raw(token: str) -> str:
    """Romanize one token while keeping dandas as an internal sentinel."""

    if not token or not _has_devanagari(token):
        return token
    leading, core, trailing = _split_edge_punctuation(token)
    leading = _normalise_punctuation(leading)
    trailing = _normalise_punctuation(trailing)
    if not core:
        return _normalise_punctuation(token)
    return leading + _romanize_core(core) + trailing


def romanize_token(token: str) -> str:
    """Romanize one whitespace-delimited caption token, keeping punctuation."""

    return _restore_punctuation(_romanize_token_raw(token))


def _apply_case_to_sequence(tokens: list[str]) -> list[str]:
    """Sentence-case a sequence of tokens without destroying brand casing.

    Mixed-case Latin words such as iPhone, iOS and macOS must survive; only an
    all-lowercase token is sentence-cased. Capitalisation also happens inside a
    token after an opening quote (``, "yo`` → ``, "Yo``).
    """

    capitalise_next = True
    previous = ""
    result: list[str] = []
    for token in tokens:
        preserve_case = any(char.isupper() for char in token)
        chars: list[str] = []
        for index, char in enumerate(token):
            if char.isalpha() and capitalise_next:
                if not preserve_case:
                    char = char.upper()
                capitalise_next = False
                preserve_case = False
            elif char.isalpha():
                # The first letter has been seen; later sentence starts inside
                # the same token can be capitalised normally.
                preserve_case = False
            chars.append(char)
            # A full stop only ends a sentence when no letter or digit follows
            # it in the same token. Otherwise ".५" would reset the sentence and
            # capitalise the next word ("GPT .5 Model").
            if char in _DANDA_LIKE:
                ends_sentence = True
            else:
                ends_sentence = char in _SENTENCE_END and not any(
                    later.isalnum() for later in token[index + 1 :]
                )
            if ends_sentence or (
                char in _OPENING_QUOTES
                and (previous == "" or previous in _CLAUSE_BREAK or previous in _SENTENCE_END)
            ):
                capitalise_next = True
            if not char.isspace():
                previous = char
        result.append("".join(chars))
    return result


def romanize_nepali_text(text: str) -> str:
    """Romanize a caption line, preserving English words and Latin punctuation."""

    if not text:
        return text
    text = correct_nepali_phrases(text)
    if not _has_devanagari(text):
        return text
    tokens = [_romanize_token_raw(token) for token in text.split()]
    cased = _apply_case_to_sequence(tokens)
    return _restore_punctuation(_ROMAN_PUNCT_SPACE_RE.sub(r"\1\2", " ".join(cased)))


def _romanize_texts_with_shared_case(texts: list[str]) -> list[str]:
    """Romanize several caption lines with one casing pass across all of them.

    The renderer cases the whole ASR word list, not each caption segment, so a
    line that starts mid-sentence stays lowercase in both the preview and the
    burned video.
    """

    tokenized: list[str] = []
    counts: list[int] = []
    for text in texts:
        tokens = correct_nepali_phrases(text).split()
        counts.append(len(tokens))
        tokenized.extend(_romanize_token_raw(token) for token in tokens)
    cased = _apply_case_to_sequence(tokenized)
    result: list[str] = []
    cursor = 0
    for count in counts:
        result.append(
            _restore_punctuation(
                _ROMAN_PUNCT_SPACE_RE.sub(r"\1\2", " ".join(cased[cursor : cursor + count]))
            )
        )
        cursor += count
    return result


def romanize_segments(segments: list[CaptionSegment]) -> list[CaptionSegment]:
    """Return caption segments with Nepali text transliterated to Roman Nepali.

    Word timings and token order are preserved. A line with no Devanagari is
    left exactly as it was, so English-only subtitles are never altered.
    """

    if not segments:
        return []
    if not any(
        _has_devanagari(segment.text)
        or any(_has_devanagari(word.text) for word in segment.words or [])
        for segment in segments
    ):
        return list(segments)

    segment_texts = _romanize_texts_with_shared_case([segment.text for segment in segments])
    flat_words = [
        (segment_index, word)
        for segment_index, segment in enumerate(segments)
        for word in (segment.words or [])
    ]
    flat_source = correct_words_in_context([word.text for _, word in flat_words])
    flat_texts = [
        _restore_punctuation(text)
        for text in _apply_case_to_sequence([_romanize_token_raw(source) for source in flat_source])
    ]
    words_by_segment: dict[int, list[str]] = {}
    for (segment_index, _), word_text in zip(flat_words, flat_texts, strict=True):
        words_by_segment.setdefault(segment_index, []).append(word_text)

    romanized: list[CaptionSegment] = []
    for index, segment in enumerate(segments):
        has_devanagari = _has_devanagari(segment.text)
        text = segment_texts[index] if has_devanagari else segment.text
        words = segment.words
        if words and (has_devanagari or any(_has_devanagari(word.text) for word in words)):
            word_texts = words_by_segment.get(index)
            if word_texts and len(word_texts) == len(words):
                words = [
                    word.model_copy(update={"text": word_text})
                    for word, word_text in zip(words, word_texts, strict=True)
                ]
        romanized.append(segment.model_copy(update={"text": text, "words": words}))
    return romanized


def romanize_words(words: list[Word]) -> list[Word]:
    """Return pipeline words with Nepali text transliterated to Roman Nepali."""

    if not words or not any(_has_devanagari(word.text) for word in words):
        return list(words)
    source_texts = correct_words_in_context([word.text for word in words])
    texts = [
        _restore_punctuation(text)
        for text in _apply_case_to_sequence(
            [_romanize_token_raw(source) for source in source_texts]
        )
    ]
    return [
        Word(start=word.start, end=word.end, text=text, probability=word.probability)
        for word, text in zip(words, texts, strict=True)
    ]
