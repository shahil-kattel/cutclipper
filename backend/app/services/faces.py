"""Frame extraction, isolated face detection, and stabilized crop paths."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import shutil
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event

import numpy as np

from app.config import BACKEND_ROOT
from app.core.errors import JobCancelledError, ProcessingError
from app.services.media import get_media_tools
from app.services.process import run_process

logger = logging.getLogger(__name__)

SAMPLE_FPS = 4.0


@dataclass(slots=True)
class FaceTrack:
    samples: list[tuple[float, float, float]] = field(default_factory=list)
    has_face: bool = False
    face_fraction: float = 0.0
    warning: str | None = None

    @staticmethod
    def centered() -> FaceTrack:
        return FaceTrack(samples=[(0.0, 0.5, 0.5)], has_face=False)


def _worker_env() -> dict[str, str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{BACKEND_ROOT}{os.pathsep}{existing}" if existing else str(BACKEND_ROOT)
    return env


def _gaussian_smooth(values: np.ndarray, sigma: float) -> np.ndarray:
    if values.size < 2:
        return values
    sigma = max(0.35, sigma)
    radius = max(1, math.ceil(sigma * 3))
    x = np.arange(-radius, radius + 1, dtype=np.float32)
    kernel = np.exp(-(x**2) / (2 * sigma**2))
    kernel /= float(kernel.sum())
    padded = np.pad(values, (radius, radius), mode="edge")
    return np.convolve(padded, kernel, mode="valid").astype(np.float32)


def _rolling_median(values: np.ndarray, window: int = 5) -> np.ndarray:
    if values.size < 3:
        return values
    window = max(3, window | 1)
    half = window // 2
    padded = np.pad(values, (half, half), mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, window)
    return np.median(windows, axis=-1).astype(np.float32)


def _simplify_path(
    samples: list[tuple[float, float, float]], tolerance: float = 0.0018
) -> list[tuple[float, float, float]]:
    if len(samples) <= 2:
        return samples
    points = np.asarray([(x, y) for _, x, y in samples], dtype=np.float64)
    keep = np.zeros(len(samples), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(samples) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        p0 = points[first]
        p1 = points[last]
        segment = p1 - p0
        length = float(np.linalg.norm(segment))
        if length < 1e-9:
            distances = np.linalg.norm(points[first + 1 : last] - p0, axis=1)
        else:
            rel = points[first + 1 : last] - p0
            distances = np.abs(rel[:, 0] * segment[1] - rel[:, 1] * segment[0]) / length
        index = int(np.argmax(distances))
        if float(distances[index]) > tolerance:
            middle = first + 1 + index
            keep[middle] = True
            stack.append((first, middle))
            stack.append((middle, last))
    return [sample for sample, selected in zip(samples, keep.tolist(), strict=True) if selected]


def stabilise_face_path(
    raw_samples: list[dict[str, float] | None],
    *,
    sample_fps: float,
    duration: float,
) -> FaceTrack:
    """Interpolate, de-jitter, and smoothly ease face-centered crop positions."""

    if not raw_samples:
        return FaceTrack.centered()
    count = len(raw_samples)
    times = np.clip((np.arange(count, dtype=np.float32) + 0.5) / sample_fps, 0, duration)
    known = np.asarray(
        [sample is not None and "x" in sample and "y" in sample for sample in raw_samples],
        dtype=bool,
    )
    face_fraction = float(known.mean()) if count else 0.0
    if not known.any() or face_fraction < 0.10:
        return FaceTrack.centered()

    x = np.asarray(
        [float(sample["x"]) if sample else np.nan for sample in raw_samples], dtype=np.float32
    )
    y = np.asarray(
        [float(sample["y"]) if sample else np.nan for sample in raw_samples], dtype=np.float32
    )
    indices = np.arange(count, dtype=np.float32)
    known_indices = indices[known]
    x = np.interp(indices, known_indices, x[known]).astype(np.float32)
    y = np.interp(indices, known_indices, y[known]).astype(np.float32)

    x = _rolling_median(x, 5)
    y = _rolling_median(y, 5)
    # A ~0.55 s Gaussian window removes detector noise while preserving deliberate pans.
    sigma = max(0.75, sample_fps * 0.55)
    x = _gaussian_smooth(x, sigma)
    y = _gaussian_smooth(y, sigma)
    x = np.clip(x, 0.04, 0.96)
    y = np.clip(y, 0.08, 0.92)

    merged: list[tuple[float, float, float]] = []
    for i in range(count):
        merged.append((float(times[i]), float(x[i]), float(y[i])))
    if merged and merged[-1][0] < duration:
        merged.append((duration, merged[-1][1], merged[-1][2]))
    merged = _simplify_path(merged)
    warning = None
    if face_fraction < 0.30:
        warning = "A face was only visible briefly; some shots use center framing."
    return FaceTrack(
        samples=merged,
        has_face=True,
        face_fraction=round(face_fraction, 3),
        warning=warning,
    )


async def _extract_frames(
    source: Path,
    frames_dir: Path,
    start: float,
    duration: float,
    *,
    cancel_event: Event,
) -> None:
    tools = get_media_tools()
    frames_dir.mkdir(parents=True, exist_ok=True)
    command = [
        tools.ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start:.3f}",
        "-t",
        f"{duration:.3f}",
        "-i",
        str(source),
        "-vf",
        f"fps={SAMPLE_FPS:g},scale=480:-2",
        "-q:v",
        "4",
        str(frames_dir / "frame_%05d.jpg"),
    ]
    result = await run_process(
        command,
        cancel_event=cancel_event,
        timeout_seconds=max(120.0, duration * 3.0),
    )
    if result.returncode != 0:
        raise ProcessingError(
            "Frames could not be sampled for face tracking.",
            code="frame_sampling_failed",
            details={"stderr": result.stderr[-800:]},
        )


async def track_faces(
    source: Path,
    work_dir: Path,
    start: float,
    duration: float,
    *,
    cancel_event: Event,
) -> FaceTrack:
    """Detect faces in a subprocess and return a stabilized crop path."""

    token = uuid.uuid4().hex[:10]
    frames_dir = work_dir / f"frames_{token}"
    output_path = work_dir / f"faces_{token}.json"
    try:
        await _extract_frames(source, frames_dir, start, duration, cancel_event=cancel_event)
        if not any(frames_dir.iterdir()):
            return FaceTrack.centered()
        command = [
            sys.executable,
            "-m",
            "app.services.face_worker",
            str(frames_dir),
            str(output_path),
        ]
        result = await run_process(
            command,
            cancel_event=cancel_event,
            timeout_seconds=max(120.0, duration * 2.0),
            cwd=BACKEND_ROOT,
            env=_worker_env(),
        )
        if result.returncode != 0 or not output_path.exists():
            logger.warning("face worker failed", extra={"stderr": result.stderr[-1200:]})
            return FaceTrack(
                samples=[(0.0, 0.5, 0.5)],
                warning="Face tracking was unavailable; using center framing.",
            )
        payload = json.loads(output_path.read_text(encoding="utf-8"))
        if not payload.get("ok"):
            return FaceTrack(
                samples=[(0.0, 0.5, 0.5)],
                warning="Face tracking failed for a clip; using center framing.",
            )
        track = stabilise_face_path(
            payload.get("samples") or [],
            sample_fps=SAMPLE_FPS,
            duration=duration,
        )
        if not track.has_face:
            return FaceTrack(
                samples=[(0.0, 0.5, 0.5)],
                warning="No face was detected; center framing was used.",
            )
        return track
    except JobCancelledError:
        raise
    except Exception as exc:
        logger.warning("face tracking failed: %s", exc, exc_info=True)
        return FaceTrack(
            samples=[(0.0, 0.5, 0.5)],
            warning="Face tracking was unavailable; center framing was used.",
        )
    finally:
        shutil.rmtree(frames_dir, ignore_errors=True)
        output_path.unlink(missing_ok=True)


def track_faces_sync(source: Path, work_dir: Path, start: float, duration: float) -> FaceTrack:
    return asyncio.run(track_faces(source, work_dir, start, duration, cancel_event=Event()))
