from __future__ import annotations

import os
from pathlib import Path

import pytest

os.environ.setdefault("CUTCLIPPER_LOG_JSON", "false")
os.environ.setdefault("CUTCLIPPER_LOG_LEVEL", "WARNING")


@pytest.fixture(scope="session")
def asset_dir() -> Path:
    return Path(__file__).parent / "assets"
