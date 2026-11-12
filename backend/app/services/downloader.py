"""yt-dlp integration for metadata and video downloads."""

from __future__ import annotations

import asyncio
import base64
import importlib.metadata
import json
import logging
import re
import shlex
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Event
from typing import Any
from urllib.parse import unquote, urljoin, urlsplit

import httpx

from app.config import Settings
from app.core.errors import (
    JobCancelledError,
    MediaFetchError,
    ProcessingError,
    URLValidationError,
)
from app.core.validation import validate_remote_url
from app.schemas import VideoMetadata
from app.services.media import get_media_tools, probe_media_sync
from app.services.process import run_process

logger = logging.getLogger(__name__)

_PROGRESS_RE = re.compile(r"\[download\]\s+(\d{1,3}(?:\.\d+)?)%")

_DIRECT_VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi"}

_PRIVATE_MARKERS = (
    "private video",
    "this video is private",
    "video is unavailable",
    "this video is unavailable",
    "removed by the uploader",
    "account has been terminated",
)
_AUTH_MARKERS = (
    "sign in to confirm",
    "log in to confirm",
    "login required",
    "use --cookies",
    "cookies-from-browser",
    "age-restricted",
    "age restricted",
)
_GEO_MARKERS = ("not available in your country", "geo restricted", "geo-restricted")
_UNSUPPORTED_MARKERS = ("unsupported url", "no suitable extractor", "no video formats found")


@dataclass(slots=True)
class DownloadResult:
    path: Path
    title: str


def _base_command(settings: Settings) -> list[str]:
    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--no-warnings",
        "--no-playlist",
        "--socket-timeout",
        "20",
    ]
    if shutil.which("node"):
        command.extend(["--js-runtimes", "node"])
    if settings.ytdlp_cookies_file:
        command.extend(["--cookies", settings.ytdlp_cookies_file])
    if settings.ytdlp_extra_args:
        command.extend(shlex.split(settings.ytdlp_extra_args))
    return command


def _classify_error(stderr: str, *, action: str) -> MediaFetchError:
    message = (stderr or "").lower()
    if any(marker in message for marker in _PRIVATE_MARKERS):
        return MediaFetchError(
            "This video is private or has been removed. Try a public link.",
            code="video_private",
            retryable=False,
        )
    if any(marker in message for marker in _AUTH_MARKERS):
        return MediaFetchError(
            "This video requires sign-in or age verification, so CutClipper can't download it.",
            code="auth_required",
            retryable=False,
        )
    if any(marker in message for marker in _GEO_MARKERS):
        return MediaFetchError(
            "This video is region-locked and isn't available from this server.",
            code="region_locked",
            retryable=False,
        )
    if any(marker in message for marker in _UNSUPPORTED_MARKERS):
        return MediaFetchError(
            "That link isn't a supported video source.",
            code="unsupported_url",
            retryable=False,
        )
    if any(
        marker in message
        for marker in (
            "http error 404",
            "http error 410",
            "not found",
            "video unavailable",
            "has been removed",
        )
    ):
        return MediaFetchError(
            "The link is unavailable or has expired. Check that it still opens in a browser.",
            code="link_expired",
            retryable=False,
        )
    if "max-filesize" in message or "file is larger than" in message:
        return MediaFetchError(
            "That video is larger than the configured download limit.",
            code="file_too_large",
            retryable=False,
        )
    if any(
        marker in message
        for marker in (
            "timed out",
            "timeout",
            "temporary failure",
            "connection reset",
            "connection refused",
            "network is unreachable",
            "urlopen error",
            "http error 5",
            "http error 429",
            "too many requests",
            "fragment",
        )
    ):
        return MediaFetchError(
            f"A network error interrupted {action}. The link may still work — try again.",
            code="network_error",
            retryable=True,
        )
    return MediaFetchError(
        f"CutClipper could not {action}. Check that the link is public and still available.",
        code="fetch_failed",
        retryable=True,
        details={"stderr": stderr.strip()[-1200:]},
    )


