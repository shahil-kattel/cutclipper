"""Regression corpus for Nepali speech that mixes in English words.

The cases below are the real ASR output from the Nepali videos exercised during
development (the 57-second ChatGPT upload plus 70-second, 91-second, and Honor
tech-review clips). They are kept as a fixture so the code-switch fixes cannot
silently regress:

* English words written in Devanagari are restored to Latin script.
* Split product names (``चार GPT``, ``chat GPT``, ``Open AI``) become one word
  without losing the original start/end timings.
* Context-dependent ASR errors are fixed only in the phrase that needs it.
* Roman Nepali keeps English words in English and uses conventional forms.
"""

from __future__ import annotations

import re
from types import SimpleNamespace

import pytest

from app.api.routes import _refresh_cached_transcript
from app.pipeline.captions import build_caption_segments
from app.schemas import TranscriptResponse, TranscriptWordOut
from app.services import transcriber
from app.services.romanize import romanize_nepali_text, romanize_token

# (raw ASR tokens, expected Devanagari/Latin caption, expected Roman caption)
REAL_TRANSCRIPT_CASES: tuple[tuple[tuple[str, ...], str, str], ...] = (
    (
        ("चार", "GPTको", "mobile", "app", "is", "finally", "heard।"),
        "ChatGPTको mobile app is finally here।",
        "ChatGPT ko mobile app is finally here.",
    ),
    (
        ("तपाईँले", "चार", "GPT", "लाइचे", "Open", "AIको", "websiteबाट", "मात्र", "नभई", "सोझै"),
        "तपाईँले ChatGPT लाई OpenAIको websiteबाट मात्र नभई सोझै",
        "Tapaile ChatGPT lai OpenAI ko website bata matra nabhai sojhai",
    ),
    (
        ("mobile", "appबाट", "पनि", "access", "गर्न", "सक्नुहुन्छ।"),
        "mobile appबाट पनि access गर्न सक्नुहुन्छ।",
        "Mobile app bata pani access garna saknu hunchha.",
    ),
    (
        ("अहिलेको", "लागि", "भनेछ", "it's", "only", "available", "for", "iPhones", "त्यो", "पनि"),
        "अहिलेको लागि भने it's only available for iPhones त्यो पनि",
        "Ahileko lagi bhane it's only available for iPhones tyo pani",
    ),
    (
        ("USAमा", "मात्रै", "तर", "तपाईँले", "आफ्नो", "Apple", "IDको", "region", "change", "गरेर"),
        "USAमा मात्रै तर तपाईँले आफ्नो Apple IDको region change गरेर",
        "USA ma matrai tar tapaile afno Apple ID ko region change garera",
    ),
    (
        ("यसलाई", "सजिलै", "download", "चै", "गर्न", "मेल्यो।"),
        "यसलाई सजिलै download चाहिँ गर्न मिल्यो।",
        "Yaslai sajilai download chahi garna milyo.",
    ),
    (
        ("अनि", "Open", "AIले", "भने", "अनुसार", "ChatGPTको", "app", "चे", "iOSबाहेक", "Android"),
        "अनि OpenAIले भने अनुसार ChatGPTको app चाहिँ iOSबाहेक Android",
        "Ani OpenAI le bhane anusar ChatGPT ko app chahi iOS bahek Android",
    ),
    (
        ("phonesमा", "पनि", "साँढै", "नै", "आउँदै", "छ।"),
        "phonesमा पनि चाँडै नै आउँदै छ।",
        "Phones ma pani chandai nai audai chha.",
    ),
    (
        ("मैले", "त्यो", "chat", "GPTको", "app", "download", "गरिहेरे", "र", "यसको", "UI"),
        "मैले त्यो ChatGPTको app download गरें र यसको UI",
        "Maile tyo ChatGPT ko app download garen ra yasko UI",
    ),
    (
        ("UXको", "बारेमा", "कुरा", "गर्नुपर्दा", "quite", "simple", "अनि", "easy", "to", "use।"),
        "UXको बारेमा कुरा गर्नुपर्दा quite simple अनि easy to use।",
        "UX ko barema kura garnu parda quite simple ani easy to use.",
    ),
    (
        ("defaultमा", "छै", "it", "runs", "अन", "chat", "GPT", ".५", "model", "तर"),
        "defaultमा छ it runs on ChatGPT 3.5 model तर",
        "Default ma chha it runs on ChatGPT 3.5 model tar",
    ),
    (
        ("तपाईँसँग", "चार", "GPT", "plus", "subscription", "छ", "भने", "तपाईँले", "GPT", "४"),
        "तपाईँसँग ChatGPT plus subscription छ भने तपाईँले GPT 4",
        "Tapai sanga ChatGPT plus subscription chha bhane tapaile GPT 4",
    ),
    (
        ("model", "पनि", "access", "गर्न", "सक्नुहुन्छ।"),
        "model पनि access गर्न सक्नुहुन्छ।",
        "Model pani access garna saknu hunchha.",
    ),
    (
        ("जसबाट", "you", "can", "get", "आफ्नो", "responses", "अनि", "यो", "appको", "overall"),
        "जसबाट you can get आफ्नो responses अनि यो appको overall",
        "Jasbata you can get afno responses ani yo app ko overall",
    ),
    (
        ("benefit", "भनेको", "छ", "यहाँ", "तपाईँले", "आफ्नो", "questions", "type", "गर्नुभन्दा", "सिद्धै"),
        "benefit भनेको छ यहाँ तपाईँले आफ्नो questions type गर्नुभन्दा सिधै",
        "Benefit bhaneko chha yaha tapaile afno questions type garnu bhanda sidhai",
    ),
    (
        ("बोलेर", "नै", "सोध्न", "सक्नुहुन्छ", "which", "is", "awesome"),
        "बोलेर नै सोध्न सक्नुहुन्छ which is awesome",
        "Bolera nai sodhna saknu hunchha which is awesome",
    ),
)


