"""Shared caption font catalog and safe font-file lookup."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

_CATALOG_PATH = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "fonts.json"


@dataclass(frozen=True, slots=True)
class CaptionFontSpec:
    name: str
    category: str
    scripts: tuple[str, ...]
    fallback: str
    files: Mapping[str, str]

    @property
    def css_family(self) -> str:
        return f"'{self.name}', {self.fallback}"


def _load_catalog() -> tuple[CaptionFontSpec, ...]:
    try:
        raw = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ()
    specs: list[CaptionFontSpec] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        files = item.get("files")
        specs.append(
            CaptionFontSpec(
                name=name,
                category=str(item.get("category", "System")),
                scripts=tuple(str(script) for script in item.get("scripts", ["latin"])),
                fallback=str(item.get("fallback", "sans-serif")),
                files=MappingProxyType(
                    {
                        str(style): str(filename)
                        for style, filename in (files.items() if isinstance(files, dict) else ())
                        if isinstance(filename, str) and Path(filename).name == filename
                    }
                ),
            )
        )
    return tuple(specs)


CAPTION_FONT_SPECS = _load_catalog()
FONT_BY_NAME: dict[str, CaptionFontSpec] = {spec.name: spec for spec in CAPTION_FONT_SPECS}
CAPTION_FONT_NAMES: tuple[str, ...] = tuple(spec.name for spec in CAPTION_FONT_SPECS)
CAPTION_FONT_FILES: frozenset[str] = frozenset(
    filename for spec in CAPTION_FONT_SPECS for filename in spec.files.values()
)
CAPTION_FONT_STYLES: tuple[str, ...] = ("regular", "bold", "italic", "bold_italic")


def is_valid_font(name: str) -> bool:
    return name in FONT_BY_NAME


def font_spec(name: str) -> CaptionFontSpec | None:
    return FONT_BY_NAME.get(name)


def available_styles(name: str) -> tuple[str, ...]:
    spec = FONT_BY_NAME.get(name)
    if not spec:
        return ()
    styles = [style for style in CAPTION_FONT_STYLES if style in spec.files]
    # Browsers/fontconfig can synthesize bold and italic from a regular face.
    if spec.files.get("regular"):
        return CAPTION_FONT_STYLES
    return tuple(styles)


def safe_font_file(filename: str) -> Path | None:
    if filename not in CAPTION_FONT_FILES:
        return None
    path = (_CATALOG_PATH.parent / filename).resolve()
    try:
        path.relative_to(_CATALOG_PATH.parent.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def catalog_for_client() -> list[dict[str, object]]:
    return [
        {
            "name": spec.name,
            "category": spec.category,
            "scripts": list(spec.scripts),
            "fallback": spec.fallback,
            "files": dict(spec.files),
        }
        for spec in CAPTION_FONT_SPECS
    ]
