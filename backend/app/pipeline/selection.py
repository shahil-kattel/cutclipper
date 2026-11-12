"""Sentence-safe highlight selection and exact-count clip planning."""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from collections import deque
from dataclasses import dataclass, field

import numpy as np

from app.core.errors import SelectionError
from app.pipeline.types import ClipPlan, CutBoundary, Sentence, Transcript, Word
from app.schemas import ClipSelectionMode, ClipSettings
from app.services.audio import EnergyProfile

MIN_CUT_GAP = 0.06
_EPSILON = 0.015
AUTO_MAX_CLIPS = 6
# When the planned windows cover this much of the source, full transcription is
# cheaper than slicing and keeps the highlight scorer on the whole transcript.
_FULL_TRANSCRIPTION_COVERAGE = 0.72


@dataclass(slots=True)
class TranscriptionWindow:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


def effective_clip_count(*, duration: float, settings: ClipSettings) -> int:
    """How many clips the current mode will actually produce.

    Auto mode is capped at six clips and automatically reduced when the source
    is too short for the requested count. Even mode keeps the user's explicit
    count (selection will explain if it cannot fit).
    """

    requested = max(1, int(settings.clip_count))
    min_length = max(0.001, float(settings.min_clip_seconds))
    max_by_duration = max(0, int(duration // min_length))
    if settings.selection_mode == ClipSelectionMode.AUTO:
        requested = min(requested, AUTO_MAX_CLIPS)
    if max_by_duration < 1:
        return requested
    return max(1, min(requested, max_by_duration))


@dataclass(slots=True)
class SelectionResult:
    clips: list[ClipPlan]
    warnings: list[str] = field(default_factory=list)
    boundaries: list[CutBoundary] = field(default_factory=list)


@dataclass(slots=True)
class _Candidate:
    start: float
    end: float
    score: float
    origin: str


def select_clips(
    *,
    duration: float,
    settings: ClipSettings,
    transcript: Transcript,
    scenes: list[float],
    energy: EnergyProfile | None,
    allowed_windows: list[TranscriptionWindow] | None = None,
) -> SelectionResult:
    """Choose exactly N non-overlapping clips without splitting sentences."""

    requested = settings.clip_count
    min_length = float(settings.min_clip_seconds)
    max_length = float(settings.max_clip_seconds)
    if duration <= 0:
        raise SelectionError("The video has no usable duration.")
    if requested < 1 or requested > 20:
        raise SelectionError("Choose between 1 and 20 clips.")

    auto_warnings: list[str] = []
    if settings.selection_mode == ClipSelectionMode.AUTO:
        count = effective_clip_count(duration=duration, settings=settings)
        if count < requested:
            capped = min(requested, AUTO_MAX_CLIPS)
            if requested > AUTO_MAX_CLIPS:
                auto_warnings.append("Auto-highlights makes at most 6 clips per video.")
            max_by_duration = max(0, int(duration // max(min_length, 0.001)))
            if 0 < max_by_duration < capped:
                auto_warnings.append(
                    f"This video fits at most {max_by_duration} clips of at least "
                    f"{min_length:.0f}s, so auto mode will make {count}."
                )
    else:
        count = requested

    required = count * min_length
    if required > duration + 0.2:
        max_possible = max(0, math.floor(duration / max(min_length, 0.001)))
        if max_possible < 1:
            message = (
                f"This video is {duration:.1f}s long, shorter than the "
                f"{min_length:.0f}s minimum clip length."
            )
        else:
            message = (
                f"This video is {duration:.0f}s long. {count} clips of at least "
                f"{min_length:.0f}s need {required:.0f}s. Reduce the clip count to "
                f"{max_possible} or lower the minimum clip length."
            )
        raise SelectionError(
            message, details={"reason": "video_too_short", "max_clips": max_possible}
        )

    if settings.selection_mode == ClipSelectionMode.EVEN and duration / count > max_length + 0.2:
        raise SelectionError(
            f"An even split of this {duration:.0f}s video into {count} clips gives "
            f"{duration / count:.0f}s per clip, above the {max_length:.0f}s maximum. "
            "Increase the maximum length, choose fewer clips, or use Auto-highlights.",
            details={"reason": "even_split_too_long"},
        )

    boundaries = build_boundaries(
        duration=duration,
        transcript=transcript,
        scenes=scenes,
        energy=energy,
        min_clip=min_length,
    )
    if allowed_windows and settings.selection_mode == ClipSelectionMode.AUTO:
        # Window edges are valid fallback cuts when only part of the source was
        # transcribed; otherwise an energy-rich window can have no cut points.
        extra = [
            CutBoundary(round(boundary, 3), "window", 0.6)
            for window in allowed_windows
            for boundary in (window.start, window.end)
            if 0.05 < boundary < duration - 0.05
        ]
        boundaries = _merge_boundaries([*boundaries, *extra], duration)
    if len(boundaries) < 2:
        raise SelectionError("No safe cut points could be found in this video.")

    relaxed_warning: str | None = None
    if settings.selection_mode == ClipSelectionMode.EVEN:
        try:
            clips = _even_plan(
                duration=duration,
                count=count,
                min_length=min_length,
                max_length=max_length,
                boundaries=boundaries,
            )
        except SelectionError as strict_error:
            # Music-heavy videos can have long stretches without a clean pause.
            # Retry on fine-grained word/scene edges rather than failing outright.
            relaxed = build_boundaries(
                duration=duration,
                transcript=transcript,
                scenes=scenes,
                energy=energy,
                min_clip=min_length,
                relaxed=True,
            )
            try:
                clips = _even_plan(
                    duration=duration,
                    count=count,
                    min_length=min_length,
                    max_length=max_length,
                    boundaries=relaxed,
                )
                boundaries = relaxed
                relaxed_warning = (
                    "Even split used word-level cut points because no full sentence pause "
                    "fit every clip boundary. Some clips may begin mid-sentence."
                )
            except SelectionError:
                raise strict_error from None
        clips = _apply_scores(
            clips,
            words=transcript.words,
            scenes=scenes,
            energy=energy,
        )
    else:
        try:
            clips = _auto_plan(
                duration=duration,
                count=count,
                min_length=min_length,
                max_length=max_length,
                boundaries=boundaries,
                transcript=transcript,
                scenes=scenes,
                energy=energy,
                allowed_windows=allowed_windows,
            )
        except SelectionError:
            if not allowed_windows:
                raise
            # The partial-transcription windows could not supply enough valid
            # cuts. Prefer a complete clip set over failing the whole job.
            auto_warnings.append(
                "Some highlights fell outside the transcribed sections; captions may be "
                "missing on those clips."
            )
            clips = _auto_plan(
                duration=duration,
                count=count,
                min_length=min_length,
                max_length=max_length,
                boundaries=boundaries,
                transcript=transcript,
                scenes=scenes,
                energy=energy,
            )

    if len(clips) != count:
        raise SelectionError(
            "CutClipper could not find enough non-overlapping highlights with those settings."
        )
    for clip in clips:
        if clip.duration < min_length - 0.25 or clip.duration > max_length + 0.25:
            raise SelectionError(
                "A planned clip fell outside the requested length range. Widen the "
                "minimum and maximum lengths and try again."
            )
    clips.sort(key=lambda clip: clip.start)
    warnings: list[str] = list(auto_warnings)
    if relaxed_warning:
        warnings.append(relaxed_warning)
    if not transcript.has_speech:
        warnings.append(
            "No speech was detected. Captions are unavailable; highlights use scene changes "
            "and audio energy."
        )
    return SelectionResult(clips=clips, warnings=warnings, boundaries=boundaries)


def _centered_window(center: float, length: float, duration: float) -> TranscriptionWindow:
    length = min(duration, max(0.1, length))
    start = max(0.0, min(duration - length, center - length / 2))
    return TranscriptionWindow(start=round(start, 3), end=round(start + length, 3))


def _merge_windows(
    windows: list[TranscriptionWindow], *, gap: float = 0.5
) -> list[TranscriptionWindow]:
    ordered = sorted(windows, key=lambda window: window.start)
    merged: list[TranscriptionWindow] = []
    for window in ordered:
        if merged and window.start <= merged[-1].end + gap:
            merged[-1] = TranscriptionWindow(
                start=merged[-1].start, end=max(merged[-1].end, window.end)
            )
        else:
            merged.append(window)
    return merged


def plan_transcription_windows(
    *,
    duration: float,
    settings: ClipSettings,
    energy: EnergyProfile | None = None,
    padding: float = 2.0,
) -> list[TranscriptionWindow]:
    """Return the smallest set of audio regions needed to plan and caption clips.

    Even mode knows its target slots up front. Auto mode picks the highest-energy
    windows first, so a 20-minute source requested as 3 x 60 s only sends ~3 minutes
    of audio to Whisper. When the windows cover most of the source anyway, the
    caller should just transcribe the whole file.
    """

    if duration <= 0:
        return []
    count = effective_clip_count(duration=duration, settings=settings)
    min_length = max(1.0, float(settings.min_clip_seconds))
    max_length = max(min_length, float(settings.max_clip_seconds))
    padding = max(0.0, padding)

    if settings.selection_mode == ClipSelectionMode.EVEN:
        slot = duration / max(1, count)
        core = min(max_length, max(min_length, slot))
        length = min(duration, core + padding * 2)
        windows = [
            _centered_window((index + 0.5) * slot, length, duration) for index in range(count)
        ]
    else:
        if energy is None or not energy.rms:
            return [TranscriptionWindow(0.0, duration)]
        ideal = duration / max(1, count * 2)
        length = min(max_length, max(min_length, ideal)) + padding * 2
        length = min(duration, max(min_length, length))
        step = max(1.0, length / 2)
        candidates: list[tuple[float, float, float]] = []
        start = 0.0
        while start + min_length <= duration + 0.01:
            end = min(duration, start + length)
            if end - start >= min_length:
                candidates.append((energy.mean_energy(start, end), start, end))
            start += step
        candidates.sort(key=lambda item: item[0], reverse=True)
        chosen: list[TranscriptionWindow] = []
        for _score, start, end in candidates:
            if len(chosen) >= count:
                break
            if any(end > window.start + 0.5 and start < window.end - 0.5 for window in chosen):
                continue
            chosen.append(TranscriptionWindow(start=start, end=end))
        if len(chosen) < count:
            return [TranscriptionWindow(0.0, duration)]
        windows = chosen

    merged = _merge_windows(windows)
    covered = sum(window.duration for window in merged)
    if covered >= duration * _FULL_TRANSCRIPTION_COVERAGE:
        return [TranscriptionWindow(0.0, duration)]
    return merged


def build_boundaries(
    *,
    duration: float,
    transcript: Transcript,
    scenes: list[float],
    energy: EnergyProfile | None,
    min_clip: float,
    relaxed: bool = False,
) -> list[CutBoundary]:
    """Collect only safe starts/ends: sentence edges and silent gaps."""

    raw: list[CutBoundary] = [
        CutBoundary(0.0, "edge", 1.0),
        CutBoundary(round(duration, 3), "edge", 1.0),
    ]
    has_speech = bool(transcript.words)

    for sentence in transcript.sentences:
        if 0.05 < sentence.start < duration - 0.05:
            raw.append(CutBoundary(round(sentence.start, 3), "sentence", 0.95))
        if 0.05 < sentence.end < duration - 0.05:
            raw.append(CutBoundary(round(sentence.end, 3), "sentence", 0.95))

    for index in range(len(transcript.words) - 1):
        gap = transcript.words[index + 1].start - transcript.words[index].end
        if gap >= 0.32:
            midpoint = transcript.words[index].end + gap / 2
            if 0.05 < midpoint < duration - 0.05:
                raw.append(CutBoundary(round(midpoint, 3), "silence", 0.8))

    if energy is not None:
        for midpoint in energy.silence_midpoints(min_duration=0.28):
            if not (0.05 < midpoint < duration - 0.05):
                continue
            if any(word.start + 0.03 < midpoint < word.end - 0.03 for word in transcript.words):
                continue
            raw.append(CutBoundary(round(midpoint, 3), "silence", 0.75))

    if not has_speech:
        for scene in scenes:
            if 0.05 < scene < duration - 0.05:
                raw.append(CutBoundary(round(scene, 3), "scene", 0.55))
        grid = max(0.5, min(1.0, max(0.5, min_clip / 4)))
        cursor = grid
        while cursor < duration - 0.05:
            raw.append(CutBoundary(round(cursor, 3), "fallback", 0.25))
            cursor += grid
    elif relaxed:
        # Last-resort even-split boundaries: scene changes and word edges avoid
        # chopping a spoken word, even when no sentence pause fits the target.
        for scene in scenes:
            if 0.05 < scene < duration - 0.05:
                raw.append(CutBoundary(round(scene, 3), "scene", 0.42))
        if energy is not None:
            for minimum in energy.local_minima(radius_seconds=0.75):
                if 0.05 < minimum < duration - 0.05:
                    raw.append(CutBoundary(round(minimum, 3), "silence", 0.5))
        for word in transcript.words:
            if 0.05 < word.start < duration - 0.05:
                raw.append(CutBoundary(round(word.start, 3), "relaxed", 0.34))
            if 0.05 < word.end < duration - 0.05:
                raw.append(CutBoundary(round(word.end, 3), "relaxed", 0.32))

    return _merge_boundaries(raw, duration)


def _merge_boundaries(raw: list[CutBoundary], duration: float) -> list[CutBoundary]:
    ordered = sorted(raw, key=lambda item: (item.time, -item.strength))
    merged: list[CutBoundary] = []
    for boundary in ordered:
        time = max(0.0, min(duration, boundary.time))
        if merged and abs(time - merged[-1].time) < MIN_CUT_GAP:
            if boundary.strength > merged[-1].strength:
                merged[-1] = CutBoundary(time, boundary.kind, boundary.strength)
            continue
        merged.append(CutBoundary(time, boundary.kind, boundary.strength))
    if not merged or merged[0].time > 0.001:
        merged.insert(0, CutBoundary(0.0, "edge", 1.0))
    else:
        merged[0] = CutBoundary(0.0, "edge", 1.0)
    if abs(merged[-1].time - duration) > 0.001:
        merged.append(CutBoundary(duration, "edge", 1.0))
    else:
        merged[-1] = CutBoundary(duration, "edge", 1.0)
    return merged


def _even_plan(
    *,
    duration: float,
    count: int,
    min_length: float,
    max_length: float,
    boundaries: list[CutBoundary],
) -> list[ClipPlan]:
    times = [boundary.time for boundary in boundaries]
    total = len(times)
    if total < count + 1:
        raise SelectionError(
            "There aren't enough natural cut points for that many clips. "
            "Try fewer clips or a shorter minimum length."
        )

    negative = float("-inf")
    previous = [negative] * total
    back_pointers: list[list[int]] = [[-1] * total for _ in range(count + 1)]
    for j, time in enumerate(times):
        if min_length - _EPSILON <= time <= max_length + _EPSILON:
            previous[j] = _snap_cost(time, duration, 1, count, boundaries[j])

    for k in range(2, count + 1):
        current = [negative] * total
        add_index = 0
        window: deque[int] = deque()
        for j in range(total):
            upper_limit = times[j] - min_length + _EPSILON
            lower_limit = times[j] - max_length - _EPSILON
            while add_index < j and times[add_index] <= upper_limit:
                value = previous[add_index]
                if value != negative:
                    while window and previous[window[-1]] >= value:
                        window.pop()
                    window.append(add_index)
                add_index += 1
            while window and times[window[0]] < lower_limit:
                window.popleft()
            if j == total - 1:
                cost = _snap_cost(times[j], duration, k, count, boundaries[j], final=True)
            else:
                cost = _snap_cost(times[j], duration, k, count, boundaries[j])
            if window and math.isfinite(cost):
                predecessor = window[0]
                current[j] = previous[predecessor] + cost
                back_pointers[k][j] = predecessor
        if not any(value != negative for value in current):
            break
        previous = current

    if previous[total - 1] == negative:
        raise SelectionError(
            "CutClipper couldn't split this video evenly at natural sentence or silence "
            "boundaries. Try fewer clips, wider length limits, or Auto-highlights.",
            details={"reason": "no_even_plan"},
        )

    indices = [total - 1]
    k = count
    j = total - 1
    while k > 1:
        j = back_pointers[k][j]
        if j < 0:
            raise SelectionError(
                "CutClipper couldn't find a valid even split. Try different clip settings."
            )
        indices.append(j)
        k -= 1
    indices.append(0)
    indices.reverse()

    clips: list[ClipPlan] = []
    for index in range(count):
        start_boundary = boundaries[indices[index]]
        end_boundary = boundaries[indices[index + 1]]
        clips.append(
            ClipPlan(
                start=round(start_boundary.time, 3),
                end=round(end_boundary.time, 3),
                score=0.0,
                selection_mode="even",
                boundary_start=start_boundary.kind,
                boundary_end=end_boundary.kind,
            )
        )
    return clips


def _apply_scores(
    clips: list[ClipPlan],
    *,
    words: list[Word],
    scenes: list[float],
    energy: EnergyProfile | None,
) -> list[ClipPlan]:
    starts = [word.start for word in words]
    ends = [word.end for word in words]
    for clip in clips:
        score, _, _ = _score_window(
            clip.start,
            clip.end,
            words=words,
            word_starts=starts,
            word_ends=ends,
            scenes=scenes,
            energy=energy,
            start_kind=clip.boundary_start,
            end_kind=clip.boundary_end,
        )
        clip.score = round(min(100.0, max(1.0, score * 100)), 1)
    return clips


def _snap_cost(
    time: float,
    duration: float,
    index: int,
    count: int,
    boundary: CutBoundary,
    *,
    final: bool = False,
) -> float:
    ideal = duration * index / count
    deviation = 0.0 if final else (time - ideal) ** 2 / max(duration, 1.0)
    preference = 0.0 if final else (1.0 - boundary.strength) * 1.8
    return deviation + preference


def _auto_plan(
    *,
    duration: float,
    count: int,
    min_length: float,
    max_length: float,
    boundaries: list[CutBoundary],
    transcript: Transcript,
    scenes: list[float],
    energy: EnergyProfile | None,
    allowed_windows: list[TranscriptionWindow] | None = None,
) -> list[ClipPlan]:
    candidates = _generate_candidates(
        duration=duration,
        count=count,
        min_length=min_length,
        max_length=max_length,
        boundaries=boundaries,
        transcript=transcript,
        scenes=scenes,
        energy=energy,
        allowed_windows=allowed_windows,
    )
    if allowed_windows and not candidates:
        # The windows were too tight for the requested length range; fall back
        # to the whole timeline rather than failing the job.
        candidates = _generate_candidates(
            duration=duration,
            count=count,
            min_length=min_length,
            max_length=max_length,
            boundaries=boundaries,
            transcript=transcript,
            scenes=scenes,
            energy=energy,
        )
    if not candidates:
        fallback = _fallback_plan(
            duration=duration,
            count=count,
            min_length=min_length,
            max_length=max_length,
        )
        if fallback:
            return fallback
        raise SelectionError(
            "No highlight windows fit the requested length range. Try a shorter "
            "minimum length or a longer maximum.",
            details={"reason": "no_candidates"},
        )
    selected = _weighted_choose(candidates, count)
    if selected is None:
        fallback = _fallback_plan(
            duration=duration,
            count=count,
            min_length=min_length,
            max_length=max_length,
        )
        if fallback:
            return fallback
        raise SelectionError(
            "CutClipper couldn't find enough non-overlapping highlights with those "
            "settings. Try fewer clips, a shorter minimum length, or wider limits.",
            details={"reason": "not_enough_non_overlapping"},
        )
    selected.sort(key=lambda candidate: candidate.start)
    clips: list[ClipPlan] = []
    for candidate in selected:
        start_kind = _boundary_kind(boundaries, candidate.start)
        end_kind = _boundary_kind(boundaries, candidate.end)
        clips.append(
            ClipPlan(
                start=round(candidate.start, 3),
                end=round(candidate.end, 3),
                score=round(min(100.0, max(1.0, candidate.score * 100)), 1),
                selection_mode="auto",
                boundary_start=start_kind,
                boundary_end=end_kind,
            )
        )
    return clips


def _fallback_plan(
    *,
    duration: float,
    count: int,
    min_length: float,
    max_length: float,
) -> list[ClipPlan]:
    """Last-resort evenly spaced clips so auto mode never fails on sparse cuts."""

    if duration < min_length - _EPSILON or count < 1:
        return []
    slot = duration / count
    length = min(max_length, max(min_length, slot))
    clips: list[ClipPlan] = []
    for index in range(count):
        start = min(max(0.0, index * slot), max(0.0, duration - length))
        end = min(duration, start + length)
        if end - start < min_length - _EPSILON:
            start = max(0.0, end - length)
        if not (min_length - _EPSILON <= end - start <= max_length + _EPSILON):
            continue
        clips.append(
            ClipPlan(
                start=round(start, 3),
                end=round(end, 3),
                score=50.0,
                selection_mode="auto",
                boundary_start="fallback",
                boundary_end="fallback",
            )
        )
    return clips if len(clips) == count else []


def _boundary_kind(boundaries: list[CutBoundary], time: float) -> str:
    for boundary in boundaries:
        if abs(boundary.time - time) <= MIN_CUT_GAP:
            return boundary.kind
    return "unknown"


def _generate_candidates(
    *,
    duration: float,
    count: int,
    min_length: float,
    max_length: float,
    boundaries: list[CutBoundary],
    transcript: Transcript,
    scenes: list[float],
    energy: EnergyProfile | None,
    allowed_windows: list[TranscriptionWindow] | None = None,
) -> list[_Candidate]:
    times = [boundary.time for boundary in boundaries]

    def in_allowed_window(start: float, end: float) -> bool:
        if not allowed_windows:
            return True
        return any(
            start >= window.start - 0.5 and end <= window.end + 0.5 for window in allowed_windows
        )

    words = transcript.words
    word_starts = [word.start for word in words]
    word_ends = [word.end for word in words]
    candidates_by_key: dict[tuple[int, int], _Candidate] = {}
    start_limit = duration - min_length + 0.01
    for start_index, boundary in enumerate(boundaries[:-1]):
        if boundary.time > start_limit:
            break
        low = boundary.time + min_length - _EPSILON
        high = min(boundary.time + max_length + _EPSILON, duration)
        first = bisect_left(times, low, lo=start_index + 1)
        last = bisect_right(times, high, lo=first) - 1
        if first > last:
            continue
        chosen_end_indices: set[int] = {first, last}
        span = max_length - min_length
        targets = [
            min_length + span * 0.22,
            min_length + span * 0.45,
            min_length + span * 0.68,
            min_length + span * 0.90,
        ]
        for target in targets:
            index = bisect_left(times, boundary.time + target, lo=first, hi=last + 1)
            for candidate_index in (index - 1, index):
                if first <= candidate_index <= last:
                    chosen_end_indices.add(candidate_index)
        # Add a couple of sentence-end-aligned endpoints near the preferred lengths.
        for target in (min_length, (min_length + max_length) / 2, max_length):
            index = bisect_left(times, boundary.time + target, lo=first, hi=last + 1)
            search = 0
            limit = max(first, index - 4)
            candidate_index = min(last, index)
            while candidate_index >= limit and search < 6:
                if boundaries[candidate_index].kind == "sentence":
                    chosen_end_indices.add(candidate_index)
                    break
                search += 1
                candidate_index -= 1

        for end_index in sorted(chosen_end_indices):
            start_time = boundary.time
            end_time = boundaries[end_index].time
            length = end_time - start_time
            if length < min_length - _EPSILON or length > max_length + _EPSILON:
                continue
            if not in_allowed_window(start_time, end_time):
                continue
            score, _density, speech_seconds = _score_window(
                start_time,
                end_time,
                words=words,
                word_starts=word_starts,
                word_ends=word_ends,
                scenes=scenes,
                energy=energy,
                start_kind=boundary.kind,
                end_kind=boundaries[end_index].kind,
            )
            if transcript.has_speech:
                if speech_seconds <= 0.005:
                    continue
                if speech_seconds < min(2.0, length * 0.2):
                    score *= 0.7
            candidate = _Candidate(
                start=start_time,
                end=end_time,
                score=min(1.0, max(0.0, score)),
                origin="highlight",
            )
            candidates_by_key[(round(start_time, 2), round(end_time, 2))] = candidate

    # A valid even partition anchors feasibility, guaranteeing exact-count output.
    try:
        even_clips = _even_plan(
            duration=duration,
            count=count,
            min_length=min_length,
            max_length=max_length,
            boundaries=boundaries,
        )
        for clip in even_clips:
            score, _, _ = _score_window(
                clip.start,
                clip.end,
                words=words,
                word_starts=word_starts,
                word_ends=word_ends,
                scenes=scenes,
                energy=energy,
                start_kind=clip.boundary_start,
                end_kind=clip.boundary_end,
            )
            if not in_allowed_window(clip.start, clip.end):
                continue
            key = (round(clip.start, 2), round(clip.end, 2))
            candidates_by_key[key] = _Candidate(
                start=clip.start,
                end=clip.end,
                score=min(1.0, max(0.0, score)),
                origin="fallback",
            )
    except SelectionError:
        pass

    candidates = list(candidates_by_key.values())
    candidates.sort(key=lambda c: (c.end, c.start))
    if len(candidates) > 40_000:
        candidates = candidates[:: max(1, len(candidates) // 40_000)]
    return candidates


def _speech_stats(
    words: list[Word],
    word_starts: list[float],
    word_ends: list[float],
    start: float,
    end: float,
) -> tuple[int, float]:
    left = bisect_right(word_ends, start + 0.01)
    right = bisect_left(word_starts, end - 0.01)
    if right <= left:
        return 0, 0.0
    seconds = 0.0
    for index in range(left, right):
        word = words[index]
        seconds += max(0.0, min(end, word.end) - max(start, word.start))
    return right - left, seconds


def _score_window(
    start: float,
    end: float,
    *,
    words: list[Word],
    word_starts: list[float],
    word_ends: list[float],
    scenes: list[float],
    energy: EnergyProfile | None,
    start_kind: str,
    end_kind: str,
) -> tuple[float, float, float]:
    length = max(0.001, end - start)
    word_count, speech_seconds = _speech_stats(words, word_starts, word_ends, start, end)
    speech_seconds = min(length, speech_seconds)
    density = speech_seconds / length

    energy_score = energy.mean_energy(start, end) if energy is not None else 0.0
    if energy is not None:
        edge_energy = min(
            energy.energy_at(start + min(0.3, length * 0.1)),
            energy.energy_at(end - min(0.3, length * 0.1)),
        )
        energy_score = 0.78 * energy_score + 0.22 * edge_energy

    boundary_score = _kind_strength(start_kind) * 0.5 + _kind_strength(end_kind) * 0.5
    scene_score = _scene_score(scenes, start, end)

    if word_count:
        score = (
            0.44 * energy_score
            + 0.28 * min(1.0, density / 0.82)
            + 0.18 * boundary_score
            + 0.10 * scene_score
        )
        score = min(1.0, max(0.0, score))
    else:
        score = 0.62 * energy_score + 0.26 * scene_score + 0.12 * boundary_score
        score = min(1.0, max(0.0, score))
    return score, density, speech_seconds


def _kind_strength(kind: str) -> float:
    return {
        "sentence": 0.95,
        "silence": 0.8,
        "scene": 0.55,
        "fallback": 0.25,
        "relaxed": 0.34,
        "edge": 1.0,
    }.get(kind, 0.4)


def _scene_score(scenes: list[float], start: float, end: float) -> float:
    if not scenes:
        return 0.0
    proximity = 0.0
    for edge in (start, end):
        index = bisect_left(scenes, edge)
        for neighbor in (index - 1, index):
            if 0 <= neighbor < len(scenes):
                nearest = abs(scenes[neighbor] - edge)
                proximity = max(proximity, max(0.0, 1.0 - nearest / 2.0))
    inside = max(
        0,
        bisect_left(scenes, end - 0.5) - bisect_right(scenes, start + 0.5),
    )
    density = min(1.0, inside / max(1.0, (end - start) / 25.0))
    return 0.68 * proximity + 0.32 * density


def _weighted_choose(candidates: list[_Candidate], count: int) -> list[_Candidate] | None:
    """Exact-K weighted interval scheduling with non-overlapping windows."""

    if count <= 0 or len(candidates) < count:
        return None
    candidates = sorted(candidates, key=lambda c: (c.end, c.start))
    ends = [candidate.end for candidate in candidates]
    previous_indices = [
        bisect_right(ends, candidate.start + 1e-6, hi=index)
        for index, candidate in enumerate(candidates)
    ]
    total = len(candidates)
    negative = float("-inf")
    previous_row = [0.0] * (total + 1)
    choices: list[bytearray] = [bytearray(total + 1) for _ in range(count + 1)]

    for k in range(1, count + 1):
        current = [negative] * (total + 1)
        row_choice = choices[k]
        for index in range(1, total + 1):
            candidate = candidates[index - 1]
            skip = current[index - 1]
            take_previous = previous_row[previous_indices[index - 1]]
            take = take_previous + candidate.score if take_previous != negative else negative
            if take > skip or (take == skip and take != negative and not row_choice[index - 1]):
                current[index] = take
                row_choice[index] = 1
            else:
                current[index] = skip
        if all(value == negative for value in current):
            return None
        previous_row = current

    if previous_row[total] == negative:
        return None
    selected: list[_Candidate] = []
    k = count
    index = total
    while k > 0 and index > 0:
        if choices[k][index]:
            candidate = candidates[index - 1]
            selected.append(candidate)
            index = previous_indices[index - 1]
            k -= 1
        else:
            index -= 1
    if len(selected) != count:
        return None
    selected.reverse()
    return selected


def boundaries_snapped_to(
    value: float,
    boundaries: list[CutBoundary],
    *,
    tolerance: float = 3.0,
) -> CutBoundary | None:
    """Test helper: find the closest safe boundary within a tolerance."""

    if not boundaries:
        return None
    closest = min(boundaries, key=lambda boundary: abs(boundary.time - value))
    return closest if abs(closest.time - value) <= tolerance else None


def sentence_for_time(sentences: list[Sentence], time: float) -> Sentence | None:
    for sentence in sentences:
        if sentence.start - 0.001 <= time <= sentence.end + 0.001:
            return sentence
    return None


def is_sentence_boundary(words: list[Word], time: float, tolerance: float = 0.2) -> bool:
    """Test helper for asserting cuts land on word edges rather than inside words."""

    return all(not word.start + tolerance < time < word.end - tolerance for word in words)


def summarize_candidate_scores(candidates: list[_Candidate]) -> np.ndarray:
    return np.asarray([candidate.score for candidate in candidates], dtype=np.float32)