def _build_caption_line(tokens: tuple[str, ...]) -> tuple[str, list[transcriber.Word]]:
    """Return the caption text and the finalized word list for one ASR line."""
    duration = len(tokens) * 0.25
    segment = SimpleNamespace(
        start=0.0,
        end=duration,
        text=" ".join(tokens),
        words=[
            SimpleNamespace(start=index * 0.25, end=(index + 1) * 0.25, word=token, probability=1.0)
            for index, token in enumerate(tokens)
        ],
    )
    words = transcriber._build_words([segment], duration)
    captions = build_caption_segments(words, max_words=100, max_seconds=100)
    return " ".join(item.text for item in captions), words


@pytest.mark.parametrize(("tokens", "caption", "roman"), REAL_TRANSCRIPT_CASES)
def test_real_code_switched_lines_keep_english_and_nepali_readable(
    tokens: tuple[str, ...],
    caption: str,
    roman: str,
) -> None:
    text, words = _build_caption_line(tokens)
    assert text == caption
    # Phrase fixes must reach the word list too, otherwise the karaoke preview
    # and the burned video would disagree with the editor text.
    assert " ".join(word.text for word in words) == caption
    assert romanize_nepali_text(text) == roman


def test_the_whole_real_transcript_has_no_devanagari_left_in_roman_mode() -> None:
    lines = [_build_caption_line(tokens)[0] for tokens, _, _ in REAL_TRANSCRIPT_CASES]
    roman = romanize_nepali_text(" ".join(lines))
    assert not re.search(r"[ऀ-ॿ]", roman)
    for english in ("ChatGPT", "OpenAI", "iOS", "Android", "iPhones", "UI", "UX"):
        assert english in roman


def test_split_product_names_merge_without_losing_word_timing() -> None:
    _, words = _build_caption_line(("चार", "GPTको", "app", "खोल्नुहोस्"))
    assert [word.text for word in words] == ["ChatGPTको", "app", "खोल्नुहोस्"]
    assert words[0].start == 0.0
    assert words[0].end == 0.5
    assert words[1].start == 0.5


def test_a_cached_transcript_is_replayed_through_the_current_fixes() -> None:
    cached = TranscriptResponse(
        upload_id="0" * 32,
        duration=2.0,
        words=[
            TranscriptWordOut(start=0.0, end=0.4, text="चार"),
            TranscriptWordOut(start=0.4, end=0.8, text="GPTको"),
            TranscriptWordOut(start=0.8, end=1.2, text="छै"),
        ],
    )
    refreshed = _refresh_cached_transcript(cached)
    assert [(word.start, word.end, word.text) for word in refreshed.words] == [
        (0.0, 0.8, "ChatGPTको"),
        (0.8, 1.2, "छ"),
    ]
    assert refreshed.segments[0].text == "ChatGPTको छ"
    assert [word.start for word in refreshed.segments[0].words or []] == [0.0, 0.8]


