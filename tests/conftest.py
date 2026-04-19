"""Pytest fixtures: isolate every test behind a throw-away vault dir.

The production code reads `settings.vault_path` at call time, so mutating the
singleton between tests is enough — no env reloading or reimporting needed.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from services.api.config import settings


@pytest.fixture(autouse=True)
def _isolated_vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Route every read/write through `tmp_path/vault` for the duration of one test."""
    vault_dir = tmp_path / "vault"
    vault_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(settings, "vault_path", vault_dir)
    # Force the deterministic heuristic path so tests don't call the live LLM.
    monkeypatch.setattr(settings, "openai_api_key", "")
    monkeypatch.setattr(settings, "auto_commit", False)

    return vault_dir
