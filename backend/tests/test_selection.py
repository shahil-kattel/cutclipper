from __future__ import annotations

import itertools
import random

import pytest

from app.core.errors import SelectionError
from app.pipeline.selection import (
    TranscriptionWindow,
    effective_clip_count,
    plan_transcription_windows,
    select_clips,
)
from app.pipeline.types import Sentence, Transcript, Word
from app.schemas import ClipSelectionMode, ClipSettings
from app.services.audio import EnergyProfile


def make_transcript(duration: float = 120.0, sentence_seconds: float = 6.0) -> Transcript:
    words: list[Word] = []
    sentences: list[Sentence] = []
    t = 0.3
    sentence_index = 0
    while t < duration - 1.0:
        sentence_words: list[Word] = []
        sentence_start = t
        sentence_end_target = min(duration, t + sentence_seconds)
        local_index = 0
        while t < sentence_end_target - 0.35:
            text = f"word{len(words)}"
            end = min(duration, t + 0.34)
            if local_index >= 7 or end >= sentence_end_target - 0.7:
                text += "."
            sentence_words.append(Word(t, end, text))
            words.append(sentence_words[-1])
            t = end + 0.18
            local_index += 1
            if text.endswith("."):
                t += 0.28
                break
        if not sentence_words:
            continue
        sentences.append(
            Sentence(
                start=sentence_start,
                end=sentence_words[-1].end,
                text=" ".join(word.text for word in sentence_words),
                word_indices=list(range(len(words) - len(sentence_words), len(words))),
            )
        )
        sentence_index += 1
        t += 0.45
    return Transcript(words=words, sentences=sentences, duration=duration)


def make_energy(duration: float, loud_regions: list[tuple[float, float]]) -> EnergyProfile:
    windows = int(duration / 0.25)
    rng = random.Random(3)
    values = [rng.uniform(0.01, 0.05) for _ in range(windows)]
    for start, end in loud_regions:
        for index in range(int(start / 0.25), int(end / 0.25)):
            if 0 <= index < windows:
                values[index] = rng.uniform(0.35, 0.9)
    return EnergyProfile(window_seconds=0.25, rms=values, duration=duration)


def assert_valid_plan(duration: float, settings: ClipSettings, clips: list) -> None:
    assert len(clips) == settings.clip_count
    ordered = sorted(clips, key=lambda clip: clip.start)
    for clip in ordered:
        assert clip.start >= 0
        assert clip.end <= duration + 0.01
        assert clip.end > clip.start
        assert settings.min_clip_seconds - 0.3 <= clip.duration <= settings.max_clip_seconds + 0.3
        assert 0 <= clip.score <= 100
    for first, second in itertools.pairwise(ordered):
        assert first.end <= second.start + 0.01


def test_auto_selects_exact_count_on_safe_boundaries() -> None:
    duration = 120.0
    transcript = make_transcript(duration)
    energy = make_energy(duration, [(40, 62), (85, 104)])
    settings = ClipSettings(
        clip_count=3,
        min_clip_seconds=10,
        max_clip_seconds=22,
        selection_mode=ClipSelectionMode.AUTO,
    )
    result = select_clips(
        duration=duration,
        settings=settings,
        transcript=transcript,
        scenes=[12.0, 40.0, 62.0, 85.0, 104.0],
        energy=energy,
    )
    assert_valid_plan(duration, settings, result.clips)
    for clip in result.clips:
        for word in transcript.words:
            assert not (word.start + 0.03 < clip.start < word.end - 0.03)
            assert not (word.start + 0.03 < clip.end < word.end - 0.03)


def test_auto_prefers_high_energy_highlight_for_single_clip() -> None:
    duration = 90.0
    transcript = make_transcript(duration)
    energy = make_energy(duration, [(55, 72)])
    settings = ClipSettings(
        clip_count=1,
        min_clip_seconds=10,
        max_clip_seconds=17,
        selection_mode=ClipSelectionMode.AUTO,
    )
    result = select_clips(
        duration=duration,
        settings=settings,
        transcript=transcript,
        scenes=[55.0],
        energy=energy,
    )
    clip = result.clips[0]
    overlap = max(0.0, min(clip.end, 72) - max(clip.start, 55))
    assert overlap >= 5.0
    assert clip.start >= 50


