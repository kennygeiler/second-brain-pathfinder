"""LangChain-backed entity + sentiment extraction with a deterministic fallback.

The fallback keeps the pipeline functional without network/API keys, so the
demo can run offline; real runs use the LLM when OPENAI_API_KEY is set.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from pydantic import BaseModel, Field

from .config import settings

EXTRACTION_SYSTEM = (
    "You are an extraction engine for FDE stakeholder intelligence. "
    "From the supplied transcription, return strict JSON with keys: "
    "entities (list of {name, type, role?, agency?, blockers?[], sentiment (0-1), influence (0-1)}) "
    "and overall_sentiment (0-1). "
    "type must be one of: Person, Role, Agency, System, Gatekeeper. "
    "influence reflects institutional power over the initiative: "
    "Commissioners/Directors/Chiefs = 0.80-1.00, "
    "Managers/Coordinators = 0.50-0.75, "
    "Engineers/ICs/Analysts = 0.25-0.50, "
    "Agencies = 0.60-0.90, "
    "Systems = 0.40-0.60. "
    "When a person has a clear title, PREFER the full name+title (e.g. 'Jane Commissioner') "
    "over the first name alone. Do NOT emit both — pick the most specific form. "
    "If no entities are detectable, return an empty list. Do not invent data."
)


class ExtractedEntity(BaseModel):
    name: str
    type: str = "Person"
    role: Optional[str] = None
    agency: Optional[str] = None
    blockers: list[str] = Field(default_factory=list)
    sentiment: float = 0.5
    influence: float = 0.5


class ExtractionResult(BaseModel):
    entities: list[ExtractedEntity] = Field(default_factory=list)
    overall_sentiment: float = 0.5
    confidence: float = 0.5


_ROLE_HINTS = (
    "commissioner",
    "director",
    "engineer",
    "manager",
    "chief",
    "officer",
    "coordinator",
    "secretary",
)
_AGENCY_HINTS = ("department", "agency", "authority", "bureau", "dot", "dep", "mta")

_POS = {"great", "excellent", "love", "happy", "win", "approved", "smooth", "success"}
_NEG = {
    "blocked",
    "delay",
    "delayed",
    "angry",
    "frustrated",
    "broken",
    "failed",
    "fail",
    "block",
    "poor",
    "bad",
    "concerned",
    "upset",
    "stalled",
}


def _estimate_influence(name: str, entity_type: str) -> float:
    """Rough influence prior when the LLM doesn't supply one (or fallback path)."""
    lowered = name.lower()
    if any(hint in lowered for hint in ("commissioner", "director", "chief", "secretary")):
        return 0.85
    if any(hint in lowered for hint in ("manager", "coordinator", "supervisor", "officer")):
        return 0.6
    if "engineer" in lowered or "analyst" in lowered or "developer" in lowered:
        return 0.4
    if entity_type == "Gatekeeper":
        return 0.8
    if entity_type == "Agency":
        return 0.7
    if entity_type == "System":
        return 0.5
    return 0.45


def _name_tokens(name: str) -> set[str]:
    return set(re.findall(r"\w+", name.lower()))


def _dedupe_entities(entities: list[ExtractedEntity]) -> list[ExtractedEntity]:
    """Collapse short names into their longer counterparts.

    Example: 'Jane' + 'Jane Commissioner' → keep 'Jane Commissioner'.
    Rule: if entity A's token set is a proper subset of entity B's token set,
    A is dropped and B absorbs A's blockers.
    """
    if len(entities) <= 1:
        return entities

    # Longest names first so we examine the most complete forms.
    sorted_ents = sorted(entities, key=lambda e: len(_name_tokens(e.name)), reverse=True)
    kept: list[ExtractedEntity] = []
    for ent in sorted_ents:
        tokens = _name_tokens(ent.name)
        absorbed = False
        for k in kept:
            k_tokens = _name_tokens(k.name)
            # Current entity is a strict subset of an already-kept one → drop it,
            # merge its blockers upward so we don't lose signal.
            if tokens and tokens.issubset(k_tokens) and tokens != k_tokens:
                merged = list({*k.blockers, *ent.blockers})
                k.blockers = merged
                absorbed = True
                break
        if not absorbed:
            kept.append(ent)
    return kept


def _heuristic_extract(text: str) -> ExtractionResult:
    entities: dict[str, ExtractedEntity] = {}
    for raw in re.findall(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b", text):
        lowered = raw.lower()
        entity_type = "Person"
        if any(hint in lowered for hint in _AGENCY_HINTS):
            entity_type = "Agency"
        elif any(hint in lowered for hint in _ROLE_HINTS):
            entity_type = "Role"
        entities.setdefault(
            raw,
            ExtractedEntity(
                name=raw,
                type=entity_type,
                influence=_estimate_influence(raw, entity_type),
            ),
        )

    tokens = set(re.findall(r"[a-zA-Z]+", text.lower()))
    pos = len(tokens & _POS)
    neg = len(tokens & _NEG)
    if pos + neg == 0:
        sentiment = 0.5
    else:
        sentiment = pos / (pos + neg)

    blockers: list[str] = []
    for sentence in re.split(r"[.!?]\s+", text):
        if any(word in sentence.lower() for word in ("block", "delay", "fail", "broken", "stalled")):
            blockers.append(sentence.strip())

    for entity in entities.values():
        entity.sentiment = sentiment
        if blockers and entity.type in {"Person", "Role", "Agency", "Gatekeeper"}:
            entity.blockers = list(blockers[:3])

    deduped = _dedupe_entities(list(entities.values()))
    confidence = 0.35 if deduped else 0.15
    return ExtractionResult(
        entities=deduped,
        overall_sentiment=sentiment,
        confidence=confidence,
    )


def _llm_extract(text: str) -> Optional[ExtractionResult]:
    if not settings.openai_api_key:
        return None
    try:
        from langchain_core.messages import HumanMessage, SystemMessage
        from langchain_openai import ChatOpenAI
    except Exception:
        return None

    try:
        model = ChatOpenAI(
            model=settings.openai_model,
            api_key=settings.openai_api_key,
            temperature=0,
        )
        response = model.invoke(
            [
                SystemMessage(content=EXTRACTION_SYSTEM),
                HumanMessage(content=text),
            ]
        )
    except Exception:
        return None

    raw = getattr(response, "content", "") or ""
    match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
    if not match:
        return None
    try:
        payload: dict[str, Any] = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None

    try:
        entities = [ExtractedEntity(**e) for e in payload.get("entities", [])]
    except Exception:
        return None

    # Fill missing/unreasonable influence values from the role-aware heuristic
    # so the dashboard never shows a flat 0.5 wall for everybody.
    for ent in entities:
        if ent.influence in (0.5, 0.0):
            ent.influence = _estimate_influence(ent.name, ent.type)

    entities = _dedupe_entities(entities)

    overall = float(payload.get("overall_sentiment", 0.5))
    confidence = float(payload.get("confidence", 0.75))
    return ExtractionResult(
        entities=entities,
        overall_sentiment=overall,
        confidence=confidence,
    )


def extract_entities(text: str) -> ExtractionResult:
    """Return entities + sentiment from a transcription.

    Tries the LLM when configured, otherwise falls back to a conservative
    heuristic so the pipeline always produces a result.
    """
    result = _llm_extract(text)
    if result is not None:
        return result
    return _heuristic_extract(text)
