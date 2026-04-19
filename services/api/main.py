"""FastAPI entry point: ledger webhook, sync trigger, dashboard BFF."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import frontmatter
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import obsidian_to_neo4j, vault
from .config import settings
from .ledger_processor import router as ledger_router

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


@app.post("/sync")
def trigger_sync(commit: bool = False) -> dict[str, Any]:
    return obsidian_to_neo4j.sync(auto_commit=commit or settings.auto_commit)


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
    return {
        "id": note.id,
        "name": note.name,
        "metadata": note.data,
        "content": note.post.content,
        "path": str(note.path.relative_to(settings.vault)),
    }


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
    latest: Path | None = None
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
