"""Isolated PySceneDetect worker.

Run as a subprocess so OpenCV's bundled FFmpeg libraries never collide with
PyAV in the API process.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--threshold", type=float, default=27.0)
    parser.add_argument("--min-scene-seconds", type=float, default=1.2)
    args = parser.parse_args()

    logging.basicConfig(level=logging.ERROR)
    try:
        from scenedetect import SceneManager, open_video
        from scenedetect.detectors import ContentDetector

        video = open_video(str(args.video), backend="opencv")
        manager = SceneManager()
        manager.auto_downscale = True
        manager.add_detector(
            ContentDetector(
                threshold=args.threshold,
                min_scene_len=max(1, int(args.min_scene_seconds * (video.frame_rate or 30))),
            )
        )
        manager.detect_scenes(video, frame_skip=1, show_progress=False)
        scene_list = manager.get_scene_list(start_in_scene=False)
        scenes = [
            {
                "start": round(start.get_seconds(), 3),
                "end": round(end.get_seconds(), 3),
            }
            for start, end in scene_list
        ]
        payload = {
            "ok": True,
            "scenes": scenes,
            "fps": float(video.frame_rate) if video.frame_rate else None,
        }
    except Exception as exc:
        payload = {"ok": False, "scenes": [], "error": f"{type(exc).__name__}: {exc}"}

    try:
        args.output.write_text(json.dumps(payload), encoding="utf-8")
    except Exception as exc:
        print(f"scene worker could not write output: {exc}", file=sys.stderr)
        return 1
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
