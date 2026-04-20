"""Day-4 tests: PATCH / PUT notes / DELETE (archive) / POST merge.

These exercise the vault helpers + the FastAPI endpoints end-to-end via
TestClient, against the isolated temp vault from conftest.
"""
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from services.api import vault
from services.api.main import app

client = TestClient(app)


def _make(name: str, *, influence: float = 0.5, sentiment: float = 0.5, blockers=None) -> vault.StakeholderNote:
    return vault.create_stakeholder_note(
        name=name,
        entity_type="Person",
        source_lineage_entry={"type": "voice_ledger", "id": "seed", "timestamp": vault.now_iso()},
        influence_score=influence,
        sentiment_vector=sentiment,
    )


def test_patch_updates_whitelisted_fields(_isolated_vault: Path) -> None:
    note = _make("Alice Architect")

    r = client.patch(
        f"/stakeholders/{note.id}",
        json={"type": "Gatekeeper", "influence_score": 0.9, "technical_blockers": ["GIS"]},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["metadata"]["type"] == "Gatekeeper"
    assert data["metadata"]["influence_score"] == 0.9
    assert data["metadata"]["technical_blockers"] == ["GIS"]

    # Reload from disk to confirm persistence.
    reloaded = vault.find_by_id(note.id)
    assert reloaded is not None
    assert reloaded.data["type"] == "Gatekeeper"


def test_patch_rejects_out_of_range(_isolated_vault: Path) -> None:
    note = _make("Bob")
    r = client.patch(f"/stakeholders/{note.id}", json={"influence_score": 1.5})
    assert r.status_code == 422


def test_patch_ignores_unknown_field(_isolated_vault: Path) -> None:
    # Unknown fields are dropped by Pydantic. Empty patch body after the drop
    # should return 400 rather than silently no-op.
    note = _make("Carol")
    r = client.patch(f"/stakeholders/{note.id}", json={"id": "bogus", "random": 1})
    assert r.status_code == 400


def test_put_notes_replaces_body(_isolated_vault: Path) -> None:
    note = _make("Diana")
    r = client.put(f"/stakeholders/{note.id}/notes", json={"content": "Prefers Signal over email."})
    assert r.status_code == 200
    assert r.json()["content"].strip() == "Prefers Signal over email."

    reloaded = vault.find_by_id(note.id)
    assert reloaded is not None
    assert "Prefers Signal" in reloaded.post.content


def test_archive_moves_to_archive_dir(_isolated_vault: Path) -> None:
    note = _make("Ephemeral")
    original_path = note.path
    r = client.delete(f"/stakeholders/{note.id}")
    assert r.status_code == 200
    archived_to = r.json()["archived_to"]
    assert archived_to.startswith("archive/")
    assert not original_path.exists()
    assert (_isolated_vault / archived_to).exists()
    # Archived notes should no longer appear in the stakeholders list.
    assert not any(n.id == note.id for n in vault.iter_stakeholder_notes())


def test_merge_combines_blockers_and_archives_source(_isolated_vault: Path) -> None:
    target = _make("Jane Commissioner", influence=0.9)
    target = vault.patch_note(target, {"technical_blockers": ["legacy_gis"]})

    source = _make("Jane")
    source = vault.patch_note(source, {"technical_blockers": ["budget_freeze"]})

    r = client.post(f"/stakeholders/{source.id}/merge", json={"target_id": target.id})
    assert r.status_code == 200, r.text
    merged = r.json()

    assert merged["id"] == target.id
    blockers = merged["metadata"]["technical_blockers"]
    assert "legacy_gis" in blockers and "budget_freeze" in blockers
    # Target's lineage grew to include source + the merge event itself.
    lineage_types = [e.get("type") for e in merged["metadata"]["source_lineage"]]
    assert "merge" in lineage_types

    # Source is gone from the live list, present in archive.
    assert vault.find_by_id(source.id) is None
    archive_dir = _isolated_vault / "archive"
    assert archive_dir.exists()
    assert any(archive_dir.iterdir())


def test_merge_refuses_self_merge(_isolated_vault: Path) -> None:
    note = _make("Solo")
    r = client.post(f"/stakeholders/{note.id}/merge", json={"target_id": note.id})
    assert r.status_code == 400


def test_merge_404_on_missing_target(_isolated_vault: Path) -> None:
    note = _make("Lonely")
    r = client.post(f"/stakeholders/{note.id}/merge", json={"target_id": "does-not-exist"})
    assert r.status_code == 404
