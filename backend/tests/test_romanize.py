from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.api.routes import romanize_captions
from app.pipeline.captions import build_ass
from app.pipeline.types import Word
from app.schemas import (
    CaptionSegment,
    CaptionSettings,
    CaptionWord,
    NepaliScript,
    RomanizeSegmentsRequest,
)
from app.services.romanize import (
    romanize_nepali_text,
    romanize_segments,
    romanize_token,
    romanize_words,
)


@pytest.mark.parametrize(
    ("nepali", "roman"),
    [
        ("नमस्ते, मेरो नाम शाहिल हो।", "Namaste, mero naam Shahil ho."),
        ("तपाईंलाई कस्तो छ?", "Tapailai kasto chha?"),
        ("म ठीक छु, धन्यवाद।", "Ma thik chhu, dhanyabaad."),
        ("आज हामी काठमाडौंमा भेट्यौं।", "Aaja hami Kathmanduma bhetyaun."),
        (
            "उहाँले भन्नुभयो, “यो राम्रो छ।”",
            "Uhaanle bhannu bhayo, “Yo ramro chha.”",
        ),
        ("मैले काम गरें।", "Maile kaam garen."),
        ("उनीहरू घर गए।", "Uniharu ghar gaye."),
        ("हिजो पानी पर्यो।", "Hijo paani paryo."),
        ("भोलि बिहान बैठक हुनेछ।", "Bholi bihaan baithak hunechha."),
        ("मलाई नेपाली सिक्न मन लाग्छ।", "Malai Nepali sikna man lagchha."),
        (
            "उसले सोध्यो, “तिमी कहाँ जान्छौ?”",
            "Usle sodhyo, “Timi kahaan jaanchhau?”",
        ),
        (
            "यो भिडियो धेरै राम्रो छ; सबैले हेर्नुपर्छ।",
            "Yo video dherai ramro chha; sabaile hernu parchha.",
        ),
        ("कृपया माइक्रोफोन अलि नजिक राख्नुहोस्।", "Kripaya microphone ali najik rakhnu hos."),
        ("हामीले आजै काम सक्नुपर्छ।", "Hamile aajai kaam saknu parchha."),
        ("उहाँहरू त्यहाँ रहे।", "Uhaanharu tyahaan rahe."),
        (
            "यो ल्यापटपको ब्याट्री राम्रो छ, तर विन्डोज अपडेट ढिलो हुन्छ।",
            "Yo laptop ko battery ramro chha, tar Windows update dhilo hunchha.",
        ),
        ("मिटिङ साढे तीन बजे सुरु हुनेछ।", "Meeting saadhe teen baje suru hunechha."),
        ("उहाँले दशैंमा घर जानुभयो।", "Uhaanle Dashainma ghar janu bhayo."),
        (
            "यो काम सजिलो छैन, तर गर्न सकिन्छ।",
            "Yo kaam sajilo chhaina, tar garna sakinchha.",
        ),
        (
            "मलाई थाहा छैन, उहाँ आउनुहुन्छ कि हुँदैन।",
            "Malai thaahaa chhaina, uhaan aunu hunchha ki hudaina.",
        ),
    ],
)
def test_documented_nepali_phrases_become_accurate_roman_nepali(nepali: str, roman: str) -> None:
    assert romanize_nepali_text(nepali) == roman


def test_english_and_latin_brand_names_are_never_transliterated() -> None:
    assert romanize_nepali_text("This is English.") == "This is English."
    assert romanize_nepali_text("iPhone 15 Pro") == "iPhone 15 Pro"
    assert romanize_nepali_text("यो video धेरै राम्रो छ") == "Yo video dherai ramro chha"
    assert romanize_nepali_text("मेरो नाम Shahil हो") == "Mero naam Shahil ho"


def test_mixed_english_tokens_keep_the_latin_stem_and_romanize_the_suffix() -> None:
    assert romanize_token("YouTubeमा") == "YouTube ma"
    assert romanize_token("videoको") == "video ko"
    assert romanize_token("भिडियोको") == "video ko"
    assert romanize_token("युट्युबमा") == "YouTube ma"
    assert romanize_token("विन्डोजमा") == "Windows ma"
    assert romanize_token("कम्पनीहरूले") == "company harule"
    assert romanize_token("कम्पनीहरूसंग") == "company harusanga"
    assert romanize_token("हार्डिक्स") == "hard disk"


def test_va_is_b_standalone_and_w_inside_a_cluster() -> None:
    assert romanize_token("विकास") == "bikas"
    assert romanize_token("व्यक्ति") == "byakti"
    assert romanize_token("स्वागत") == "swaagat"
    assert romanize_token("द्वारा") == "dwara"
    assert romanize_token("विश्व") == "bishwa"
    assert romanize_token("केवल") == "kebal"


def test_real_interview_words_use_conventional_roman_forms() -> None:
    assert romanize_token("वहाँले") == "wahaanle"
    assert romanize_token("जसरी") == "jasari"
    assert romanize_token("एउटा") == "euta"
    assert romanize_token("दाइले") == "daile"
    assert romanize_token("पाउन") == "paun"
    assert romanize_token("घाँसमा") == "ghansama"
    assert romanize_token("ठाउँठाउँमा") == "thauthaumma"
    assert romanize_token("भन्नुहुँदा") == "bhannuhunda"
    assert romanize_token("गाह्रो") == "gahro"
    assert romanize_token("अफ्ठ्यारो") == "afthyaaro"


