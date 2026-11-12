"""Scene change detection orchestrated in an isolated worker."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event

from app.config import BACKEND_ROOT
from app.core.errors import JobCancelledError
from app.services.process import run_process

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class SceneAnalysis:
    cuts: list[float] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _worker_env() -> dict[str, str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{BACKEND_ROOT}{os.pathsep}{existing}" if existing else str(BACKEND_ROOT)
    return env


async def detect_scenes(
    source: Path,
    work_dir: Path,
    *,
    cancel_event: Event,
    timeout_seconds: float = 900,
) -> SceneAnalysis:
    output_path = work_dir / "scenes.json"
    if output_path.exists():
        output_path.unlink()
    command = [
        sys.executable,
        "-m",
        "app.services.scene_worker",
        str(source),
        str(output_path),
    ]
    try:
        result = await run_process(
            command,
            cancel_event=cancel_event,
            timeout_seconds=timeout_seconds,
            cwd=BACKEND_ROOT,
            env=_worker_env(),
        )
    except JobCancelledError:
        raise
    except Exception as exc:
        logger.warning("scene detection process failed", extra={"error": str(exc)})
        return SceneAnalysis(warnings=["Scene detection was unavailable; using audio cuts only."])

    if result.returncode != 0 or not output_path.exists():
        logger.warning("scene detection failed", extra={"stderr": result.stderr[-1000:]})
        return SceneAnalysis(
            warnings=["Scene changes could not be detected; using audio cuts only."]
        )
    try:
        payload = json.loads(output_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return SceneAnalysis(warnings=["Scene detection returned invalid data."])
    if not payload.get("ok"):
        error = payload.get("error") or "unknown scene detection error"
        logger.warning("scene detection failed", extra={"error": error})
        return SceneAnalysis(
            warnings=["Scene changes could not be detected; using audio cuts only."]
        )

    cuts: list[float] = []
    for scene in payload.get("scenes", []):
        try:
            start = float(scene.get("start", 0))
            end = float(scene.get("end", 0))
        except (TypeError, ValueError):
            continue
        if start > 0:
            cuts.append(round(start, 3))
        if end > 0:
            cuts.append(round(end, 3))
    cuts = sorted(set(cuts))
    logger.info("scene detection complete", extra={"cuts": len(cuts)})
    return SceneAnalysis(cuts=cuts)


def detect_scenes_sync(source: Path, work_dir: Path) -> SceneAnalysis:
    """Synchronous wrapper for tests and CLI tooling."""

    return asyncio.run(detect_scenes(source, work_dir, cancel_event=Event()))