def test_product_name_merge_respects_a_sentence_gap() -> None:
    segment = SimpleNamespace(
        start=0.0,
        end=2.0,
        text="चार GPT",
        words=[
            SimpleNamespace(start=0.0, end=0.4, word="चार", probability=1.0),
            SimpleNamespace(start=1.5, end=1.9, word="GPT", probability=1.0),
        ],
    )
    words = transcriber._build_words([segment], 2.0)
    assert [word.text for word in words] == ["चार", "GPT"]


def test_context_word_corrections_keep_valid_words_elsewhere() -> None:
    # Only the ASR's habitual phrase is rewritten; the words themselves are
    # valid Nepali in other contexts.
    text, words = _build_caption_line(("अहिलेको", "लागि", "भनेछ", "it's", "only"))
    assert text == "अहिलेको लागि भने it's only"
    assert [word.text for word in words] == ["अहिलेको", "लागि", "भने", "it's", "only"]

    text, words = _build_caption_line(("गर्न", "मेल्यो।"))
    assert text == "गर्न मिल्यो।"
    assert [word.text for word in words] == ["गर्न", "मिल्यो।"]

    assert romanize_token("मेल्यो") == "melyo"


def test_non_word_asr_spellings_are_normalised_before_captioning() -> None:
    assert transcriber._normalize_word("साँढै") == "चाँडै"
    assert transcriber._normalize_word("सिद्धै") == "सिधै"
    assert transcriber._normalize_word("छै") == "छ"
    assert transcriber._normalize_word("चै") == "चाहिँ"
    assert transcriber._normalize_word("चे") == "चाहिँ"
    assert transcriber._normalize_word("लाइचे") == "लाई"
    assert transcriber._normalize_word("गरिहेरे") == "गरें"
    # English "on" is a real code-switch, not a Nepali word.
    assert transcriber._normalize_word("अन") == "on"


def test_roman_gerunds_and_short_imperatives_keep_the_right_final_vowel() -> None:
    assert romanize_token("गरेर") == "garera"
    assert romanize_token("बोलेर") == "bolera"
    assert romanize_token("भनेर") == "bhanera"
    assert romanize_token("गएर") == "gaera"
    assert romanize_token("लिएर") == "liyera"
    assert romanize_token("दिएर") == "diyera"
    # Short imperatives must not grow a final -a.
    assert romanize_token("हेर") == "her"
    assert romanize_token("फेर") == "pher"
    assert romanize_token("तर") == "tar"


def test_roman_pronouns_and_particles_use_conventional_spellings() -> None:
    assert romanize_token("यसलाई") == "yaslai"
    assert romanize_token("त्यसलाई") == "tyaslai"
    assert romanize_token("चाहिँ") == "chahi"


def test_decimal_point_is_not_treated_as_a_sentence_end() -> None:
    assert romanize_nepali_text("GPT .५ model") == "GPT .5 model"
    assert romanize_nepali_text("मेरो v१.५ model") == "Mero v1.5 model"
    assert romanize_nepali_text("example.com बाट") == "Example.com bata"


def test_english_acronyms_and_currency_are_latin() -> None:
    assert transcriber._normalize_word("सीईओ") == "CEO"
    assert transcriber._normalize_word("यूएसए") == "USA"
    assert transcriber._normalize_word("डलरमा") == "dollarमा"
    assert transcriber._normalize_word("प्रतिशत") == "percent"
    assert transcriber._normalize_word("कल्चर") == "culture"
    assert transcriber._normalize_word("फेज") == "phase"
    assert romanize_token("सीईओ") == "CEO"
    assert romanize_token("डलर") == "dollar"


def test_english_version_numbers_use_ascii_digits() -> None:
    assert transcriber._normalize_word("GPT४") == "GPT4"
    assert transcriber._normalize_word("v१.५") == "v1.5"
    text, words = _build_caption_line(("GPT", "४", "model"))
    assert text == "GPT 4 model"
    assert [word.text for word in words] == ["GPT", "4", "model"]
    text, _ = _build_caption_line(("ChatGPT", ".५", "model"))
    assert text == "ChatGPT 3.5 model"


