"""Sync Obsidian vault → Neo4j master graph via a staged Proposed Changes queue."""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

from . import vault
from .config import settings


@dataclass
class NodeProposal:
    kind: str
    id: str
    name: str
    type: str
    influence: float
    sentiment: float

    def cypher(self) -> tuple[str, dict[str, Any]]:
        query = (
            "MERGE (e:Entity {id: $id}) "
            "SET e.name = $name, e.type = $type, e.influence = $influence, e.sentiment = $sentiment"
        )
        return query, asdict(self) | {}


@dataclass
class EdgeProposal:
    kind: str
    source_id: str
    target_id: str
    target_name: str
    relationship: str

    def cypher(self) -> tuple[str, dict[str, Any]]:
        rel = _sanitize_rel(self.relationship)
        query = (
            "MERGE (t:Entity {id: $target_id}) "
            "ON CREATE SET t.name = $target_name, t.type = 'Unknown', "
            "t.influence = 0.5, t.sentiment = 0.5 "
            "WITH t MATCH (s:Entity {id: $source_id}) "
            f"MERGE (s)-[:{rel}]->(t)"
        )
        return query, {
            "source_id": self.source_id,
            "target_id": self.target_id,
            "target_name": self.target_name,
        }


_ALLOWED_RELS = {"REPORTS_TO", "INFLUENCES", "BLOCKS", "USES", "LINKS_TO"}


def _sanitize_rel(name: str) -> str:
    upper = name.strip().upper().replace("-", "_").replace(" ", "_")
    return upper if upper in _ALLOWED_RELS else "LINKS_TO"


def _target_id_for_link(link: str) -> tuple[str, str]:
    """Resolve a wiki-link target to an entity id, preferring an existing note."""
    note = vault.find_by_name(link)
    if note is not None:
        return note.id, note.name
    return f"ghost::{vault.slugify(link)}", link


def build_proposals() -> tuple[list[NodeProposal], list[EdgeProposal]]:
    nodes: list[NodeProposal] = []
    edges: list[EdgeProposal] = []

    for note in vault.iter_stakeholder_notes(include_conflicts=False):
        data = note.data
        nodes.append(
            NodeProposal(
                kind="node",
                id=note.id,
                name=note.name,
                type=str(data.get("type", "Person")),
                influence=float(data.get("influence_score", 0.5)),
                sentiment=float(data.get("sentiment_vector", 0.5)),
            )
        )
        for link in vault.extract_wiki_links(note.post.content):
            target_id, target_name = _target_id_for_link(link)
            edges.append(
                EdgeProposal(
                    kind="edge",
                    source_id=note.id,
                    target_id=target_id,
                    target_name=target_name,
                    relationship="LINKS_TO",
                )
            )

    return nodes, edges


def write_proposed_queue(
    nodes: Iterable[NodeProposal], edges: Iterable[EdgeProposal]
) -> Path:
    proposed_dir = settings.vault / "proposed"
    proposed_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = proposed_dir / f"sync-{stamp}.json"
    payload = {
        "generated_at": vault.now_iso(),
        "nodes": [asdict(n) for n in nodes],
        "edges": [asdict(e) for e in edges],
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def apply_to_neo4j(
    nodes: Iterable[NodeProposal], edges: Iterable[EdgeProposal]
) -> dict[str, int]:
    try:
        from neo4j import GraphDatabase
    except Exception as exc:
        raise RuntimeError("neo4j driver not installed") from exc

    driver = GraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password),
    )
    counts = {"nodes": 0, "edges": 0}
    try:
        with driver.session() as session:
            session.run(
                "CREATE CONSTRAINT entity_id IF NOT EXISTS "
                "FOR (e:Entity) REQUIRE e.id IS UNIQUE"
            )
            for node in nodes:
                query, params = node.cypher()
                session.run(query, **params)
                counts["nodes"] += 1
            for edge in edges:
                query, params = edge.cypher()
                session.run(query, **params)
                counts["edges"] += 1
    finally:
        driver.close()
    return counts


def sync(auto_commit: Optional[bool] = None) -> dict[str, Any]:
    commit = settings.auto_commit if auto_commit is None else auto_commit
    nodes, edges = build_proposals()
    proposed_path = write_proposed_queue(nodes, edges)
    result: dict[str, Any] = {
        "proposed_path": str(proposed_path),
        "node_count": len(nodes),
        "edge_count": len(edges),
        "committed": False,
    }
    if commit:
        counts = apply_to_neo4j(nodes, edges)
        result["committed"] = True
        result["applied"] = counts
    return result


def _cli() -> None:
    parser = argparse.ArgumentParser(description="Sync Obsidian vault to Neo4j.")
    parser.add_argument("--commit", action="store_true", help="Apply proposals to Neo4j.")
    args = parser.parse_args()
    result = sync(auto_commit=args.commit)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    _cli()
