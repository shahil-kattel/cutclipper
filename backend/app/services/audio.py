"""Audio extraction and energy analysis for highlight scoring."""

from __future__ import annotations

import asyncio
import logging
import math
import wave
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event

import numpy as np

from app.core.errors import ProcessingError
from app.services.media import get_media_tools
from app.services.process import run_process

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class EnergyProfile:
    window_seconds: float
    rms: list[float]
    duration: float
    _normalized: np.ndarray = field(init=False, repr=False)
    _silence_threshold: float = field(init=False, repr=False)

    def __post_init__(self) -> None:
        values = np.asarray(self.rms, dtype=np.float32)
        if values.size == 0:
            self._normalized = values
            self._silence_threshold = 0.0
            return
        p95 = float(np.percentile(values, 95))
        scale = max(p95, 1e-6)
        self._normalized = np.clip(values / scale, 0.0, 1.0)
        p20 = float(np.percentile(values, 20))
        median = float(np.median(values))
        threshold = max(0.0015, min(p20 * 1.55 + 0.0004, median * 0.35))
        self._silence_threshold = threshold

    @property
    def normalized(self) -> np.ndarray:
        return self._normalized

    def mean_energy(self, start: float, end: float) -> float:
        if end <= start or not self.rms:
            return 0.0
        first = max(0, int(start / self.window_seconds))
        last = min(len(self._normalized), max(first + 1, math.ceil(end / self.window_seconds)))
        if first >= last:
            return 0.0
        return float(np.mean(self._normalized[first:last]))

    def energy_at(self, time: float) -> float:
        if not self.rms:
            return 0.0
        index = min(len(self._normalized) - 1, max(0, int(time / self.window_seconds)))
        return float(self._normalized[index])

    def silence_midpoints(self, *, min_duration: float = 0.3) -> list[float]:
        """Return centers of low-energy runs, useful as safe cut candidates."""

        if not self.rms:
            return []
        quiet = np.asarray(self.rms) <= self._silence_threshold
        midpoints: list[float] = []
        run_start: int | None = None
        for index, is_quiet in enumerate([*quiet.tolist(), False]):
            if is_quiet and run_start is None:
                run_start = index
            elif not is_quiet and run_start is not None:
                length = (index - run_start) * self.window_seconds
                if length >= min_duration:
                    center = (run_start + (index - run_start) / 2) * self.window_seconds
                    midpoints.append(round(center, 3))
                run_start = None
        return midpoints

    def local_minima(self, *, radius_seconds: float = 1.0) -> list[float]:
        """Find quiet local minima even in noisy recordings."""

        if not self.rms:
            return []
        values = self.normalized
        radius = max(1, int(radius_seconds / self.window_seconds))
        minima: list[float] = []
        # Coarse stride keeps this cheap for long videos.
        stride = max(1, radius // 2)
        for index in range(radius, len(values) - radius, stride):
            window = values[index - radius : index + radius + 1]
            if values[index] <= float(np.min(window)) + 1e-6:
                minima.append(round(index * self.window_seconds, 3))
        return minima


async def extract_audio(
    source: Path,
    output: Path,
    *,
    cancel_event: Event,
    timeout_seconds: float = 1800,
) -> Path:
    tools = get_media_tools()
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        tools.ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(output),
    ]
    result = await run_process(
        command,
        cancel_event=cancel_event,
        timeout_seconds=timeout_seconds,
    )
    if result.returncode != 0 or not output.exists() or output.stat().st_size < 100:
        raise ProcessingError(
            "The audio track could not be extracted. It may be empty or damaged.",
            code="audio_extraction_failed",
            details={"stderr": result.stderr[-1000:]},
        )
    return output


def analyze_energy_sync(audio_path: Path, *, window_seconds: float = 0.25) -> EnergyProfile:
    try:
        with wave.open(str(audio_path), "rb") as wav:
            sample_rate = wav.getframerate()
            frame_count = wav.getnframes()
            sample_width = wav.getsampwidth()
            channels = wav.getnchannels()
            if sample_width != 2 or channels != 1:
                raise ValueError(f"unexpected WAV format {sample_width * 8}bit/{channels}ch")
            window_frames = max(1, int(sample_rate * window_seconds))
            values: list[float] = []
            while True:
                raw = wav.readframes(window_frames)
                if not raw:
                    break
                samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                if samples.size == 0:
                    break
                rms = float(np.sqrt(np.mean(np.square(samples))))
                values.append(rms)
            duration = frame_count / sample_rate if sample_rate else 0.0
    except (wave.Error, OSError, ValueError) as exc:
        raise ProcessingError(
            "The extracted audio could not be analyzed.",
            code="audio_analysis_failed",
            details={"error": str(exc)},
        ) from exc
    return EnergyProfile(window_seconds=window_seconds, rms=values, duration=duration)


async def analyze_energy(audio_path: Path) -> EnergyProfile:
    return await asyncio.to_thread(analyze_energy_sync, audio_path)
