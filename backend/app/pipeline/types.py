"""Shared domain types used by the media pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class Word:
    start: float
    end: float
    text: str
    probability: float = 1.0

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass(slots=True)
class Sentence:
    start: float
    end: float
    text: str
    word_indices: list[int] = field(default_factory=list)


@dataclass(slots=True)
class Transcript:
    words: list[Word] = field(default_factory=list)
    sentences: list[Sentence] = field(default_factory=list)
    language: str | None = None
    language_probability: float | None = None
    duration: float = 0.0
    warnings: list[str] = field(default_factory=list)

    @property
    def has_speech(self) -> bool:
        return bool(self.words)

    def words_between(self, start: float, end: float) -> list[Word]:
        return [word for word in self.words if word.end > start and word.start < end]


@dataclass(slots=True)
class ClipPlan:
    start: float
    end: float
    score: float
    selection_mode: str
    boundary_start: str = "sentence"
    boundary_end: str = "sentence"

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass(slots=True)
class CutBoundary:
    time: float
    kind: str  # sentence, silence, scene, edge, fallback
    strength: float = 0.5


@dataclass(slots=True)
class CaptionRenderResult:
    path: str
    event_count: int
    word_count: int
