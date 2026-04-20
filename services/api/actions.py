"""First-class action tracking (separate from markdown plan rendering)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

ActionStatus = Literal["todo", "in_progress", "done", "skipped"]

ALLOWED_TRANSITIONS: dict[ActionStatus, set[ActionStatus]] = {
    "todo": {"in_progress", "done", "skipped"},
    "in_progress": {"todo", "done", "skipped"},
    "done": {"done"},
    "skipped": {"skipped", "todo"},
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _actions_dir(vault_root: Path) -> Path:
    d = vault_root / ".state" / "actions"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path_for(vault_root: Path, action_id: str) -> Path:
    return _actions_dir(vault_root) / f"{action_id}.json"


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def create_action(vault_root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    action_id = str(payload.get("id") or f"act_{uuid.uuid4().hex[:12]}")
    now = now_iso()
    record: dict[str, Any] = {
        "id": action_id,
        "title": str(payload.get("title") or "").strip(),
        "stakeholder_id": str(payload.get("stakeholder_id") or ""),
        "system_id": str(payload.get("system_id") or ""),
        "priority": str(payload.get("priority") or "p1"),
        "owner": str(payload.get("owner") or ""),
        "due_by": str(payload.get("due_by") or ""),
        "status": str(payload.get("status") or "todo"),
        "outcome_note": str(payload.get("outcome_note") or ""),
        "source": payload.get("source") if isinstance(payload.get("source"), dict) else {},
        "created_at": now,
        "updated_at": now,
        "completed_at": str(payload.get("completed_at") or ""),
    }
    if not record["title"]:
        raise ValueError("title is required")
    if record["status"] not in ALLOWED_TRANSITIONS:
        raise ValueError("invalid status")
    _write(_path_for(vault_root, action_id), record)
    return record


def patch_action(vault_root: Path, action_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    path = _path_for(vault_root, action_id)
    if not path.exists():
        raise FileNotFoundError(action_id)
    data = _read(path)
    current = str(data.get("status") or "todo")
    if "status" in patch:
        nxt = str(patch["status"])
        allowed = ALLOWED_TRANSITIONS.get(current, set())
        if nxt not in allowed:
            raise ValueError(f"invalid status transition: {current} -> {nxt}")
        data["status"] = nxt
        if nxt == "done":
            data["completed_at"] = str(patch.get("completed_at") or now_iso())
    for key in ("outcome_note", "owner", "due_by", "priority", "title"):
        if key in patch and patch[key] is not None:
            data[key] = str(patch[key])
    data["updated_at"] = now_iso()
    _write(path, data)
    return data


def list_actions(
    vault_root: Path,
    *,
    status: Optional[str] = None,
    owner: Optional[str] = None,
    stakeholder_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in sorted(_actions_dir(vault_root).glob("*.json"), reverse=True):
        try:
            row = _read(p)
        except Exception:
            continue
        if status and str(row.get("status")) != status:
            continue
        if owner and str(row.get("owner")) != owner:
            continue
        if stakeholder_id and str(row.get("stakeholder_id")) != stakeholder_id:
            continue
        out.append(row)
    return out