def test_even_split_snaps_near_targets() -> None:
    duration = 60.0
    transcript = make_transcript(duration)
    energy = make_energy(duration, [(0, 60)])
    settings = ClipSettings(
        clip_count=3,
        min_clip_seconds=15,
        max_clip_seconds=25,
        selection_mode=ClipSelectionMode.EVEN,
    )
    result = select_clips(
        duration=duration,
        settings=settings,
        transcript=transcript,
        scenes=[],
        energy=energy,
    )
    assert_valid_plan(duration, settings, result.clips)
    for clip in result.clips:
        assert 15 <= clip.duration <= 25
    assert result.clips[0].start == 0
    assert result.clips[-1].end == pytest.approx(duration, abs=0.01)


def test_video_too_short_raises_clear_error_in_even_mode() -> None:
    transcript = make_transcript(12.0)
    settings = ClipSettings(
        clip_count=3,
        min_clip_seconds=5,
        max_clip_seconds=10,
        selection_mode=ClipSelectionMode.EVEN,
    )
    with pytest.raises(SelectionError) as error:
        select_clips(
            duration=12.0,
            settings=settings,
            transcript=transcript,
            scenes=[],
            energy=None,
        )
    assert "Reduce the clip count" in error.value.message
    assert error.value.details["reason"] == "video_too_short"


def test_auto_reduces_clip_count_to_fit_duration() -> None:
    duration = 12.0
    transcript = make_transcript(duration)
    settings = ClipSettings(clip_count=3, min_clip_seconds=5, max_clip_seconds=10)
    result = select_clips(
        duration=duration,
        settings=settings,
        transcript=transcript,
        scenes=[],
        energy=None,
    )
    assert len(result.clips) == 2
    assert effective_clip_count(duration=duration, settings=settings) == 2
    assert any("fits at most 2 clips" in warning for warning in result.warnings)


def test_auto_delivers_every_requested_clip() -> None:
    duration = 240.0
    transcript = make_transcript(duration)
    energy = make_energy(duration, [(10, 235)])
    settings = ClipSettings(clip_count=12, min_clip_seconds=10, max_clip_seconds=25)
    assert effective_clip_count(duration=duration, settings=settings) == 12
    result = select_clips(
        duration=duration,
        settings=settings,
        transcript=transcript,
        scenes=[],
        energy=energy,
    )
    assert len(result.clips) == 12
    assert not any("at most" in warning for warning in result.warnings)


def test_auto_reduces_to_fit_instead_of_raising_early() -> None:
    duration = 52.0
    transcript = make_transcript(duration)
    settings = ClipSettings(clip_count=4, min_clip_seconds=15, max_clip_seconds=25)
    assert effective_clip_count(duration=duration, settings=settings) == 3
    result = select_clips(
        duration=duration,
        settings=settings,
        transcript=transcript,
        scenes=[],
        energy=None,
    )
    assert len(result.clips) == 3
    assert any("fits at most 3 clips" in warning for warning in result.warnings)


def test_partial_transcription_windows_avoid_the_whole_source() -> None:
    duration = 1200.0
    energy = make_energy(duration, [(120, 190), (540, 610), (960, 1030)])
    settings = ClipSettings(clip_count=3, min_clip_seconds=30, max_clip_seconds=60)
    windows = plan_transcription_windows(duration=duration, settings=settings, energy=energy)
    assert len(windows) == 3
    assert sum(window.duration for window in windows) < duration * 0.25
    assert windows[0].start < windows[1].start < windows[2].start


def test_auto_falls_back_to_a_valid_window_when_boundaries_are_sparse() -> None:
    transcript = Transcript(
        words=[Word(6.0, 8.2, "hello")],
        sentences=[Sentence(start=6.0, end=8.2, text="hello", word_indices=[0])],
        duration=8.35,
    )
    settings = ClipSettings(clip_count=1, min_clip_seconds=5, max_clip_seconds=8)
    result = select_clips(
        duration=8.35,
        settings=settings,
        transcript=transcript,
        scenes=[],
        energy=None,
    )
    assert len(result.clips) == 1
    assert 5 <= result.clips[0].duration <= 8


