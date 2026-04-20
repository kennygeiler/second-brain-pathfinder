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


def test_graph_proposed_queue_normalizes_edge_keys_for_dashboard(
    _isolated_vault: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Staged sync JSON uses source_id/relationship; GET /graph must expose source/type."""
    proposed = _isolated_vault / "proposed"
    proposed.mkdir(parents=True, exist_ok=True)
    (proposed / "sync-test.json").write_text(
        """{
  "nodes": [
    {"kind": "node", "id": "n1", "name": "A", "type": "Person", "influence": 0.5, "sentiment": 0.5}
  ],
  "edges": [
    {
      "kind": "edge",
      "source_id": "n1",
      "target_id": "n2",
      "target_name": "B",
      "relationship": "MEMBER_OF"
    }
  ]
}
""",
        encoding="utf-8",
    )

    def _no_neo4j(*_a: object, **_k: object) -> None:
        raise RuntimeError("neo4j unavailable in test")

    monkeypatch.setattr(neo4j.GraphDatabase, "driver", _no_neo4j)

    r = client.get("/graph")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["source"].startswith("proposed:")
    assert len(data["edges"]) == 1
    e = data["edges"][0]
    assert e["source"] == "n1"
    assert e["target"] == "n2"
    assert e["type"] == "MEMBER_OF"
