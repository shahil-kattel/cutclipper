"""Isolated OpenCV face detection worker."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("frames_dir", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    logging.basicConfig(level=logging.ERROR)
    try:
        import cv2

        cascade = cv2.CascadeClassifier(
            str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
        )
        if cascade.empty():
            raise RuntimeError("OpenCV face cascade could not be loaded")

        frame_paths = sorted(
            path
            for path in args.frames_dir.iterdir()
            if path.suffix.lower() in {".jpg", ".jpeg", ".png"}
        )
        samples: list[dict[str, float] | None] = []
        width = height = 0
        previous_center: tuple[float, float] | None = None
        misses = 0
        for frame_path in frame_paths:
            image = cv2.imread(str(frame_path))
            if image is None:
                samples.append(None)
                continue
            height, width = image.shape[:2]
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            min_face = max(24, int(width * 0.045))
            faces = cascade.detectMultiScale(
                gray,
                scaleFactor=1.12,
                minNeighbors=5,
                minSize=(min_face, min_face),
                flags=cv2.CASCADE_SCALE_IMAGE,
            )
            if len(faces) == 0:
                samples.append(None)
                previous_center = previous_center if misses < 8 else None
                misses += 1
                continue

            candidates = []
            for x, y, w, h in faces:
                center_x = (float(x) + float(w) / 2) / width
                center_y = (float(y) + float(h) / 2) / height
                area = (float(w) * float(h)) / (width * height)
                continuity = 1.0
                if previous_center is not None:
                    distance = (
                        (center_x - previous_center[0]) ** 2 + (center_y - previous_center[1]) ** 2
                    ) ** 0.5
                    continuity = 1.45 if distance < 0.22 else 0.7
                score = area * continuity
                candidates.append((score, center_x, center_y, area))
            _, center_x, center_y, area = max(candidates, key=lambda item: item[0])
            samples.append(
                {"x": round(center_x, 5), "y": round(center_y, 5), "area": round(area, 6)}
            )
            previous_center = (center_x, center_y)
            misses = 0

        payload = {
            "ok": True,
            "width": width,
            "height": height,
            "frame_count": len(frame_paths),
            "samples": samples,
        }
    except Exception as exc:
        payload = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "samples": []}

    args.output.write_text(json.dumps(payload), encoding="utf-8")
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
