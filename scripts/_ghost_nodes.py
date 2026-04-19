"""Shared helpers for cold-start scripts: create ghost stakeholder notes."""
from __future__ import annotations

import json
import re
from typing import Any

from services.api import vault
from services.api.config import settings
from services.api.extraction import ExtractedEntity, extract_entities

INFLUENCER_SYSTEM = (
    "You are a research analyst. Given raw text from public-record sources, "
    "identify the TOP 5 most influential people or roles (commissioners, "
    "directors, council members) and return strict JSON: "
    "{ \"influencers\": [{\"name\": str, \"type\": str, \"rationale\": str}] }. "
    "Only return names that appear in the provided text."
)


def llm_top_influencers(text: str) -> list[dict[str, str]]:
    """Ask the LLM for the top 5 influencers; fall back to extraction heuristic."""
    if settings.openai_api_key:
        try:
            from langchain_core.messages import HumanMessage, SystemMessage
            from langchain_openai import ChatOpenAI

            model = ChatOpenAI(
                model=settings.openai_model,
                api_key=settings.openai_api_key,
                temperature=0,
            )
            response = model.invoke(
                [
                    SystemMessage(content=INFLUENCER_SYSTEM),
                    HumanMessage(content=text[:12000]),
                ]
            )
            raw = getattr(response, "content", "") or ""
            match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
            if match:
                payload = json.loads(match.group(0))
                influencers = payload.get("influencers", [])
                if influencers:
                    return influencers[:5]
        except Exception:
            pass

    extraction = extract_entities(text)
    influencers: list[dict[str, str]] = []
    for entity in extraction.entities[:5]:
        influencers.append(
            {
                "name": entity.name,
                "type": entity.type,
                "rationale": "heuristic extraction",
            }
        )
    return influencers


def write_ghost_note(
    influencer: dict[str, str],
    *,
    source_type: str,
    source_id: str,
) -> vault.StakeholderNote | None:
    name = (influencer.get("name") or "").strip()
    if not name:
        return None
    if vault.find_by_name(name):
        return None
    lineage = {
        "type": source_type,
        "id": source_id,
        "timestamp": vault.now_iso(),
        "rationale": influencer.get("rationale"),
    }
    return vault.create_stakeholder_note(
        name=name,
        entity_type=influencer.get("type") or "Person",
        source_lineage_entry=lineage,
        influence_score=0.3,
        sentiment_vector=0.5,
        confidence_score=0.2,
        ghost=True,
    )


def ghost_nodes_from_text(
    text: str,
    *,
    source_type: str,
    source_id: str,
) -> list[dict[str, Any]]:
    created: list[dict[str, Any]] = []
    for influencer in llm_top_influencers(text):
        note = write_ghost_note(influencer, source_type=source_type, source_id=source_id)
        if note:
            created.append(
                {
                    "name": note.name,
                    "id": note.id,
                    "type": note.data.get("type"),
                    "path": str(note.path),
                    "rationale": influencer.get("rationale"),
                }
            )
    return created


def _extracted_only(text: str) -> list[ExtractedEntity]:
    return extract_entities(text).entities