def test_common_school_and_health_loans_stay_english() -> None:
    assert romanize_token("डाक्टर") == "doctor"
    assert romanize_token("स्कुल") == "school"
    assert romanize_token("पुलिसले") == "police le"
    assert romanize_token("नर्स") == "nurse"


def test_danda_digits_and_punctuation_are_preserved_as_latin_marks() -> None:
    assert romanize_nepali_text("नमस्ते।") == "Namaste."
    assert romanize_nepali_text("कस्तो छ?") == "Kasto chha?"
    assert romanize_nepali_text("मेरो नम्बर ९८४१२३४५६७ हो।") == ("Mero number 9841234567 ho.")
    assert romanize_nepali_text("नमस्ते।धन्यवाद") == "Namaste.Dhanyabaad"
    assert romanize_nepali_text("नमस्ते । धन्यवाद ।") == "Namaste. Dhanyabaad."
    assert romanize_nepali_text("यो राम्रो छ ।") == "Yo ramro chha."
    assert romanize_nepali_text("नमस्ते , धन्यवाद") == "Namaste, dhanyabaad"


def test_shared_hindi_nepali_forms_use_their_nepali_roman_forms() -> None:
    assert romanize_token("गए") == "gaye"
    assert romanize_token("गई") == "gai"
    assert romanize_token("रहे") == "rahe"
    assert romanize_token("रही") == "rahi"
    assert romanize_token("दिए") == "diye"
    assert romanize_token("लिए") == "liye"


def test_romanizing_roman_text_is_a_no_op() -> None:
    roman = "Namaste, mero naam Shahil ho."
    assert romanize_nepali_text(roman) == roman


def test_words_keep_their_exact_timings_and_token_order() -> None:
    words = [
        Word(0.0, 0.4, "नमस्ते,"),
        Word(0.4, 0.8, "मेरो"),
        Word(0.8, 1.2, "नाम"),
    ]
    roman = romanize_words(words)
    assert [word.text for word in roman] == ["Namaste,", "mero", "naam"]
    assert [(word.start, word.end) for word in roman] == [
        (0.0, 0.4),
        (0.4, 0.8),
        (0.8, 1.2),
    ]


def test_segments_keep_english_lines_and_transform_word_text() -> None:
    segments = [
        CaptionSegment(
            start=0.0,
            end=1.0,
            text="नमस्ते, मेरो नाम शाहिल हो।",
            words=[
                CaptionWord(start=0.0, end=0.25, text="नमस्ते,"),
                CaptionWord(start=0.25, end=0.5, text="मेरो"),
            ],
            language="ne",
        ),
        CaptionSegment(start=1.0, end=2.0, text="This is English.", language="en"),
    ]
    roman = romanize_segments(segments)
    assert roman[0].text == "Namaste, mero naam Shahil ho."
    assert [word.text for word in roman[0].words or []] == ["Namaste,", "mero"]
    assert roman[1].text == "This is English."
    assert roman[1].language == "en"


def test_build_ass_burns_roman_primary_and_secondary_lines(tmp_path: Path) -> None:
    output = tmp_path / "roman.ass"
    words = [Word(0.2, 0.9, "नमस्ते,"), Word(0.9, 1.6, "मेरो")]
    secondary = [Word(0.2, 0.9, "उहाँले"), Word(0.9, 1.6, "भन्नुभयो,")]
    result = build_ass(
        words,
        clip_start=0.0,
        clip_duration=2.0,
        settings=CaptionSettings(
            enabled=True,
            font="Inter",
            nepali_script=NepaliScript.ROMAN,
            secondary_enabled=True,
            secondary_font="Mukta",
        ),
        output_size=(1080, 1920),
        output_path=output,
        secondary_words=secondary,
    )
    text = output.read_text(encoding="utf-8")
    assert result.event_count > 0
    assert "Namaste," in text
    assert "Uhaanle" in text
    assert not re.search(r"[ऀ-ॿ]", text)
    # Roman Nepali uses the main Latin face for both tracks.
    assert "{\\fnInter" in text


def test_roman_setting_does_not_change_english_only_captions(tmp_path: Path) -> None:
    output = tmp_path / "english.ass"
    words = [Word(0.2, 0.8, "Hello"), Word(0.8, 1.4, "world!")]
    result = build_ass(
        words,
        clip_start=0.0,
        clip_duration=2.0,
        settings=CaptionSettings(enabled=True, nepali_script=NepaliScript.ROMAN),
        output_size=(1080, 1920),
        output_path=output,
    )
    text = output.read_text(encoding="utf-8")
    assert result.word_count == 2
    assert "Hello" in text
    assert "world!" in text


def test_caption_settings_accept_the_roman_script_value() -> None:
    settings = CaptionSettings.model_validate({"nepali_script": "roman"})
    assert settings.nepali_script == NepaliScript.ROMAN


def test_romanize_route_returns_editable_segments() -> None:
    request = RomanizeSegmentsRequest(
        segments=[
            CaptionSegment(
                start=0.0,
                end=1.0,
                text="नमस्ते।",
                words=[CaptionWord(start=0.0, end=1.0, text="नमस्ते।")],
                language="ne",
            )
        ]
    )
    response = romanize_captions(request)
    assert response.segments[0].text == "Namaste."
    assert response.segments[0].words is not None
    assert response.segments[0].words[0].text == "Namaste."