def _pick_thumbnail(info: dict[str, Any]) -> str | None:
    candidates: list[dict[str, Any]] = []
    if isinstance(info.get("thumbnails"), list):
        candidates.extend(item for item in info["thumbnails"] if isinstance(item, dict))
    direct = info.get("thumbnail")
    if direct:
        candidates.append({"url": direct, "width": info.get("thumbnail_width") or 0})
    for candidate in reversed(candidates):
        url = candidate.get("url")
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            return url
    return None


def _fallback_title(url: str) -> str:
    name = Path(urlsplit(url).path).stem.replace("_", " ").replace("-", " ").strip()
    return name.title() if name else "Untitled video"


def _metadata_from_info(
    info: dict[str, Any],
    *,
    normalized_url: str,
    settings: Settings,
) -> VideoMetadata:
    if info.get("_type") in {"playlist", "multi_video"} and info.get("entries"):
        entries = [entry for entry in info.get("entries") or [] if isinstance(entry, dict)]
        if not entries:
            raise MediaFetchError("That playlist does not contain a video.", retryable=False)
        info = entries[0]
    live_status = info.get("live_status")
    if info.get("is_live") or live_status in {"is_live", "is_upcoming"}:
        raise MediaFetchError(
            "Live streams aren't supported. Try a finished video or VOD.",
            code="live_stream",
            retryable=False,
        )

    raw_duration = info.get("duration")
    try:
        duration = float(raw_duration) if raw_duration is not None else 0.0
    except (TypeError, ValueError):
        duration = 0.0

    width = _as_int(info.get("width"))
    height = _as_int(info.get("height"))
    fps = _as_float(info.get("fps"))
    has_audio = None
    if info.get("acodec"):
        has_audio = info.get("acodec") != "none"

    if duration <= 0:
        try:
            media_info = probe_media_sync(normalized_url, timeout=45)
            duration = media_info.duration
            width = width or media_info.width
            height = height or media_info.height
            fps = fps or media_info.fps
            has_audio = media_info.has_audio if has_audio is None else has_audio
        except Exception as exc:
            logger.info("duration probe fallback failed", extra={"error": str(exc)})
            raise MediaFetchError(
                "The video duration could not be determined. It may be a live stream "
                "or an unsupported format.",
                retryable=False,
            ) from exc

    if duration > settings.max_video_duration_seconds:
        maximum_hours = settings.max_video_duration_seconds / 3600
        raise MediaFetchError(
            f"This video is {duration / 60:.0f} minutes long. CutClipper supports videos up "
            f"to {maximum_hours:g} hours.",
            code="video_too_long",
            retryable=False,
        )

    return VideoMetadata(
        title=str(info.get("title") or _fallback_title(normalized_url))[:500],
        duration=round(duration, 3),
        thumbnail_url=_pick_thumbnail(info),
        uploader=info.get("uploader") or info.get("channel"),
        source=info.get("extractor_key") or info.get("extractor"),
        source_url=normalized_url,
        webpage_url=info.get("webpage_url") or normalized_url,
        width=width,
        height=height,
        fps=round(fps, 3) if fps else None,
        has_audio=has_audio,
    )


def _as_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _as_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


async def _capture_remote_thumbnail(url: str, settings: Settings) -> str | None:
    """Extract a poster as a small data URI for direct video links with no artwork."""

    try:
        tools = get_media_tools(settings)
    except ProcessingError:
        return None
    with tempfile.TemporaryDirectory(prefix="cutclipper-thumb-") as directory:
        target = Path(directory) / "preview.jpg"
        command = [
            tools.ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            "1",
            "-max_redirects",
            "0",
            "-i",
            url,
            "-frames:v",
            "1",
            "-vf",
            "scale=640:-2",
            "-q:v",
            "4",
            str(target),
        ]
        try:
            result = await run_process(command, timeout_seconds=45)
        except Exception:
            return None
        if result.returncode != 0 or not target.exists():
            return None
        try:
            raw = target.read_bytes()
        except OSError:
            return None
        if not raw or len(raw) > 250_000:
            return None
        return f"data:image/jpeg;base64,{base64.b64encode(raw).decode('ascii')}"


