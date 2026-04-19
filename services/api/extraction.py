"""LangChain-backed entity + sentiment extraction with a deterministic fallback.

The fallback keeps the pipeline functional without network/API keys, so the
demo can run offline; real runs use the LLM when OPENAI_API_KEY is set.
"""
from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, Field

from .config import settings

EXTRACTION_SYSTEM = (
    "You are an extraction engine for FDE stakeholder intelligence. "
    "From the supplied transcription, return strict JSON with keys: "
    "entities (list of {name, type, role?, agency?, blockers?[], sentiment (0-1)}) "
    "and overall_sentiment (0-1). type must be one of: Person, Role, Agency, System, Gatekeeper. "
    "If no entities are detectable, return an empty list. Do not invent data."
)


class ExtractedEntity(BaseModel):
    name: str
    type: str = "Person"
    role: str | None = None
    agency: str | None = None
    blockers: list[str] = Field(default_factory=list)
    sentiment: float = 0.5


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


def _heuristic_extract(text: str) -> ExtractionResult:
    entities: dict[str, ExtractedEntity] = {}
    for raw in re.findall(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b", text):
        lowered = raw.lower()
        entity_type = "Person"
        if any(hint in lowered for hint in _AGENCY_HINTS):
            entity_type = "Agency"
        elif any(hint in lowered for hint in _ROLE_HINTS):
            entity_type = "Role"
        entities.setdefault(raw, ExtractedEntity(name=raw, type=entity_type))

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

    confidence = 0.35 if entities else 0.15
    return ExtractionResult(
        entities=list(entities.values()),
        overall_sentiment=sentiment,
        confidence=confidence,
    )


def _llm_extract(text: str) -> ExtractionResult | None:
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
