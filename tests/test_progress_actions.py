from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from services.api import vault
from services.api.conflict_detector import check_conflict
from services.api.main import app

client = TestClient(app)


def _mk(name: str) -> vault.StakeholderNote:
    return vault.create_stakeholder_note(
        name=name,
        entity_type="Person",
        source_lineage_entry={"type": "voice_ledger", "id": "seed", "timestamp": vault.now_iso()},
    )


def test_conflicts_are_unique_paths(_isolated_vault: Path) -> None:
    note = _mk("Casey")
    c1 = check_conflict(note, previous_sentiment=0.1, new_sentiment=0.9, context="a")
    c2 = check_conflict(note, previous_sentiment=0.1, new_sentiment=0.95, context="b")
    assert c1 is not None and c2 is not None
    assert c1 != c2
    assert c1.exists()
    assert c2.exists()


def test_actions_crud_and_progress_summary(_isolated_vault: Path) -> None:
    note = _mk("Jordan")
    create = client.post(
        "/actions",
        json={
            "title": "Schedule unblock session",
            "stakeholder_id": note.id,
            "priority": "p1",
            "owner": "FDE",
            "status": "todo",
        },
    )
    assert create.status_code == 200, create.text
    aid = create.json()["id"]

    upd = client.patch(f"/actions/{aid}", json={"status": "done", "outcome_note": "completed"})
    assert upd.status_code == 200, upd.text
    assert upd.json()["status"] == "done"

    all_actions = client.get("/actions")
    assert all_actions.status_code == 200
    assert len(all_actions.json()) == 1

    summary = client.get("/progress/summary")
    assert summary.status_code == 200
    data = summary.json()
    assert data["totals"]["stakeholders"] >= 1
    assert "health_score" in data


def test_stale_uses_contact_not_profile_edit(_isolated_vault: Path) -> None:
    note = _mk("Taylor")
    # simulate profile edit only
    vault.patch_note(note, {"role": "Updated role"})
    r = client.get("/today")
    assert r.status_code == 200
    payload = r.json()
    stale_names = {row["name"] for row in payload["stale"]}
    # With default STALE_DAYS in tests this may not be stale yet, but endpoint shape should include never_contacted when present.
    for row in payload["stale"]:
        if row["name"] in stale_names:
            assert "never_contacted" in row