def _direct_video_suffix(url: str) -> str | None:
    suffix = Path(unquote(urlsplit(url).path)).suffix.lower()
    return suffix if suffix in _DIRECT_VIDEO_EXTENSIONS else None


def _direct_title(url: str) -> str:
    path = unquote(urlsplit(url).path)
    stem = Path(path).stem.replace("_", " ").replace("-", " ").strip()
    title = " ".join(stem.split())
    return title.title()[:500] if title else "Direct video"


async def _direct_metadata(url: str, settings: Settings) -> VideoMetadata | None:
    """Try direct HTTP probing before falling back to a site extractor."""

    try:
        media = await asyncio.to_thread(probe_media_sync, url, timeout=30, max_redirects=0)
    except Exception as exc:
        logger.info("direct media probe failed; trying yt-dlp", extra={"error": str(exc)})
        return None
    if media.duration > settings.max_video_duration_seconds:
        maximum_hours = settings.max_video_duration_seconds / 3600
        raise MediaFetchError(
            f"This video is {media.duration / 60:.0f} minutes long. CutClipper supports "
            f"videos up to {maximum_hours:g} hours.",
            code="video_too_long",
            retryable=False,
        )
    thumbnail = await _capture_remote_thumbnail(url, settings)
    return VideoMetadata(
        title=_direct_title(url),
        duration=round(media.duration, 3),
        thumbnail_url=thumbnail,
        uploader=None,
        source="Direct video",
        source_url=url,
        webpage_url=url,
        width=media.width,
        height=media.height,
        fps=round(media.fps, 3),
        has_audio=media.has_audio,
    )


async def _download_direct_http(
    url: str,
    destination: Path,
    settings: Settings,
    *,
    cancel_event: Event,
    on_progress: Any,
) -> DownloadResult:
    suffix = _direct_video_suffix(url) or ".mp4"
    target = destination / f"source{suffix}"
    part = destination / f"source{suffix}.part"
    # Use the HTTP client's honest default User-Agent. Cloudflare and similar
    # fronts challenge spoofed browser identities when the TLS fingerprint does
    # not match, and that failure is worse than looking like a download client.
    headers = {"Accept": "video/*,application/octet-stream;q=0.9,*/*;q=0.5"}
    last_error: MediaFetchError | None = None

    for attempt in range(2):
        if cancel_event.is_set():
            raise JobCancelledError()
        if part.exists():
            part.unlink(missing_ok=True)
        downloaded = 0
        total_size: int | None = None
        current_url = url
        on_progress(0.02, "Connecting to direct video host")
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(60.0, connect=20.0),
                follow_redirects=False,
            ) as client:
                response = None
                for _ in range(6):
                    request = client.build_request("GET", current_url, headers=headers)
                    response = await client.send(request, stream=True)
                    if response.is_redirect:
                        location = response.headers.get("location")
                        await response.aclose()
                        if not location:
                            raise MediaFetchError(
                                "The direct video link redirected unexpectedly.",
                                retryable=False,
                            )
                        current_url = urljoin(current_url, location)
                        await validate_remote_url(current_url)
                        continue
                    break
                else:
                    raise MediaFetchError(
                        "The direct video link redirected too many times.",
                        retryable=False,
                    )

                assert response is not None
                if response.status_code >= 400:
                    await response.aclose()
                    if response.status_code in {401, 403}:
                        raise MediaFetchError(
                            "The direct video host refused the download. It may require "
                            "signed access or block automated requests.",
                            code="direct_forbidden",
                            retryable=False,
                        )
                    if response.status_code in {404, 410}:
                        raise MediaFetchError(
                            "The direct video link is unavailable or has expired.",
                            code="link_expired",
                            retryable=False,
                        )
                    raise MediaFetchError(
                        "The direct video host returned an error. Try again.",
                        code="network_error",
                        retryable=response.status_code >= 500 or response.status_code == 429,
                    )

                content_type = (response.headers.get("content-type") or "").lower()
                if content_type.startswith(("text/html", "application/json")):
                    await response.aclose()
                    raise MediaFetchError(
                        "That link returns a web page, not a direct video file.",
                        code="not_direct_media",
                        retryable=False,
                    )
                try:
                    advertised = int(response.headers.get("content-length", "0"))
                except ValueError:
                    advertised = 0
                total_size = advertised or None
                if total_size and total_size > settings.max_download_bytes:
                    await response.aclose()
                    raise MediaFetchError(
                        "That video is larger than the configured download limit.",
                        code="file_too_large",
                        retryable=False,
                    )

                with part.open("wb") as handle:
                    async for chunk in response.aiter_bytes(262_144):
                        if cancel_event.is_set():
                            raise JobCancelledError()
                        if not chunk:
                            continue
                        downloaded += len(chunk)
                        if downloaded > settings.max_download_bytes:
                            raise MediaFetchError(
                                "That video is larger than the configured download limit.",
                                code="file_too_large",
                                retryable=False,
                            )
                        if time.monotonic() - started > settings.download_timeout_seconds:
                            raise MediaFetchError(
                                "The download took too long. Try a shorter video.",
                                code="download_timeout",
                                retryable=True,
                            )
                        handle.write(chunk)
                        if total_size:
                            fraction = min(0.98, downloaded / total_size)
                            on_progress(fraction, f"Downloading video · {fraction * 100:.0f}%")
                await response.aclose()

            if downloaded <= 0:
                raise MediaFetchError(
                    "The direct video download was empty.", code="download_failed"
                )
            part.replace(target)
            on_progress(1.0, "Video downloaded")
            return DownloadResult(path=target, title=_direct_title(url))
        except JobCancelledError:
            part.unlink(missing_ok=True)
            raise
        except httpx.HTTPError as exc:
            part.unlink(missing_ok=True)
            last_error = MediaFetchError(
                "A network error interrupted the direct download.",
                code="network_error",
                retryable=True,
                details={"error": str(exc)},
            )
        except OSError as exc:
            part.unlink(missing_ok=True)
            last_error = MediaFetchError(
                "The direct video could not be saved.",
                code="download_failed",
                retryable=False,
                details={"error": str(exc)},
            )
        if last_error and not last_error.retryable:
            raise last_error
        if attempt == 0:
            on_progress(0.02, "Direct download interrupted · retrying")
            await asyncio.sleep(1.5)

    raise last_error or MediaFetchError("The direct video download failed.")


