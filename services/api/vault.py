"""Obsidian vault helpers: read/write frontmatter, locate notes, wiki-link parsing."""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

import frontmatter

from .config import settings

WIKI_LINK_RE = re.compile(r"\[\[([^\]\|#]+?)(?:\|[^\]]+)?\]\]")

STAKEHOLDER_TEMPLATE_BODY = (
    "# {name}\n\n"
    "## Role\n\n"
    "_Populated by ledger processor._\n\n"
    "## Relationships\n\n"
    "<!-- Use [[Wiki-links]] to other stakeholders; they become graph edges. -->\n\n"
    "## Notes\n\n"
)


@dataclass
class StakeholderNote:
    path: Path
    post: frontmatter.Post

    @property
    def data(self) -> dict[str, Any]:
        return self.post.metadata

    @property
    def id(self) -> str:
        return str(self.data.get("id", ""))

    @property
    def name(self) -> str:
        return str(self.data.get("name") or self.path.stem)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slugify(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 _-]+", "", name).strip()
    return re.sub(r"\s+", "-", cleaned) or "unnamed"


def vault_root() -> Path:
    root = settings.vault
    root.mkdir(parents=True, exist_ok=True)
    return root


def iter_stakeholder_notes(include_conflicts: bool = False) -> Iterable[StakeholderNote]:
    root = vault_root()
    for md in root.rglob("*.md"):
        rel = md.relative_to(root).parts
        if rel and rel[0] in {"templates", "inbox", "proposed", "action_plans"}:
            continue
        if not include_conflicts and rel and rel[0] == "conflicts":
            continue
        try:
            post = frontmatter.load(md)
        except Exception:
            continue
        if not post.metadata.get("id"):
            continue
        yield StakeholderNote(path=md, post=post)


def find_by_name(name: str) -> Optional[StakeholderNote]:
    target = name.strip().lower()
    for note in iter_stakeholder_notes(include_conflicts=False):
        if str(note.data.get("name", "")).strip().lower() == target:
            return note
        if note.path.stem.lower() == slugify(name).lower():
            return note
    return None


def find_by_id(entity_id: str) -> Optional[StakeholderNote]:
    for note in iter_stakeholder_notes(include_conflicts=True):
        if note.id == entity_id:
            return note
    return None


def save_note(note: StakeholderNote) -> None:
    note.path.parent.mkdir(parents=True, exist_ok=True)
    with note.path.open("wb") as fh:
        frontmatter.dump(note.post, fh)


def create_stakeholder_note(
    name: str,
    entity_type: str,
    source_lineage_entry: dict[str, Any],
    influence_score: float = 0.5,
    sentiment_vector: float = 0.5,
    confidence_score: float = 0.0,
    ghost: bool = False,
) -> StakeholderNote:
    root = vault_root()
    path = root / f"{slugify(name)}.md"
    now = now_iso()
    metadata: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "name": name,
        "type": entity_type,
        "influence_score": float(influence_score),
        "sentiment_vector": float(sentiment_vector),
        "confidence_score": float(confidence_score),
        "technical_blockers": [],
        "source_lineage": [source_lineage_entry] if source_lineage_entry else [],
        "last_updated": now,
        "last_reconciled": now,
        "ghost": ghost,
    }
    post = frontmatter.Post(content=STAKEHOLDER_TEMPLATE_BODY.format(name=name), **metadata)
    note = StakeholderNote(path=path, post=post)
    save_note(note)
    return note


def update_note_from_extraction(
    note: StakeholderNote,
    *,
    entity_type: Optional[str],
    sentiment: Optional[float],
    confidence: float,
    technical_blockers: Optional[list[str]],
    source_lineage_entry: dict[str, Any],
) -> StakeholderNote:
    data = note.data
    if entity_type and not data.get("type"):
        data["type"] = entity_type
    if sentiment is not None:
        data["sentiment_vector"] = float(sentiment)
    data["confidence_score"] = float(confidence)
    if technical_blockers:
        existing = list(data.get("technical_blockers") or [])
        for blocker in technical_blockers:
            if blocker and blocker not in existing:
                existing.append(blocker)
        data["technical_blockers"] = existing
    lineage = list(data.get("source_lineage") or [])
    lineage.append(source_lineage_entry)
    data["source_lineage"] = lineage
    data["last_updated"] = now_iso()
    data["last_reconciled"] = now_iso()
    save_note(note)
    return note


def extract_wiki_links(body: str) -> list[str]:
    return [m.group(1).strip() for m in WIKI_LINK_RE.finditer(body)]
