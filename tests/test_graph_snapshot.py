"""GET /graph proposed-queue resilience."""
from __future__ import annotations

from pathlib import Path

import neo4j
import pytest
from fastapi.testclient import TestClient

from services.api.main import app

client = TestClient(app)


def test_graph_returns_empty_when_latest_proposed_json_is_invalid(
    _isolated_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    proposed = _isolated_vault / "proposed"
    proposed.mkdir(parents=True, exist_ok=True)
    (proposed / "sync-Z-corrupt.json").write_text("{not-valid-json", encoding="utf-8")

    def _no_neo4j(*_a: object, **_k: object) -> None:
        raise RuntimeError("neo4j unavailable in test")

    monkeypatch.setattr(neo4j.GraphDatabase, "driver", _no_neo4j)

    r = client.get("/graph")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["source"] == "empty"
    assert data["nodes"] == []
    assert data["edges"] == []