def test_auto_selection_stays_inside_transcription_windows() -> None:
    duration = 600.0
    transcript = make_transcript(duration)
    energy = make_energy(duration, [(30, 90), (300, 360)])
    windows = [
        TranscriptionWindow(28.0, 92.0),
        TranscriptionWindow(298.0, 362.0),
    ]
    settings = ClipSettings(clip_count=2, min_clip_seconds=10, max_clip_seconds=25)
    result = select_clips(
        duration=duration,
        settings=settings,
        transcript=transcript,
        scenes=[],
        energy=energy,
        allowed_windows=windows,
    )
    assert len(result.clips) == 2
    for clip in result.clips:
        assert any(
            clip.start >= window.start - 0.5 and clip.end <= window.end + 0.5 for window in windows
        )


def test_partial_windows_cover_even_slots() -> None:
    duration = 120.0
    settings = ClipSettings(
        clip_count=2,
        min_clip_seconds=20,
        max_clip_seconds=45,
        selection_mode=ClipSelectionMode.EVEN,
    )
    windows = plan_transcription_windows(duration=duration, settings=settings)
    assert len(windows) == 1  # merged, because two padded slots meet in the middle
    assert windows[0].start == 0
    assert windows[0].end == pytest.approx(duration)


def test_video_without_speech_still_returns_requested_count() -> None:
    duration = 42.0
    energy = make_energy(duration, [(2, 8), (18, 26), (34, 40)])
    settings = ClipSettings(
        clip_count=3,
        min_clip_seconds=5,
        max_clip_seconds=12,
    )
    result = select_clips(
        duration=duration,
        settings=settings,
        transcript=Transcript(duration=duration),
        scenes=[7.0, 14.0, 22.0, 28.0, 36.0],
        energy=energy,
    )
    assert_valid_plan(duration, settings, result.clips)
    assert any("No speech" in warning for warning in result.warnings)


def test_even_split_too_long_reports_actionable_error() -> None:
    transcript = make_transcript(200)
    settings = ClipSettings(
        clip_count=2,
        min_clip_seconds=20,
        max_clip_seconds=60,
        selection_mode=ClipSelectionMode.EVEN,
    )
    with pytest.raises(SelectionError, match="above the 60s maximum"):
        select_clips(
            duration=200,
            settings=settings,
            transcript=transcript,
            scenes=[],
            energy=None,
        )


def test_even_split_falls_back_to_word_edges_without_pauses() -> None:
    duration = 60.0
    words = [Word(start=0.1 + i, end=0.9 + i, text=f"word{i}.") for i in range(59)]
    transcript = Transcript(words=words, sentences=[], duration=duration)
    settings = ClipSettings(
        clip_count=3,
        min_clip_seconds=15,
        max_clip_seconds=25,
        selection_mode=ClipSelectionMode.EVEN,
    )
    result = select_clips(
        duration=duration,
        settings=settings,
        transcript=transcript,
        scenes=[],
        energy=None,
    )
    assert len(result.clips) == 3
    assert any("word-level cut points" in warning for warning in result.warnings)


def test_auto_accepts_touching_adjacent_windows() -> None:
    duration = 30.0
    words = [
        Word(0.0, 15.0, "one."),
        Word(15.0, 30.0, "two."),
    ]
    transcript = Transcript(
        words=words,
        sentences=[
            Sentence(0.0, 15.0, "one.", [0]),
            Sentence(15.0, 30.0, "two.", [1]),
        ],
        duration=duration,
    )
    settings = ClipSettings(
        clip_count=2,
        min_clip_seconds=15,
        max_clip_seconds=20,
        selection_mode=ClipSelectionMode.AUTO,
    )
    result = select_clips(
        duration=duration,
        settings=settings,
        transcript=transcript,
        scenes=[],
        energy=None,
    )
    assert len(result.clips) == 2
    assert result.clips[0].end == pytest.approx(result.clips[1].start, abs=0.001)