async def fetch_metadata(url: str, settings: Settings) -> VideoMetadata:
    """Resolve a URL with yt-dlp and return presentation metadata."""

    if _direct_video_suffix(url):
        direct = await _direct_metadata(url, settings)
        if direct is not None:
            return direct

    command = [
        *_base_command(settings),
        "--dump-single-json",
        "--skip-download",
        "--retries",
        "2",
        "--fragment-retries",
        "2",
        url,
    ]
    last_error: MediaFetchError | None = None
    for attempt in range(3):
        try:
            result = await run_process(
                command,
                timeout_seconds=settings.preview_timeout_seconds,
            )
        except ProcessingError as exc:
            raise MediaFetchError(
                "The preview took too long. Try again or choose a shorter video.",
                code="preview_timeout",
                retryable=True,
                details={"error": str(exc)},
            ) from exc

        if result.returncode == 0:
            try:
                start = result.stdout.find("{")
                payload = json.loads(result.stdout[start:] if start >= 0 else result.stdout)
            except json.JSONDecodeError as exc:
                raise MediaFetchError(
                    "The video site returned an unexpected response.",
                    code="invalid_response",
                    retryable=True,
                ) from exc
            metadata = _metadata_from_info(payload, normalized_url=url, settings=settings)
            if not metadata.thumbnail_url:
                generated = await _capture_remote_thumbnail(url, settings)
                if generated:
                    metadata = metadata.model_copy(update={"thumbnail_url": generated})
            return metadata

        last_error = _classify_error(result.stderr, action="fetch the video details")
        if not last_error.retryable or attempt == 2:
            raise last_error
        delay = 1.5 * (attempt + 1)
        logger.warning("metadata fetch retry", extra={"attempt": attempt + 1, "delay": delay})
        await asyncio.sleep(delay)
    raise last_error or MediaFetchError("The video details could not be fetched.")