def test_common_nepali_similar_sounding_slips_are_normalised() -> None:
    for source, expected in (
        ("पनी", "पनि"),
        ("देखी", "देखि"),
        ("पछी", "पछि"),
        ("हुदै", "हुँदै"),
        ("गर्नू", "गर्नु"),
        ("गर्छन", "गर्छन्"),
        ("हुन्छन", "हुन्छन्"),
        ("घाह्रो", "गाह्रो"),
        ("पफ्ट्याह्रो", "अफ्ठ्यारो"),
        ("त्यहरू", "त्यहाँ"),
    ):
        assert transcriber._normalize_word(source) == expected


def test_roman_compound_verbs_split_into_readable_words() -> None:
    assert romanize_token("सक्नुहुन्छ।") == "saknu hunchha."
    assert romanize_token("गर्नुपर्छ") == "garnu parchha"
    assert romanize_token("गर्नुपर्दा") == "garnu parda"
    assert romanize_token("भन्नुभयो") == "bhannu bhayo"
    assert romanize_token("हुनुहुन्छ") == "hunu hunchha"
    assert romanize_token("दिनुहोस्") == "dinu hos"


@pytest.mark.parametrize(
    ("tokens", "caption"),
    [
        (("चेता", "भनिदिएसँगै"), "चेतावनी दिएसँगै"),
        (("जो", "खेम"), "जोखिम"),
        (("गम्भी", "र"), "गम्भीर"),
        (("सीमिततताका", "कारण"), "सीमितताका कारण"),
        (("आगामित", "रहिमासिकमा"), "आगामी त्रैमासिकमा"),
        (("सिएयो", "टेमकोकले"), "CEO Tim Cookले"),
        (("सियोगोकले", "बताएका"), "CEO Cookले बताएका"),
        (("२२", "प्रतिशत"), "22 percent"),
        (("डलरमा", "मात्र"), "dollarमा मात्र"),
        (("playersहरू", "थियो", "पाउन"), "playersहरू थिए पाउन"),
        (("कुरा", "बाको", "हो"), "कुरा बाँकी हो"),
        (("लास", "सिजनबाट", "आयो"), "last seasonबाट आयो"),
        (("लास",), "लास"),
    ],
)
def test_second_real_transcript_errors_are_normalised(
    tokens: tuple[str, ...],
    caption: str,
) -> None:
    text, _ = _build_caption_line(tokens)
    assert text == caption


@pytest.mark.parametrize(
    ("tokens", "caption"),
    [
        (("टेक", "पानामा", "आइपुगेको", "छ"), "TechPanaमा आइपुगेको छ"),
        (("अनर", "एक्स", "सेबेन", "बी"), "Honor X7b"),
        (("फस्ट", "लेयर", "अफ", "प्याकेजिङमा"), "first layer of packagingमा"),
        (("६०००", "एमेएचको", "battery", "plus"), "6000 mAhको battery plus"),
        (("3", "डेज", "battery", "लाइफ"), "3 days battery life"),
        (
            ("१०८", "मेगापिक्सलको", "अल्ट्राक्लियर", "camera"),
            "108 megapixelको ultra clear camera",
        ),
        (("सेन", "cameraको", "बारेमा"), "main cameraको बारेमा"),
        (("छ", "plus", "यहाँ", "६१६२९५६"), "छ plus यहाँ 6162956"),
        (
            ("यसको", "थर", "layer", "of", "प्याकेसिङमा", "छ"),
            "यसको third layer of packagingमा छ",
        ),
        (
            ("डुयल", "speaker", "200%", "भोलुम", "एन", "स्टेरियो", "साउन"),
            "dual speaker 200% volume and stereo sound",
        ),
        (("phoneको", "बक्सै", "पाउन"), "phoneको box पाउन"),
        (
            ("68", "inch", "Honor", "फूल", "व्यु", "डिस्प्लेसर"),
            "68 inch Honor full view display",
        ),
        (
            ("companyले", "दिएको", "अर्लिबर्ड", "अफरा"),
            "companyले दिएको early bird offer",
        ),
        (("onlineमा", "दराज", "र", "स्टोरसहित"), "onlineमा Daraz र storeसहित"),
        (("२३९९", "रूपैयाँ"), "2399 रूपैयाँ"),
        (("१०००", "छुटसहित"), "1000 छुटसहित"),
    ],
)
def test_third_real_transcript_english_words_are_latin(
    tokens: tuple[str, ...],
    caption: str,
) -> None:
    text, _ = _build_caption_line(tokens)
    assert text == caption
