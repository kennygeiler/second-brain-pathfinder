"""GET /today aggregation."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from services.api import vault
from services.api.config import settings
from services.api.main import app

client = TestClient(app)


def test_today_empty_vault(_isolated_vault: Path) -> None:
    r = client.get("/today")
    assert r.status_code == 200
    data = r.json()
    assert data["stale_days"] == 30
    assert data["conflicts"] == []
    assert data["at_risk"] == []
    assert data["stale"] == []
    assert data["ghost_nodes"] == []
    assert data["open_tasks"] == []
    assert data["last_red_team_at"] is None


def test_today_red_team_snapshot_and_stale(_isolated_vault: Path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "stale_days", 7)

    note = vault.create_stakeholder_note(
        name="Stale Person",
        entity_type="Person",
        source_lineage_entry={
            "type": "voice_ledger",
            "id": "old",
            "timestamp": "2020-01-01T00:00:00+00:00",
        },
        influence_score=0.5,
        sentiment_vector=0.5,
    )
    # Force last_updated old for staleness (patch uses last_contact from lineage)
    note.data["last_updated"] = "2020-06-01T00:00:00+00:00"
    vault.save_note(note)

    state_dir = _isolated_vault / ".state"
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "last_red_team.json").write_text(
        json.dumps(
            {
                "run_at": "2026-04-19T12:00:00+00:00",
                "plan_path": "action_plans/Pathfinder-Action-Plan-2026-04-19.md",
                "hotspots": [
                    {
                        "id": note.id,
                        "name": "Hot",
                        "influence": 0.9,
                        "usage": 0.05,
                        "sentiment": 0.6,
                        "system_name": "GIS",
                        "reason": "high influence, low telemetry",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    r = client.get("/today")
    assert r.status_code == 200
    data = r.json()
    assert data["stale_days"] == 7
    assert len(data["at_risk"]) == 1
    assert data["at_risk"][0]["name"] == "Hot"
    assert len(data["stale"]) >= 1
    assert any(s["name"] == "Stale Person" for s in data["stale"])
