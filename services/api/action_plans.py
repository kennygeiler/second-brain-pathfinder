"""Structured Red Team action plans: YAML tasks + markdown checkboxes + PATCH updates."""
from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any, Literal, Optional

import frontmatter
from pydantic import BaseModel, Field

from . import vault
from .config import settings

TaskStatus = Literal["todo", "done", "skipped"]
Priority = Literal["p0", "p1", "p2"]

PLAN_SCHEMA_VERSION = 2


class RedTeamTaskSpec(BaseModel):
    """LLM / heuristic output before vault IDs are resolved."""

    stakeholder_name: str = Field(description="Full name as in the vault")
    action: str = Field(description="One imperative sentence")
    rationale: str = ""
    due_by: str = ""  # ISO date YYYY-MM-DD
    priority: Priority = "p1"


class RedTeamPlanSpec(BaseModel):
    summary: str = ""
    tasks: list[RedTeamTaskSpec] = Field(default_factory=list)


def _vault_path(rel: str) -> Path:
    p = (settings.vault / rel).resolve()
    if not str(p).startswith(str(settings.vault.resolve())):
        raise ValueError("path escapes vault")
    return p


def render_tasks_markdown(tasks: list[dict[str, Any]]) -> str:
    """Render ## Tasks body: GitHub-style checkboxes + priority + due + rationale."""
    lines: list[str] = ["## Tasks", ""]
    for t in sorted(tasks, key=lambda x: int(x.get("idx", 0))):
        st = t.get("status", "todo")
        if st == "done":
            box = "[x]"
        elif st == "skipped":
            box = "[~]"
        else:
            box = "[ ]"
        pri = str(t.get("priority", "p1")).upper()
        action = (t.get("action") or "").strip()
        due = t.get("due_by") or ""
        name = t.get("stakeholder_name") or "—"
        due_part = f" (due {due})" if due else ""
        lines.append(f"- {box} **{pri}** {action}{due_part} · _{name}_")
        rat = (t.get("rationale") or "").strip()
        if rat:
            lines.append(f"  _{rat}_")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def inject_tasks_section(body: str, tasks_md: str) -> str:
    """Replace existing ## Tasks section or insert before ## Recommendation."""
    block = tasks_md.rstrip() + "\n\n"
    if "## Tasks" in body and "## Recommendation" in body:
        return re.sub(
            r"(?ms)^## Tasks\n.*?^(?=## Recommendation)",
            block,
            body,
            count=1,
        )
    if "## Recommendation" in body:
        return body.replace("## Recommendation", block + "## Recommendation", 1)
    return body.rstrip() + "\n\n" + block


def spec_to_task_dicts(plan: RedTeamPlanSpec, hotspots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach stakeholder UUIDs from vault by name; assign idx."""
    name_to_hotspot = {h.get("name"): h for h in hotspots}
    out: list[dict[str, Any]] = []
    for i, spec in enumerate(plan.tasks):
        sid = ""
        note = vault.find_by_name(spec.stakeholder_name)
        if note:
            sid = note.id
        else:
            hs = name_to_hotspot.get(spec.stakeholder_name)
            if hs and hs.get("id"):
                sid = str(hs["id"])
        out.append(
            {
                "idx": i,
                "stakeholder_id": sid,
                "stakeholder_name": spec.stakeholder_name,
                "action": spec.action,
                "rationale": spec.rationale,
                "due_by": spec.due_by,
                "priority": spec.priority,
                "status": "todo",
            }
        )
    return out


def build_markdown_file(
    *,
    summary: str,
    narrative: str,
    hotspots: list[dict[str, Any]],
    task_dicts: list[dict[str, Any]],
) -> str:
    """Full file content (frontmatter + body) for a new action plan."""
    meta: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "generated_at": vault.now_iso(),
        "hotspot_count": len(hotspots),
        "plan_schema": PLAN_SCHEMA_VERSION,
        "summary": summary.strip(),
        "tasks": task_dicts,
    }
    hotspots_body = "\n".join(
        (
            f"- **{h.get('name', '—')}** — influence {float(h.get('influence', 0)):.2f}, "
            f"telemetry {float(h.get('telemetry', 0)):.2f} on {h.get('system_name', '—')}"
        )
        for h in hotspots
    )
    tasks_md = render_tasks_markdown(task_dicts)
    body = (
        f"# Pathfinder Action Plan\n\n"
        f"{summary.strip()}\n\n"
        f"## Hotspots\n\n"
        f"{hotspots_body if hotspots_body else '_None._'}\n\n"
        f"{tasks_md}"
        f"## Recommendation\n\n"
        f"{narrative.strip()}\n"
    )
    post = frontmatter.Post(content=body, **meta)
    return frontmatter.dumps(post)


def update_task_status(rel_path: str, idx: int, status: TaskStatus) -> dict[str, Any]:
    """PATCH: set tasks[idx].status and sync ## Tasks in the markdown body."""
    path = _vault_path(rel_path)
    if not path.exists():
        raise FileNotFoundError(rel_path)
    post = frontmatter.load(path)
    meta = dict(post.metadata or {})
    tasks = meta.get("tasks")
    if not isinstance(tasks, list):
        raise ValueError("plan has no structured tasks (plan_schema < 2?)")

    found = False
    new_tasks: list[dict[str, Any]] = []
    for t in tasks:
        if not isinstance(t, dict):
            continue
        td = dict(t)
        if int(td.get("idx", -1)) == idx:
            td["status"] = status
            found = True
        new_tasks.append(td)
    if not found:
        raise ValueError(f"task idx {idx} not found")

    meta["tasks"] = new_tasks
    new_body = inject_tasks_section(post.content, render_tasks_markdown(new_tasks))
    post.metadata = meta
    post.content = new_body
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        frontmatter.dump(post, fh)

    return {
        "path": rel_path,
        "idx": idx,
        "status": status,
        "tasks": new_tasks,
    }


def _safe_task_idx(raw: Any) -> Optional[int]:
    """Return a non-negative task index, or None if the vault value is unusable."""
    if raw is None:
        return None
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return None
    if v < 0:
        return None
    return v


def collect_open_tasks(*, limit: int = 40) -> list[dict[str, Any]]:
    """Flatten todo tasks from all action plans (newest plans first)."""
    plans_dir = settings.vault / "action_plans"
    if not plans_dir.exists():
        return []
    out: list[dict[str, Any]] = []
    for md in sorted(plans_dir.glob("*.md"), reverse=True):
        try:
            post = frontmatter.load(md)
        except Exception:
            continue
        meta = post.metadata or {}
        if meta.get("plan_schema", 0) < 2:
            continue
        rel = str(md.relative_to(settings.vault))
        tasks = meta.get("tasks") or []
        if not isinstance(tasks, list):
            continue
        for t in tasks:
            if not isinstance(t, dict):
                continue
            if t.get("status") != "todo":
                continue
            idx = _safe_task_idx(t.get("idx"))
            if idx is None:
                continue
            out.append(
                {
                    "plan_path": rel,
                    "idx": idx,
                    "action": str(t.get("action") or ""),
                    "rationale": str(t.get("rationale") or ""),
                    "due_by": str(t.get("due_by") or ""),
                    "priority": str(t.get("priority") or "p1"),
                    "stakeholder_id": str(t.get("stakeholder_id") or ""),
                    "stakeholder_name": str(t.get("stakeholder_name") or ""),
                }
            )
            if len(out) >= limit:
                return out
    return out
