"""FastAPI entry point: ledger webhook, sync trigger, dashboard BFF."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

import frontmatter
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import action_plans, moments as moments_mod, obsidian_to_neo4j, today as today_mod, vault
from .config import settings
from .ledger_processor import router as ledger_router


EntityType = Literal["Person", "Role", "Agency", "System", "Gatekeeper"]


class StakeholderPatch(BaseModel):
    """Partial update for a stakeholder note. All fields optional — only the
    ones the client sends get applied. Server-side bounds enforce the 0-1
    convention so bad client values can't corrupt the YAML."""

    name: Optional[str] = None
    type: Optional[EntityType] = None
    role: Optional[str] = None
    agency: Optional[str] = None
    influence_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    sentiment_vector: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    technical_blockers: Optional[list[str]] = None
    ghost: Optional[bool] = None


class NotesBody(BaseModel):
    content: str


class MergeBody(BaseModel):
    target_id: str


class ActionPlanTaskPatch(BaseModel):
    """Toggle a structured task checkbox on an action plan note."""

    path: str = Field(description="Path relative to vault, e.g. action_plans/Pathfinder-Action-Plan-2026-04-19.md")
    idx: int = Field(ge=0)
    status: Literal["todo", "done", "skipped"]


def _serialize_detail(note: vault.StakeholderNote) -> dict[str, Any]:
    return {
        "id": note.id,
        "name": note.name,
        "metadata": note.data,
        "content": note.post.content,
        "path": str(note.path.relative_to(settings.vault)),
    }

app = FastAPI(title="Pathfinder Core", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(ledger_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "vault": str(settings.vault)}


@app.get("/today")
def get_today() -> dict[str, Any]:
    """Priority stack for the dashboard: conflicts, Red Team hotspots, stale, ghosts."""
    return today_mod.build_today_payload(stale_days=settings.stale_days)


@app.get("/moments")
def get_moments(year: Optional[int] = Query(default=None, ge=2000, le=2100)) -> dict[str, Any]:
    """Stakeholder lineage + conflicts + last Red Team run, bucketed by calendar day."""
    y = year if year is not None else datetime.now(timezone.utc).year
    return moments_mod.collect_moments(y)


@app.post("/sync")
def trigger_sync(commit: bool = False) -> dict[str, Any]:
    return obsidian_to_neo4j.sync(auto_commit=commit or settings.auto_commit)


@app.post("/red-team")
def trigger_red_team() -> dict[str, Any]:
    """Run the LangGraph Red Team; emit a fresh action plan markdown.

    Synchronous for now — LLM call takes seconds, not minutes. If it grows we
    can hand it off to a background task or a websocket channel.
    """
    try:
        from agents.red_team_graph import run_red_team
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"red-team graph unavailable: {exc}",
        )

    state = run_red_team({})
    hotspots = state.get("entities", [])
    plan_path_raw = state.get("raw_input") or ""
    narrative = state.get("reconciliation_plan") or ""

    plan_path: Optional[str] = None
    if plan_path_raw:
        try:
            plan_path = str(Path(plan_path_raw).relative_to(settings.vault))
        except ValueError:
            plan_path = plan_path_raw

    return {
        "hotspots": len(hotspots),
        "plan_path": plan_path,
        "conflict_detected": bool(state.get("conflict_detected")),
        "narrative_preview": narrative[:400],
        "hotspot_names": [h.get("name") for h in hotspots if h.get("name")],
    }


@app.get("/stakeholders")
def list_stakeholders() -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for note in vault.iter_stakeholder_notes():
        data = note.data
        results.append(
            {
                "id": note.id,
                "name": note.name,
                "type": data.get("type"),
                "influence_score": data.get("influence_score"),
                "sentiment_vector": data.get("sentiment_vector"),
                "confidence_score": data.get("confidence_score"),
                "technical_blockers": data.get("technical_blockers", []),
                "path": str(note.path.relative_to(settings.vault)),
            }
        )
    return results


@app.get("/stakeholders/{entity_id}")
def get_stakeholder(entity_id: str) -> dict[str, Any]:
    note = vault.find_by_id(entity_id)
    if not note:
        raise HTTPException(status_code=404, detail="stakeholder not found")
    return _serialize_detail(note)


@app.patch("/stakeholders/{entity_id}")
def patch_stakeholder(entity_id: str, patch: StakeholderPatch) -> dict[str, Any]:
    """Partial update of a stakeholder's YAML frontmatter.

    Only fields present in the request body are touched. Bounds on influence /
    sentiment are enforced by the Pydantic model.
    """
    note = vault.find_by_id(entity_id)
    if not note:
        raise HTTPException(status_code=404, detail="stakeholder not found")
    # `exclude_none=True` so an absent field means "don't touch" rather than
    # "set to null" — matches PATCH semantics the UI expects.
    patch_dict = patch.model_dump(exclude_none=True)
    if not patch_dict:
        raise HTTPException(status_code=400, detail="empty patch")
    vault.patch_note(note, patch_dict)
    return _serialize_detail(note)


