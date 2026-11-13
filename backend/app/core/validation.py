"""URL normalization and SSRF protection for user-submitted links."""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from urllib.parse import urlsplit, urlunsplit

from app.core.errors import URLValidationError

_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)
_DOMAIN_RE = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#].*)?$",
    re.IGNORECASE,
)
_BLOCKED_HOSTS = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata",
    "metadata.google.internal",
    "metadata.google.com",
}
_BLOCKED_SUFFIXES = (
    ".local",
    ".internal",
    ".localdomain",
    ".lan",
    ".home",
    ".arpa",
    ".onion",
)
_BLOCKED_PORTS = {0}


def normalize_url(raw: str) -> str:
    """Normalize obvious shorthand such as ``youtu.be/abc`` into a URL."""

    value = raw.strip()
    if not value:
        raise URLValidationError("Paste a video link to get started.")
    if any(ord(char) < 32 for char in value):
        raise URLValidationError("The link contains invalid control characters.")
    if len(value) > 4096:
        raise URLValidationError("That link is too long.")
    if not _SCHEME_RE.match(value):
        if _DOMAIN_RE.match(value):
            value = f"https://{value}"
        else:
            raise URLValidationError(
                "Enter a full link starting with http:// or https://, for example "
                "https://www.youtube.com/watch?v=…"
            )
    return value


def _is_public_ip(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return bool(
        ip.is_global
        and not ip.is_private
        and not ip.is_loopback
        and not ip.is_link_local
        and not ip.is_multicast
        and not ip.is_reserved
        and not ip.is_unspecified
    )


def validate_public_url_shape(raw: str) -> str:
    """Validate URL structure without requiring a DNS lookup."""

    value = normalize_url(raw)
    try:
        parts = urlsplit(value)
    except ValueError as exc:
        raise URLValidationError("That link could not be parsed.") from exc

    if parts.scheme.lower() not in {"http", "https"}:
        raise URLValidationError("Only http:// and https:// links are supported.")
    if parts.username or parts.password:
        raise URLValidationError("Links containing login credentials are not supported.")
    if not parts.hostname:
        raise URLValidationError("That link does not include a valid hostname.")

    hostname = parts.hostname.rstrip(".").lower()
    try:
        hostname = hostname.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise URLValidationError("That hostname is not valid.") from exc
    if len(hostname) > 253 or not hostname:
        raise URLValidationError("That hostname is not valid.")
    if hostname in _BLOCKED_HOSTS or hostname.endswith(_BLOCKED_SUFFIXES):
        raise URLValidationError("Local and private network links are not supported.")

    try:
        port = parts.port
    except ValueError as exc:
        raise URLValidationError("That link includes an invalid port.") from exc
    effective_port = port if port is not None else (443 if parts.scheme == "https" else 80)
    if effective_port in _BLOCKED_PORTS or not 1 <= effective_port <= 65535:
        raise URLValidationError("That link includes an invalid port.")
    if port is not None and port not in {80, 443}:
        raise URLValidationError("Only standard web ports (80 and 443) are supported.")

    is_ip_literal = False
    try:
        ipaddress.ip_address(hostname)
        is_ip_literal = True
    except ValueError:
        pass
    if is_ip_literal and not _is_public_ip(hostname):
        raise URLValidationError("Local and private network links are not supported.")
    if not is_ip_literal and "." not in hostname:
        raise URLValidationError("Enter a public video URL with a valid domain name.")

    # Rebuild without credentials or fragments; fragments never reach a server.
    normalized = urlunsplit(
        (
            parts.scheme.lower(),
            parts.netloc.rsplit("@", 1)[-1],
            parts.path or "/",
            parts.query,
            "",
        )
    )
    return normalized


def _public_addresses(hostname: str, port: int) -> set[str]:
    try:
        results = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, OSError) as exc:
        raise URLValidationError(
            "We could not resolve that hostname. Check the link and your connection."
        ) from exc
    addresses = {entry[4][0] for entry in results if entry[4]}
    if not addresses or any(not _is_public_ip(address) for address in addresses):
        raise URLValidationError("Local and private network links are not supported.")
    return addresses


async def validate_remote_url(raw: str, *, timeout: float = 6.0) -> str:
    """Validate the URL shape and ensure every DNS answer is publicly routable."""

    value = validate_public_url_shape(raw)
    parts = urlsplit(value)
    hostname = parts.hostname
    assert hostname is not None
    if _is_ip_literal(hostname):
        return value

    loop = asyncio.get_running_loop()
    try:
        async with asyncio.timeout(timeout):
            results = await loop.getaddrinfo(
                hostname,
                parts.port or (443 if parts.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
    except (TimeoutError, socket.gaierror, OSError) as exc:
        raise URLValidationError(
            "We could not resolve that hostname. Check the link and your connection."
        ) from exc

    addresses = {entry[4][0] for entry in results if entry[4]}
    if not addresses or any(not _is_public_ip(address) for address in addresses):
        raise URLValidationError("Local and private network links are not supported.")
    return value


def validate_remote_url_sync(raw: str) -> str:
    """Synchronous variant for probing redirect targets off the event loop."""

    value = validate_public_url_shape(raw)
    parts = urlsplit(value)
    hostname = parts.hostname
    assert hostname is not None
    if _is_ip_literal(hostname):
        return value
    _public_addresses(hostname, parts.port or (443 if parts.scheme == "https" else 80))
    return value


def _is_ip_literal(hostname: str) -> bool:
    try:
        ipaddress.ip_address(hostname)
        return True
    except ValueError:
        return False


def is_probably_direct_media(value: str) -> bool:
    """Best-effort hint used only for friendlier metadata fallbacks."""

    parts = urlsplit(value)
    return parts.path.lower().endswith((".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".m3u8"))
