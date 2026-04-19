"""End-to-end smoke: ledger ingestion → conflict detection → vault→graph sync.

The heuristic extractor keys off positive/negative word lists in
`services/api/extraction.py`, so the sample transcriptions below are tuned
to produce deterministic sentiments (negative << 0.5, positive >> 0.5).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from services.api import obsidian_to_neo4j, vault
from services.api.ledger_processor import LedgerPayload, process_transcription


SAMPLE_BAD_MEETING = (
    "Jane Commissioner stalled the approval. "
    "The project is blocked and delayed. "
    "Mark Engineer is frustrated and the integration failed."
)

SAMPLE_GOOD_MEETING = (
    "Jane Commissioner approved the plan. "
    "The project is smooth, a great win. "
    "Mark Engineer is happy and the integration was a success."
)


def test_ledger_creates_stakeholder_note(_isolated_vault: Path) -> None:
    payload = LedgerPayload(
        transcription=SAMPLE_BAD_MEETING,
        source_id="meeting-smoke-1",
        meeting_id="m-smoke-001",
    )
    response = process_transcription(payload)

    assert response.files_touched, "ledger should write at least one .md file"
    assert any(
        "jane-commissioner" in Path(p).name.lower()
        for p in response.files_touched
    ), f"expected a Jane Commissioner note among {response.files_touched}"

    note = vault.find_by_name("Jane Commissioner")
    assert note is not None
    assert 0.0 <= note.data["sentiment_vector"] < 0.5, "negative meeting should push sentiment < 0.5"

    lineage = note.data.get("source_lineage") or []
    assert len(lineage) == 1
    assert lineage[0]["id"] == "meeting-smoke-1"
    assert lineage[0]["type"] == "voice_ledger"


def test_conflict_emitted_on_sentiment_delta(_isolated_vault: Path) -> None:
    process_transcription(
        LedgerPayload(transcription=SAMPLE_BAD_MEETING, source_id="neg-1")
    )
    response = process_transcription(
        LedgerPayload(transcription=SAMPLE_GOOD_MEETING, source_id="pos-1")
    )

    assert response.conflicts, "sentiment swing negative→positive should trigger a conflict"

    conflicts_dir = _isolated_vault / "conflicts"
    assert conflicts_dir.exists()
    markdown_files = list(conflicts_dir.glob("*.md"))
    assert markdown_files, "conflict markdown should land in vault/conflicts"

    body = markdown_files[0].read_text(encoding="utf-8")
    assert "Jane Commissioner" in body
    assert "Reconciliation question" in body


def test_sync_writes_proposed_queue(_isolated_vault: Path) -> None:
    process_transcription(
        LedgerPayload(transcription=SAMPLE_BAD_MEETING, source_id="sync-seed")
    )
    result = obsidian_to_neo4j.sync(auto_commit=False)

    assert result["committed"] is False
    assert result["node_count"] >= 1

    proposed = Path(result["proposed_path"])
    assert proposed.exists()
    assert proposed.parent.name == "proposed"


def test_conflict_within_threshold_is_skipped(_isolated_vault: Path) -> None:
    process_transcription(
        LedgerPayload(transcription=SAMPLE_BAD_MEETING, source_id="neg-1")
    )
    # Re-ingest the same transcription → delta is 0, so no conflict should fire.
    response = process_transcription(
        LedgerPayload(transcription=SAMPLE_BAD_MEETING, source_id="neg-2")
    )

    assert response.conflicts == []


@pytest.mark.parametrize(
    "bad_payload",
    [
        LedgerPayload(transcription="   ", source_id="empty"),
    ],
)
def test_empty_transcription_rejected(_isolated_vault: Path, bad_payload: LedgerPayload) -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        process_transcription(bad_payload)
    assert exc.value.status_code == 400


def test_bff_stakeholders_endpoint_serves_vault(_isolated_vault: Path) -> None:
    from fastapi.testclient import TestClient

    from services.api.main import app

    process_transcription(
        LedgerPayload(transcription=SAMPLE_BAD_MEETING, source_id="bff-1")
    )

    client = TestClient(app)

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    stakeholders = client.get("/stakeholders")
    assert stakeholders.status_code == 200
    payload = stakeholders.json()
    assert isinstance(payload, list)
    names = [item.get("name", "") for item in payload]
    assert any("Jane" in n for n in names), f"expected Jane in {names}"

    conflicts = client.get("/conflicts")
    assert conflicts.status_code == 200
    assert isinstance(conflicts.json(), list)