@app.put("/stakeholders/{entity_id}/notes")
def put_stakeholder_notes(entity_id: str, body: NotesBody) -> dict[str, Any]:
    """Replace the markdown body of a stakeholder note (frontmatter preserved).

    Used by the dashboard's private-notes editor; the body is free-form markdown
    that doesn't need schema validation.
    """
    note = vault.find_by_id(entity_id)
    if not note:
        raise HTTPException(status_code=404, detail="stakeholder not found")
    vault.replace_body(note, body.content)
    return _serialize_detail(note)


@app.delete("/stakeholders/{entity_id}")
def archive_stakeholder(entity_id: str) -> dict[str, Any]:
    """Soft-delete a stakeholder by moving its file to vault/archive/."""
    note = vault.find_by_id(entity_id)
    if not note:
        raise HTTPException(status_code=404, detail="stakeholder not found")
    new_path = vault.archive_note(note)
    return {
        "id": entity_id,
        "archived_to": str(new_path.relative_to(settings.vault)),
    }


@app.post("/stakeholders/{entity_id}/merge")
def merge_stakeholder(entity_id: str, body: MergeBody) -> dict[str, Any]:
    """Merge the source (entity_id) into the target (body.target_id).

    Source's blockers + lineage move into target, then source is archived.
    Returns the (updated) target note so the UI can swap in-place.
    """
    if entity_id == body.target_id:
        raise HTTPException(status_code=400, detail="cannot merge a note into itself")
    source = vault.find_by_id(entity_id)
    if not source:
        raise HTTPException(status_code=404, detail="source stakeholder not found")
    target = vault.find_by_id(body.target_id)
    if not target:
        raise HTTPException(status_code=404, detail="target stakeholder not found")
    try:
        merged = vault.merge_notes(source, target)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _serialize_detail(merged)


@app.get("/conflicts")
def list_conflicts(limit: int = Query(default=50, ge=1, le=500)) -> list[dict[str, Any]]:
    conflicts_dir = settings.vault / "conflicts"
    if not conflicts_dir.exists():
        return []
    items: list[dict[str, Any]] = []
    for md in sorted(conflicts_dir.glob("*.md"), reverse=True)[:limit]:
        try:
            post = frontmatter.load(md)
        except Exception:
            continue
        items.append(
            {
                "path": str(md.relative_to(settings.vault)),
                "metadata": post.metadata,
                "content": post.content,
            }
        )
    return items


@app.patch("/action-plans/task")
def patch_action_plan_task(body: ActionPlanTaskPatch) -> dict[str, Any]:
    """Update task status in YAML and sync the ## Tasks markdown checkboxes."""
    try:
        return action_plans.update_task_status(body.path, body.idx, body.status)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="action plan not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/action-plans")
def list_action_plans(limit: int = Query(default=20, ge=1, le=200)) -> list[dict[str, Any]]:
    plans_dir = settings.vault / "action_plans"
    if not plans_dir.exists():
        return []
    plans: list[dict[str, Any]] = []
    for md in sorted(plans_dir.glob("*.md"), reverse=True)[:limit]:
        try:
            post = frontmatter.load(md)
        except Exception:
            continue
        plans.append(
            {
                "path": str(md.relative_to(settings.vault)),
                "metadata": post.metadata,
                "content": post.content,
            }
        )
    return plans


@app.get("/graph")
def graph_snapshot(limit: int = Query(default=200, ge=1, le=2000)) -> dict[str, Any]:
    """Return graph metrics from Neo4j when available, else from proposed queue."""
    try:
        from neo4j import GraphDatabase
    except Exception:
        return _proposed_snapshot(limit)

    try:
        driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        with driver.session() as session:
            nodes = [
                dict(record["e"])
                for record in session.run(
                    "MATCH (e:Entity) RETURN e LIMIT $limit", limit=limit
                )
            ]
            edges = [
                {
                    "source": record["source_id"],
                    "target": record["target_id"],
                    "type": record["rel"],
                }
                for record in session.run(
                    "MATCH (a:Entity)-[r]->(b:Entity) "
                    "RETURN a.id AS source_id, b.id AS target_id, type(r) AS rel LIMIT $limit",
                    limit=limit,
                )
            ]
        driver.close()
        return {"source": "neo4j", "nodes": nodes, "edges": edges}
    except Exception:
        return _proposed_snapshot(limit)


def _proposed_snapshot(limit: int) -> dict[str, Any]:
    proposed_dir = settings.vault / "proposed"
    latest: Optional[Path] = None
    if proposed_dir.exists():
        files = sorted(proposed_dir.glob("sync-*.json"), reverse=True)
        latest = files[0] if files else None
    if not latest:
        return {"source": "empty", "nodes": [], "edges": []}
    import json

    payload = json.loads(latest.read_text(encoding="utf-8"))
    return {
        "source": f"proposed:{latest.name}",
        "nodes": payload.get("nodes", [])[:limit],
        "edges": payload.get("edges", [])[:limit],
    }
