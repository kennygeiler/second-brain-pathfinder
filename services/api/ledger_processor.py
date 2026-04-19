"""Voice ledger ingestion: transcription -> Obsidian stakeholder notes."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import vault
from .conflict_detector import check_conflict
from .extraction import extract_entities

router = APIRouter(prefix="/ledger", tags=["ledger"])


class LedgerPayload(BaseModel):
    transcription: str = Field(min_length=1)
    source_id: Optional[str] = None
    source_type: str = Field(default="voice_ledger")
    timestamp: Optional[str] = None
    meeting_id: Optional[str] = None


class LedgerResponse(BaseModel):
    files_touched: list[str]
    entities: list[dict[str, Any]]
    conflicts: list[str]


def _lineage_entry(payload: LedgerPayload) -> dict[str, Any]:
    return {
        "type": payload.source_type,
        "id": payload.source_id or str(uuid.uuid4()),
        "timestamp": payload.timestamp or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "meeting_id": payload.meeting_id,
    }


def process_transcription(payload: LedgerPayload) -> LedgerResponse:
    if not payload.transcription.strip():
        raise HTTPException(status_code=400, detail="transcription is empty")

    extraction = extract_entities(payload.transcription)
    lineage = _lineage_entry(payload)

    files_touched: list[str] = []
    entity_summaries: list[dict[str, Any]] = []
    conflicts: list[str] = []

    for entity in extraction.entities:
        existing = vault.find_by_name(entity.name)
        previous_sentiment: Optional[float] = None
        if existing is not None:
            previous_sentiment = existing.data.get("sentiment_vector")
            note = vault.update_note_from_extraction(
                existing,
                entity_type=entity.type,
                sentiment=entity.sentiment,
                confidence=extraction.confidence,
                technical_blockers=entity.blockers,
                source_lineage_entry=lineage,
            )
        else:
            note = vault.create_stakeholder_note(
                name=entity.name,
                entity_type=entity.type,
                source_lineage_entry=lineage,
                influence_score=0.5,
                sentiment_vector=entity.sentiment,
                confidence_score=extraction.confidence,
            )

        files_touched.append(str(note.path))
        entity_summaries.append(
            {
                "id": note.id,
                "name": note.name,
                "type": note.data.get("type"),
                "sentiment_vector": note.data.get("sentiment_vector"),
                "confidence_score": note.data.get("confidence_score"),
            }
        )

        if previous_sentiment is not None:
            conflict = check_conflict(
                note,
                previous_sentiment=float(previous_sentiment),
                new_sentiment=float(entity.sentiment),
                context=payload.transcription[:500],
            )
            if conflict:
                conflicts.append(str(conflict))

    return LedgerResponse(
        files_touched=files_touched,
        entities=entity_summaries,
        conflicts=conflicts,
    )


@router.post("", response_model=LedgerResponse)
def ingest_ledger(payload: LedgerPayload) -> LedgerResponse:
    return process_transcription(payload)
