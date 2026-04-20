"""FastAPI entry point: ledger webhook, sync trigger, dashboard BFF."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

import frontmatter
from fastapi import FastAPI, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import (
    action_plans,
    actions as actions_mod,
    moments as moments_mod,
    obsidian_to_neo4j,
    progress as progress_mod,
    today as today_mod,
    vault,
)
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
    reports_to: Optional[str] = None
    department: Optional[str] = None
    org_unit: Optional[str] = None
    rank: Optional[str] = None


class NotesBody(BaseModel):
    content: str


class MergeBody(BaseModel):
    target_id: str


class ActionPlanTaskPatch(BaseModel):
    """Toggle a structured task checkbox on an action plan note."""

    path: str = Field(description="Path relative to vault, e.g. action_plans/Pathfinder-Action-Plan-2026-04-19.md")
    idx: int = Field(ge=0)
    status: Literal["todo", "done", "skipped"]


class ActionCreateBody(BaseModel):
    title: str
    stakeholder_id: Optional[str] = None
    system_id: Optional[str] = None
    priority: Literal["p0", "p1", "p2"] = "p1"
    owner: Optional[str] = None
    due_by: Optional[str] = None
    status: Literal["todo", "in_progress", "done", "skipped"] = "todo"
    outcome_note: Optional[str] = None
    source: Optional[dict[str, Any]] = None
    completed_at: Optional[str] = None


class ActionPatchBody(BaseModel):
    status: Optional[Literal["todo", "in_progress", "done", "skipped"]] = None
    outcome_note: Optional[str] = None
    owner: Optional[str] = None
    due_by: Optional[str] = None
    priority: Optional[Literal["p0", "p1", "p2"]] = None
    title: Optional[str] = None
    completed_at: Optional[str] = None


def _serialize_detail(note: vault.StakeholderNote) -> dict[str, Any]:
    return {
        "id": note.id,
        "name": note.name,
        "metadata": jsonable_encoder(note.data),
        "content": note.post.content,
        "path": vault.relpath_under_vault(note.path),
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
    payload = today_mod.build_today_payload(stale_days=settings.stale_days)
    return jsonable_encoder(payload)


@app.get("/moments")
def get_moments(year: Optional[int] = Query(default=None, ge=2000, le=2100)) -> dict[str, Any]:
    """Stakeholder lineage + conflicts + last Red Team run, bucketed by calendar day."""
    y = year if year is not None else datetime.now(timezone.utc).year
    return jsonable_encoder(moments_mod.collect_moments(y))


@app.get("/progress/summary")
def get_progress_summary(window: int = Query(default=30, ge=7, le=365)) -> dict[str, Any]:
    return jsonable_encoder(progress_mod.summary(window))


@app.get("/progress/timeline")
def get_progress_timeline(
    window: int = Query(default=90, ge=7, le=365),
    bucket: Literal["day", "week"] = Query(default="week"),
) -> dict[str, Any]:
    return jsonable_encoder(progress_mod.timeline(window_days=window, bucket=bucket))


@app.get("/stakeholders/{entity_id}/progress")
def get_stakeholder_progress(
    entity_id: str,
    window: int = Query(default=180, ge=30, le=730),
) -> dict[str, Any]:
    payload = progress_mod.stakeholder_progress(entity_id, window_days=window)
    if payload is None:
        raise HTTPException(status_code=404, detail="stakeholder not found")
    return jsonable_encoder(payload)


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
            plan_path = vault.relpath_under_vault(Path(plan_path_raw))
        except Exception:
            plan_path = str(plan_path_raw)

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
        blockers = data.get("technical_blockers") or []
        if not isinstance(blockers, list):
            blockers = []
        results.append(
            {
                "id": note.id,
                "name": note.name,
                "type": data.get("type"),
                "influence_score": data.get("influence_score"),
                "sentiment_vector": data.get("sentiment_vector"),
                "confidence_score": data.get("confidence_score"),
                "technical_blockers": blockers,
                "path": vault.relpath_under_vault(note.path),
            }
        )
    return jsonable_encoder(results)


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
        "archived_to": vault.relpath_under_vault(new_path),
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
                "path": vault.relpath_under_vault(md),
                "metadata": jsonable_encoder(post.metadata or {}),
                "content": post.content,
            }
        )
    return jsonable_encoder(items)


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
                "path": vault.relpath_under_vault(md),
                "metadata": jsonable_encoder(post.metadata or {}),
                "content": post.content,
            }
        )
    return jsonable_encoder(plans)


@app.post("/actions")
def create_action(body: ActionCreateBody) -> dict[str, Any]:
    try:
        return jsonable_encoder(actions_mod.create_action(settings.vault, body.model_dump(exclude_none=True)))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.patch("/actions/{action_id}")
def patch_action(action_id: str, body: ActionPatchBody) -> dict[str, Any]:
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="empty patch")
    try:
        return jsonable_encoder(actions_mod.patch_action(settings.vault, action_id, patch))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="action not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/actions")
def list_actions(
    status: Optional[str] = Query(default=None),
    owner: Optional[str] = Query(default=None),
    stakeholder_id: Optional[str] = Query(default=None),
) -> list[dict[str, Any]]:
    return jsonable_encoder(
        actions_mod.list_actions(
            settings.vault,
            status=status,
            owner=owner,
            stakeholder_id=stakeholder_id,
        )
    )


def _jsonify_graph_value(val: Any) -> Any:
    """Make Neo4j property values and nested structures JSON-serializable for FastAPI."""
    if val is None or isinstance(val, (str, int, float, bool)):
        return val
    if isinstance(val, dict):
        return {str(k): _jsonify_graph_value(v) for k, v in val.items()}
    if isinstance(val, (list, tuple)):
        return [_jsonify_graph_value(v) for v in val]
    return str(val)


def _neo4j_entity_props(node: Any) -> dict[str, Any]:
    """Extract Entity node properties without assuming dict(node) works across driver versions."""
    try:
        raw = dict(node)
    except Exception:
        try:
            raw = {k: node.get(k) for k in node.keys()}  # type: ignore[attr-defined]
        except Exception:
            return {}
    return {str(k): _jsonify_graph_value(v) for k, v in raw.items()}


def _normalize_proposed_node(node: Any) -> dict[str, Any]:
    """Map staged sync JSON node fields to the shape the dashboard expects."""
    if not isinstance(node, dict):
        return {}
    out = {str(k): _jsonify_graph_value(v) for k, v in node.items()}
    if "influence" not in out and "influence_score" in out:
        out["influence"] = out.get("influence_score")
    if "sentiment" not in out and "sentiment_vector" in out:
        out["sentiment"] = out.get("sentiment_vector")
    return out


def _normalize_proposed_edge(edge: Any) -> dict[str, Any]:
    """Map staged sync JSON edges (source_id + relationship) to LiveGraph's source/type."""
    if not isinstance(edge, dict):
        return {}
    src = edge.get("source") if edge.get("source") is not None else edge.get("source_id")
    tgt = edge.get("target") if edge.get("target") is not None else edge.get("target_id")
    rel = edge.get("type") if edge.get("type") is not None else edge.get("relationship")
    if src is None or tgt is None:
        return {}
    typ = str(rel or "LINKS_TO").strip().upper().replace(" ", "_").replace("-", "_")
    return {
        "source": _jsonify_graph_value(src),
        "target": _jsonify_graph_value(tgt),
        "type": typ,
    }


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
            nodes = []
            for record in session.run(
                "MATCH (e:Entity) RETURN e LIMIT $limit", limit=limit
            ):
                nodes.append(_neo4j_entity_props(record["e"]))
            edges = [
                {
                    "source": _jsonify_graph_value(record["source_id"]),
                    "target": _jsonify_graph_value(record["target_id"]),
                    "type": _jsonify_graph_value(record["rel"]),
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


@app.get("/network/insights")
def network_insights(
    mode: Literal["org", "product", "combined"] = Query(default="combined"),
    limit: int = Query(default=200, ge=1, le=2000),
) -> dict[str, Any]:
    graph = graph_snapshot(limit=limit)
    edges = graph.get("edges") or []
    org_types = {"REPORTS_TO", "MEMBER_OF"}
    product_types = {"USES", "BLOCKS", "INFLUENCES"}
    org_count = 0
    friction = 0
    for e in edges:
        if not isinstance(e, dict):
            continue
        rel = str(e.get("type") or "").upper()
        if rel in org_types:
            org_count += 1
        if rel in product_types or rel == "BLOCKS":
            friction += 1
    findings: list[dict[str, Any]] = []
    if org_count > 0:
        findings.append(
            {
                "id": "finding-org-1",
                "severity": "high" if org_count > 4 else "medium",
                "title": "Org bottlenecks detected",
                "why": f"{org_count} reporting/membership edges shape decision flow.",
                "recommended_action": "Confirm escalation path and owner for the top bottleneck.",
                "owner": "Account lead",
                "due_by": "",
            }
        )
    if friction > 0:
        findings.append(
            {
                "id": "finding-prod-1",
                "severity": "high" if friction > 3 else "medium",
                "title": "Adoption friction cluster",
                "why": f"{friction} product-friction edges indicate weak workflow adoption.",
                "recommended_action": "Run one unblock session with the highest influence stakeholder.",
                "owner": "FDE",
                "due_by": "",
            }
        )
    return jsonable_encoder(
        {
            "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "mode": mode,
            "graph": graph,
            "metrics": {
                "org_bottlenecks": org_count,
                "adoption_friction_edges": friction,
                "isolated_high_influence_nodes": 0,
            },
            "top_findings": findings,
        }
    )


def _proposed_snapshot(limit: int) -> dict[str, Any]:
    proposed_dir = settings.vault / "proposed"
    latest: Optional[Path] = None
    if proposed_dir.exists():
        files = sorted(proposed_dir.glob("sync-*.json"), reverse=True)
        latest = files[0] if files else None
    if not latest:
        return {"source": "empty", "nodes": [], "edges": []}
    import json

    try:
        payload = json.loads(latest.read_text(encoding="utf-8"))
    except Exception:
        return {"source": "empty", "nodes": [], "edges": []}
    if not isinstance(payload, dict):
        return {"source": "empty", "nodes": [], "edges": []}
    raw_nodes = payload.get("nodes") or []
    raw_edges = payload.get("edges") or []
    nodes_in = raw_nodes[:limit] if isinstance(raw_nodes, list) else []
    edges_in = raw_edges[:limit] if isinstance(raw_edges, list) else []
    nodes_out = [_normalize_proposed_node(n) for n in nodes_in]
    edges_out: list[dict[str, Any]] = []
    for e in edges_in:
        ne = _normalize_proposed_edge(e)
        if ne:
            edges_out.append(ne)
    return {
        "source": f"proposed:{latest.name}",
        "nodes": nodes_out,
        "edges": edges_out,
    }
