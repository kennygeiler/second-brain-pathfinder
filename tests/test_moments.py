"""GET /moments aggregation."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from services.api import vault
from services.api.main import app

client = TestClient(app)


def test_moments_empty_vault(_isolated_vault: Path) -> None:
    r = client.get("/moments?year=2026")
    assert r.status_code == 200
    data = r.json()
    assert data["year"] == 2026
    assert data["moments"] == []
    assert len(data["legend"]) >= 1


def test_moments_lineage_and_red_team(_isolated_vault: Path) -> None:
    note = vault.create_stakeholder_note(
        name="Active Person",
        entity_type="Person",
        source_lineage_entry={
            "type": "voice_ledger",
            "id": "cap-1",
            "timestamp": "2026-06-15T14:00:00+00:00",
            "note": "Called about bridge funding",
        },
        influence_score=0.5,
        sentiment_vector=0.5,
    )
    vault.save_note(note)

    state_dir = _isolated_vault / ".state"
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "last_red_team.json").write_text(
        json.dumps(
            {
                "run_at": "2026-06-20T10:00:00+00:00",
                "plan_path": "action_plans/Plan.md",
                "hotspots": [],
            }
        ),
        encoding="utf-8",
    )

    r = client.get("/moments?year=2026")
    assert r.status_code == 200
    data = r.json()
    kinds = {m["kind"] for m in data["moments"]}
    assert "voice_ledger" in kinds
    assert "red_team" in kinds
    assert any(m["stakeholder_name"] == "Active Person" for m in data["moments"])


def test_moments_wrong_year_excludes_lineage(_isolated_vault: Path) -> None:
    vault.create_stakeholder_note(
        name="Old",
        entity_type="Person",
        source_lineage_entry={
            "type": "email",
            "id": "e1",
            "timestamp": "2024-01-01T00:00:00+00:00",
            "note": "old",
        },
        influence_score=0.5,
        sentiment_vector=0.5,
    )
    r = client.get("/moments?year=2026")
    assert r.status_code == 200
    assert r.json()["moments"] == []
