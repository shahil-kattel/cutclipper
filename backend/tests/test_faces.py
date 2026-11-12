from __future__ import annotations

from app.services.faces import FaceTrack, stabilise_face_path


def test_face_path_fills_gaps_and_returns_compact_path() -> None:
    raw = [{"x": 0.2 + i * 0.01, "y": 0.45} for i in range(40)]
    raw[10] = None
    raw[11] = None
    track = stabilise_face_path(raw, sample_fps=4.0, duration=10.0)
    assert track.has_face
    assert len(track.samples) >= 2
    assert all(0 <= x <= 1 and 0 <= y <= 1 for _, x, y in track.samples)
    assert track.samples[0][0] <= 0.25
    assert track.samples[-1][0] <= 10.0


def test_face_path_falls_back_when_no_face() -> None:
    track = stabilise_face_path([None] * 10, sample_fps=4.0, duration=2.5)
    assert track == FaceTrack.centered() or not track.has_face
    assert not track.has_face
