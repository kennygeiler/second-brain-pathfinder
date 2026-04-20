"""Aggregate 'Today' view: urgent conflicts, Red Team hotspots, stale contacts, ghosts."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

import frontmatter

from . import action_plans, actions as actions_mod, vault
from .config import settings

CONTACT_SOURCE_TYPES = frozenset({"voice_ledger", "email", "meeting"})
COLD_START_TYPES = frozenset({"crawl", "pdf_import", "public_record"})


def _parse_ts(raw: Optional[str]) -> Optional[datetime]:
    if not raw or not isinstance(raw, str):
        return None
    try:
        # ISO8601 from vault.now_iso() — may end with Z or +00:00
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def _last_contact_at(note: vault.StakeholderNote) -> Optional[datetime]:
    """Best-effort last contact timestamp based only on contact-derived events."""
    candidates: list[datetime] = []
    lu = _parse_ts(note.data.get("last_contact_at"))
    if lu:
        candidates.append(lu)
    for entry in note.data.get("source_lineage") or []:
        if not isinstance(entry, dict):
            continue
        if entry.get("type") not in CONTACT_SOURCE_TYPES:
            continue
        ts = _parse_ts(entry.get("timestamp"))
        if ts:
            candidates.append(ts)
    if not candidates:
        return None
    return max(candidates)


def _days_between(a: datetime, b: datetime) -> int:
    if a.tzinfo is None:
        a = a.replace(tzinfo=timezone.utc)
    if b.tzinfo is None:
        b = b.replace(tzinfo=timezone.utc)
    return max(0, int((b - a).total_seconds() // 86_400))


def is_ghost_stakeholder(note: vault.StakeholderNote) -> bool:
    if note.data.get("ghost"):
        return True
    lineage = note.data.get("source_lineage") or []
    if not lineage:
        return False
    for entry in lineage:
        if not isinstance(entry, dict):
            continue
        t = str(entry.get("type") or "")
        if t and t not in COLD_START_TYPES:
            return False
    return True


def load_last_red_team() -> Optional[dict[str, Any]]:
    path = settings.vault / ".state" / "last_red_team.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def build_today_payload(*, stale_days: int, conflict_limit: int = 10) -> dict[str, Any]:
    """Return JSON-serializable dict for GET /today."""
    now = datetime.now(timezone.utc)
    red = load_last_red_team()

    conflicts_out: list[dict[str, Any]] = []
    conflicts_dir = settings.vault / "conflicts"
    if conflicts_dir.exists():
        items: list[tuple[datetime, Path, dict[str, Any], str]] = []
        for md in conflicts_dir.glob("*.md"):
            try:
                post = frontmatter.load(md)
            except Exception:
                continue
            meta = dict(post.metadata or {})
            created_raw = meta.get("created") or meta.get("created_at")
            created = _parse_ts(str(created_raw)) if created_raw else None
            items.append((created or datetime.min.replace(tzinfo=timezone.utc), md, meta, post.content))
        items.sort(key=lambda x: x[0], reverse=True)
        for _, md, meta, content in items[:conflict_limit]:
            rel = str(md.relative_to(settings.vault))
            eid = meta.get("entity_id")
            conflicts_out.append(
                {
                    "path": rel,
                    "entity_id": str(eid) if eid else None,
                    "stakeholder_name": meta.get("stakeholder"),
                    "created": str(meta.get("created") or meta.get("created_at") or ""),
                    "preview": (content or "").strip().split("\n")[0][:220],
                }
            )

    stale_out: list[dict[str, Any]] = []
    ghost_out: list[dict[str, Any]] = []

    for note in vault.iter_stakeholder_notes():
        last_c = _last_contact_at(note)
        if last_c is None:
            days = stale_days + 1
            last_contact = None
        else:
            days = _days_between(last_c, now)
            last_contact = last_c.isoformat(timespec="seconds")
        if days > stale_days:
            stale_out.append(
                {
                    "id": note.id,
                    "name": note.name,
                    "type": note.data.get("type"),
                    "days_since_contact": days,
                    "last_contact_at": last_contact,
                    "never_contacted": last_c is None,
                }
            )
        if is_ghost_stakeholder(note):
            ghost_out.append(
                {
                    "id": note.id,
                    "name": note.name,
                    "type": note.data.get("type"),
                    "influence_score": note.data.get("influence_score"),
                }
            )

    stale_out.sort(key=lambda x: x["days_since_contact"], reverse=True)
    stale_out = stale_out[:10]
    ghost_out = ghost_out[:10]

    at_risk: list[dict[str, Any]] = []
    plan_path: Optional[str] = None
    last_run: Optional[str] = None
    if red:
        last_run = red.get("run_at")
        plan_path = red.get("plan_path")
        for h in red.get("hotspots") or []:
            if isinstance(h, dict):
                at_risk.append(dict(h))

    actions_open = [
        a for a in actions_mod.list_actions(settings.vault)
        if str(a.get("status") or "") in {"todo", "in_progress"}
    ]
    open_tasks = (
        [
            {
                "plan_path": str(a.get("source", {}).get("ref") or ""),
                "idx": i,
                "action": str(a.get("title") or ""),
                "rationale": str(a.get("outcome_note") or ""),
                "due_by": str(a.get("due_by") or ""),
                "priority": str(a.get("priority") or "p1"),
                "stakeholder_id": str(a.get("stakeholder_id") or ""),
                "stakeholder_name": "",
            }
            for i, a in enumerate(actions_open)
        ]
        if actions_open
        else action_plans.collect_open_tasks(limit=40)
    )

    return {
        "stale_days": stale_days,
        "last_red_team_at": last_run,
        "plan_path": plan_path,
        "conflicts": conflicts_out,
        "at_risk": at_risk,
        "stale": stale_out,
        "ghost_nodes": ghost_out,
        "open_tasks": open_tasks,
    }
