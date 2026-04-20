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


def relpath_under_vault(path: Path) -> str:
    """Stable vault-relative path for JSON APIs (avoids ValueError if resolve/cwd drifts)."""
    root = vault_root().resolve()
    try:
        resolved = path.resolve()
    except OSError:
        resolved = path
    try:
        return str(resolved.relative_to(root))
    except ValueError:
        try:
            return str(path.resolve(strict=False).relative_to(root))
        except (OSError, ValueError):
            return path.name


def iter_stakeholder_notes(include_conflicts: bool = False) -> Iterable[StakeholderNote]:
    root = vault_root()
    for md in root.rglob("*.md"):
        rel = md.relative_to(root).parts
        # Skip everything that isn't an active stakeholder:
        #   templates / inbox / proposed / action_plans — never stakeholders
        #   archive                                    — soft-deleted, excluded
        if rel and rel[0] in {"templates", "inbox", "proposed", "action_plans", "archive"}:
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


# ─── Day-4 editing helpers ────────────────────────────────────────────────────

# Fields the UI is allowed to PATCH directly. Anything else is silently dropped
# so the client can't stomp on lineage, id, or timestamps by accident.
PATCHABLE_FIELDS: frozenset[str] = frozenset(
    {
        "name",
        "type",
        "role",
        "agency",
        "influence_score",
        "sentiment_vector",
        "technical_blockers",
        "ghost",
    }
)


def patch_note(note: StakeholderNote, patch: dict[str, Any]) -> StakeholderNote:
    """Shallow-merge `patch` into the note's YAML frontmatter.

    Only whitelisted keys in PATCHABLE_FIELDS are applied. `last_reconciled` is
    bumped so sync/red-team can see this edit happened.
    """
    data = note.data
    for key, value in patch.items():
        if key not in PATCHABLE_FIELDS:
            continue
        data[key] = value
    data["last_reconciled"] = now_iso()
    data["last_updated"] = now_iso()
    save_note(note)
    return note


def replace_body(note: StakeholderNote, body_md: str) -> StakeholderNote:
    """Replace the markdown body (YAML frontmatter preserved)."""
    note.post.content = body_md
    note.data["last_reconciled"] = now_iso()
    save_note(note)
    return note


def archive_dir() -> Path:
    d = vault_root() / "archive"
    d.mkdir(parents=True, exist_ok=True)
    return d


def archive_note(note: StakeholderNote) -> Path:
    """Soft-delete: move the note into vault/archive/ with a timestamp suffix.

    We don't destroy the file — the audit trail is the whole point of this
    system. A follow-up sync can emit tombstone edges for graph cleanup.
    """
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    target = archive_dir() / f"{note.path.stem}-{stamp}.md"
    # Ensure latest in-memory state is persisted before moving.
    save_note(note)
    note.path.rename(target)
    # Note the archive event inside the moved file so a human spelunking later
    # can see when + why it was archived.
    post = frontmatter.load(target)
    post.metadata["archived_at"] = now_iso()
    with target.open("wb") as fh:
        frontmatter.dump(post, fh)
    return target


def merge_notes(source: StakeholderNote, target: StakeholderNote) -> StakeholderNote:
    """Merge `source` into `target`, then archive `source`.

    Merge semantics (conservative — target keeps its identity):
      - target.technical_blockers ← union (target wins on duplicates)
      - target.source_lineage     ← concat (source entries appended)
      - target.ghost              ← false if EITHER note was non-ghost
      - target.last_updated / last_reconciled bumped to now
      - target body                ← target body + "## Merged from {source.name}" + source body

    Source is moved to vault/archive/ via archive_note().
    """
    if source.id == target.id:
        raise ValueError("cannot merge a note into itself")

    t_data = target.data
    s_data = source.data

    # Blockers: preserve insertion order, dedupe.
    blockers: list[str] = list(t_data.get("technical_blockers") or [])
    for b in s_data.get("technical_blockers") or []:
        if b and b not in blockers:
            blockers.append(b)
    t_data["technical_blockers"] = blockers

    # Lineage: concat, keep everything for audit.
    lineage = list(t_data.get("source_lineage") or [])
    lineage.extend(s_data.get("source_lineage") or [])
    # Tag this merge itself as a lineage event so the audit trail is complete.
    lineage.append(
        {
            "type": "merge",
            "id": source.id,
            "timestamp": now_iso(),
            "note": f"merged from {source.name}",
        }
    )
    t_data["source_lineage"] = lineage

    # If either side is a real contact, the result is a real contact.
    t_data["ghost"] = bool(t_data.get("ghost")) and bool(s_data.get("ghost"))

    # Append merged body below a separator.
    merged_body = (
        f"{target.post.content.rstrip()}\n\n"
        f"## Merged from {source.name}\n\n"
        f"{source.post.content.strip()}\n"
    )
    target.post.content = merged_body

    t_data["last_updated"] = now_iso()
    t_data["last_reconciled"] = now_iso()
    save_note(target)

    archive_note(source)
    return target
