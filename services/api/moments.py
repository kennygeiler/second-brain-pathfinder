"""Aggregate stakeholder lineage + conflicts + Red Team runs into calendar moments."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import frontmatter

from . import vault
from .config import settings
from .today import _parse_ts, load_last_red_team

# Colors align with dashboard Stakeholder audit / capture conventions.
LEGEND: list[dict[str, str]] = [
    {"kind": "voice_ledger", "label": "Voice / ledger", "color": "#3B82F6"},
    {"kind": "email", "label": "Email", "color": "#F59E0B"},
    {"kind": "meeting", "label": "Meeting", "color": "#22C55E"},
    {"kind": "crawl", "label": "Web crawl", "color": "#06B6D4"},
    {"kind": "pdf_import", "label": "PDF import", "color": "#14B8A6"},
    {"kind": "public_record", "label": "Public record", "color": "#A855F7"},
    {"kind": "conflict", "label": "Sentiment conflict", "color": "#EF4444"},
    {"kind": "red_team", "label": "Red Team run", "color": "#EC4899"},
    {"kind": "merge", "label": "Note merge", "color": "#8B5CF6"},
    {"kind": "unknown", "label": "Other", "color": "#6B7280"},
]


def _legend_color(kind: str) -> str:
    for row in LEGEND:
        if row["kind"] == kind:
            return row["color"]
    return LEGEND[-1]["color"]


def collect_moments(year: int) -> dict[str, Any]:
    """Return moments for a calendar year (UTC date boundaries on each timestamp)."""
    now = datetime.now(timezone.utc)
    if year < 1970 or year > now.year + 1:
        year = now.year

    known_kinds = {r["kind"] for r in LEGEND}
    moments: list[dict[str, Any]] = []

    for note in vault.iter_stakeholder_notes():
        lineage = note.data.get("source_lineage") or []
        for i, entry in enumerate(lineage):
            if not isinstance(entry, dict):
                continue
            ts = _parse_ts(entry.get("timestamp"))
            if not ts or ts.year != year:
                continue
            kind = str(entry.get("type") or "unknown")
            eid = str(entry.get("id") or f"lineage-{i}")
            mid = f"sl-{note.id}-{eid}"
            detail = entry.get("note") or entry.get("meeting_id") or ""
            label = f"{kind.replace('_', ' ').title()}"
            moments.append(
                {
                    "id": mid,
                    "kind": kind,
                    "color": _legend_color(kind if kind in known_kinds else "unknown"),
                    "at": ts.isoformat(timespec="seconds"),
                    "day": ts.date().isoformat(),
                    "label": label,
                    "detail": str(detail)[:500],
                    "stakeholder_id": note.id,
                    "stakeholder_name": note.name,
                }
            )

    conflicts_dir = settings.vault / "conflicts"
    if conflicts_dir.exists():
        for md in conflicts_dir.glob("*.md"):
            try:
                post = frontmatter.load(md)
            except Exception:
                continue
            meta = dict(post.metadata or {})
            created_raw = meta.get("created") or meta.get("created_at")
            ts = _parse_ts(str(created_raw)) if created_raw else None
            if not ts or ts.year != year:
                continue
            rel = str(md.relative_to(settings.vault))
            eid = meta.get("entity_id")
            preview = (post.content or "").strip().split("\n")[0][:220]
            mid = f"cf-{md.stem}"
            moments.append(
                {
                    "id": mid,
                    "kind": "conflict",
                    "color": _legend_color("conflict"),
                    "at": ts.isoformat(timespec="seconds"),
                    "day": ts.date().isoformat(),
                    "label": "Sentiment conflict",
                    "detail": preview,
                    "stakeholder_id": str(eid) if eid else "",
                    "stakeholder_name": str(meta.get("stakeholder") or "Conflict"),
                    "path": rel,
                }
            )

    red = load_last_red_team()
    if red:
        ra = _parse_ts(str(red.get("run_at") or ""))
        if ra and ra.year == year:
            plan_path = red.get("plan_path")
            mid = "red-team-last"
            moments.append(
                {
                    "id": mid,
                    "kind": "red_team",
                    "color": _legend_color("red_team"),
                    "at": ra.isoformat(timespec="seconds"),
                    "day": ra.date().isoformat(),
                    "label": "Red Team run",
                    "detail": str(plan_path or "Action plan generated"),
                    "stakeholder_id": "",
                    "stakeholder_name": "Red Team",
                    "plan_path": str(plan_path) if plan_path else "",
                }
            )

    moments.sort(key=lambda m: m["at"], reverse=True)

    return {
        "year": year,
        "legend": LEGEND,
        "moments": moments,
    }
