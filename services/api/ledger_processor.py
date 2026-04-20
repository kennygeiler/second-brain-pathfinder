"""Voice ledger ingestion: transcription -> Obsidian stakeholder notes.

Two-step workflow:
  - POST /ledger/preview  -> run extraction + sentiment check, NO disk writes.
                             Used by the dashboard's "Dry Run" button so an FDE
                             can review + correct entities before they land.
  - POST /ledger          -> write vault notes. Accepts either a raw transcript
                             (re-runs extraction) or entities_override (skips
                             extraction and trusts the user's table).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import vault
from .conflict_detector import CONFLICT_DELTA_THRESHOLD, check_conflict
from .extraction import ExtractedEntity, ExtractionResult, extract_entities

router = APIRouter(prefix="/ledger", tags=["ledger"])


class LedgerPayload(BaseModel):
    transcription: str = Field(min_length=1)
    source_id: Optional[str] = None
    source_type: str = Field(default="voice_ledger")
    timestamp: Optional[str] = None
    meeting_id: Optional[str] = None
    participants: list[str] = Field(default_factory=list)
    location: Optional[str] = None
    note: Optional[str] = None  # free-text summary attached to lineage
    # When supplied, extraction is skipped and these entities are trusted
    # verbatim. Populated by the dashboard Capture flow after a Dry Run
    # that the FDE has reviewed / edited.
    entities_override: Optional[list[ExtractedEntity]] = None


class LedgerResponse(BaseModel):
    files_touched: list[str]
    entities: list[dict[str, Any]]
    conflicts: list[str]


class ConflictPreview(BaseModel):
    name: str
    previous_sentiment: float
    new_sentiment: float
    delta: float
    would_trigger: bool


class PreviewResponse(BaseModel):
    entities: list[ExtractedEntity]
    overall_sentiment: float
    confidence: float
    conflict_previews: list[ConflictPreview]


def _lineage_entry(payload: LedgerPayload) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "type": payload.source_type,
        "id": payload.source_id or str(uuid.uuid4()),
        "timestamp": payload.timestamp or datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    # Only emit optional metadata when set — keeps YAML tidy.
    if payload.meeting_id:
        entry["meeting_id"] = payload.meeting_id
    if payload.participants:
        entry["participants"] = list(payload.participants)
    if payload.location:
        entry["location"] = payload.location
    if payload.note:
        entry["note"] = payload.note
    return entry


def _resolve_extraction(payload: LedgerPayload) -> ExtractionResult:
    """Either use the user-edited entities verbatim or run the extractor."""
    if payload.entities_override is not None:
        # User confirmed these in the Dry-Run table. Confidence=1 (manual), and
        # overall_sentiment is the mean of the entities' sentiment so downstream
        # consumers still get a number.
        ents = list(payload.entities_override)
        mean = sum(e.sentiment for e in ents) / len(ents) if ents else 0.5
        return ExtractionResult(entities=ents, overall_sentiment=mean, confidence=1.0)
    return extract_entities(payload.transcription)


def process_transcription(payload: LedgerPayload) -> LedgerResponse:
    if not payload.transcription.strip() and payload.entities_override is None:
        raise HTTPException(status_code=400, detail="transcription is empty")

    extraction = _resolve_extraction(payload)
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
                influence_score=entity.influence,
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


def preview_transcription(payload: LedgerPayload) -> PreviewResponse:
    """Run extraction + sentiment comparison, but do NOT touch the vault.

    Mirrors process_transcription's entity resolution so the Dry-Run table
    in the dashboard reflects exactly what a real commit would write.
    """
    if not payload.transcription.strip() and payload.entities_override is None:
        raise HTTPException(status_code=400, detail="transcription is empty")

    extraction = _resolve_extraction(payload)

    threshold = CONFLICT_DELTA_THRESHOLD
    conflict_previews: list[ConflictPreview] = []
    for entity in extraction.entities:
        existing = vault.find_by_name(entity.name)
        if existing is None:
            continue
        prev = existing.data.get("sentiment_vector")
        if prev is None:
            continue
        prev_f = float(prev)
        delta = abs(float(entity.sentiment) - prev_f)
        conflict_previews.append(
            ConflictPreview(
                name=entity.name,
                previous_sentiment=prev_f,
                new_sentiment=float(entity.sentiment),
                delta=delta,
                would_trigger=delta > threshold,
            )
        )

    return PreviewResponse(
        entities=list(extraction.entities),
        overall_sentiment=extraction.overall_sentiment,
        confidence=extraction.confidence,
        conflict_previews=conflict_previews,
    )


@router.post("", response_model=LedgerResponse)
def ingest_ledger(payload: LedgerPayload) -> LedgerResponse:
    return process_transcription(payload)


@router.post("/preview", response_model=PreviewResponse)
def preview_ledger(payload: LedgerPayload) -> PreviewResponse:
    return preview_transcription(payload)
