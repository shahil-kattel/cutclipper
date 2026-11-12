from __future__ import annotations

import pytest

from app.core.errors import URLValidationError
from app.core.validation import normalize_url, validate_public_url_shape


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://www.youtube.com/watch?v=abc123", "https://www.youtube.com/watch?v=abc123"),
        ("youtu.be/abc123", "https://youtu.be/abc123"),
        ("vimeo.com/123456", "https://vimeo.com/123456"),
        ("https://example.com/media/clip.mp4", "https://example.com/media/clip.mp4"),
    ],
)
def test_normalizes_public_urls(raw: str, expected: str) -> None:
    assert normalize_url(raw) == expected
    assert validate_public_url_shape(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "not a url",
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/plain,hello",
        "ftp://example.com/video.mp4",
        "https://localhost/video.mp4",
        "http://127.0.0.1:8000/video.mp4",
        "http://10.1.2.3/video.mp4",
        "http://192.168.1.5/video.mp4",
        "http://169.254.169.254/latest/meta-data/",
        "https://user:pass@example.com/video.mp4",
        "https://example.com:8080/video.mp4",
        "http://[::1]/video.mp4",
        "https://printer.local/video.mp4",
        "https://metadata.google.internal/video.mp4",
    ],
)
def test_rejects_unsafe_urls(raw: str) -> None:
    with pytest.raises(URLValidationError):
        validate_public_url_shape(raw)


def test_fragment_is_removed() -> None:
    assert validate_public_url_shape("https://youtu.be/abc#t=30") == "https://youtu.be/abc"


def test_public_ipv4_literal_is_allowed() -> None:
    assert validate_public_url_shape("https://8.8.8.8/video.mp4") == "https://8.8.8.8/video.mp4"


def test_empty_url_is_rejected() -> None:
    with pytest.raises(URLValidationError, match="Paste a video link"):
        normalize_url("   ")