async def _download_with_ytdlp(
    url: str,
    destination: Path,
    settings: Settings,
    *,
    cancel_event: Event,
    on_progress: Any,
) -> DownloadResult:
    """Download via yt-dlp with retries and merge the best up-to-1080p streams."""

    format_selector = (
        "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/"
        "bv*[height<=1080][vcodec^=avc1]+ba/"
        "bv*[height<=1080]+ba/"
        "b[height<=1080]/b"
    )
    size_mb = max(1, settings.max_download_bytes // (1024 * 1024))
    command = [
        *_base_command(settings),
        "-f",
        format_selector,
        "--merge-output-format",
        "mp4",
        "--remux-video",
        "mp4",
        "--newline",
        "--progress",
        "--retries",
        "3",
        "--fragment-retries",
        "5",
        "--concurrent-fragments",
        "4",
        "--continue",
        "--max-filesize",
        f"{size_mb}M",
        "--no-write-info-json",
        "--no-write-thumbnail",
        "--restrict-filenames",
        "-o",
        "source.%(ext)s",
        url,
    ]
    last_error: MediaFetchError | None = None

    def handle_stderr(line: str) -> None:
        match = _PROGRESS_RE.search(line)
        if match:
            percent = min(float(match.group(1)) / 100.0, 0.98)
            on_progress(percent, f"Downloading video · {percent * 100:.0f}%")
        elif "[Merger]" in line or "[VideoRemuxer]" in line:
            on_progress(0.99, "Merging video and audio")

    for attempt in range(3):
        try:
            result = await run_process(
                command,
                cancel_event=cancel_event,
                timeout_seconds=settings.download_timeout_seconds,
                cwd=destination,
                on_stdout_line=handle_stderr,
                on_stderr_line=handle_stderr,
            )
        except JobCancelledError:
            raise
        except ProcessingError as exc:
            raise MediaFetchError(
                "The download took too long. Try a shorter video.",
                code="download_timeout",
                retryable=True,
                details={"error": str(exc)},
            ) from exc

        files = sorted(
            (
                path
                for path in destination.glob("source.*")
                if not path.name.endswith((".part", ".ytdl", ".json"))
            ),
            key=lambda path: path.stat().st_size,
            reverse=True,
        )
        if result.returncode == 0 and files:
            on_progress(1.0, "Video downloaded")
            return DownloadResult(path=files[0], title=files[0].stem)

        last_error = _classify_error(result.stderr, action="download the video")
        if not last_error.retryable or attempt == 2:
            raise last_error
        delay = 2.0 * (attempt + 1)
        logger.warning("download retry", extra={"attempt": attempt + 1, "delay": delay})
        on_progress(0.02, "Network hiccup · retrying download")
        await asyncio.sleep(delay)

    raise last_error or MediaFetchError("The video could not be downloaded.")


async def download_video(
    url: str,
    destination: Path,
    settings: Settings,
    *,
    cancel_event: Event,
    on_progress: Any,
) -> DownloadResult:
    """Download a video, preferring direct HTTP for direct media URLs."""

    destination.mkdir(parents=True, exist_ok=True)
    if _direct_video_suffix(url):
        try:
            return await _download_direct_http(
                url,
                destination,
                settings,
                cancel_event=cancel_event,
                on_progress=on_progress,
            )
        except JobCancelledError:
            raise
        except MediaFetchError as exc:
            logger.warning(
                "direct download failed; falling back to yt-dlp",
                extra={"error_code": exc.code, "retryable": exc.retryable},
            )
            on_progress(0.02, "Retrying with the site extractor")
    return await _download_with_ytdlp(
        url,
        destination,
        settings,
        cancel_event=cancel_event,
        on_progress=on_progress,
    )


def ytdlp_version() -> str:
    try:
        return importlib.metadata.version("yt-dlp")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def validate_cookies_path(settings: Settings) -> None:
    if settings.ytdlp_cookies_file and not Path(settings.ytdlp_cookies_file).is_file():
        raise URLValidationError(
            "The configured yt-dlp cookies file does not exist.",
            code="cookies_file_missing",
        )
