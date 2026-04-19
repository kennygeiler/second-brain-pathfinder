"""Push seed telemetry into the vault `proposed/` queue (and optionally Neo4j)."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Optional

import yaml

from services.api import vault
from services.api.config import settings


def load_fixture(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def build_telemetry_proposal(fixture: dict[str, Any]) -> dict[str, Any]:
    system_nodes: list[dict[str, Any]] = []
    for system in fixture.get("systems", []):
        system_nodes.append(
            {
                "kind": "system",
                "id": system["id"],
                "name": system["name"],
            }
        )

    uses_edges: list[dict[str, Any]] = []
    for use in fixture.get("uses", []):
        note = vault.find_by_name(use["stakeholder_name"])
        source_id = note.id if note else f"ghost::{vault.slugify(use['stakeholder_name'])}"
        uses_edges.append(
            {
                "kind": "uses",
                "source_id": source_id,
                "source_name": use["stakeholder_name"],
                "system_id": use["system_id"],
                "telemetry_score": float(use.get("telemetry_score", 0.0)),
            }
        )

    return {
        "generated_at": vault.now_iso(),
        "systems": system_nodes,
        "uses": uses_edges,
    }


def write_proposal(proposal: dict[str, Any]) -> Path:
    proposed_dir = settings.vault / "proposed"
    proposed_dir.mkdir(parents=True, exist_ok=True)
    path = proposed_dir / f"telemetry-{vault.now_iso().replace(':', '-')}.json"
    path.write_text(json.dumps(proposal, indent=2), encoding="utf-8")
    return path


def commit_to_neo4j(proposal: dict[str, Any]) -> dict[str, int]:
    try:
        from neo4j import GraphDatabase
    except Exception as exc:
        raise RuntimeError("neo4j driver not installed") from exc

    counts = {"systems": 0, "uses": 0}
    driver = GraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_user, settings.neo4j_password),
    )
    try:
        with driver.session() as session:
            session.run(
                "CREATE CONSTRAINT system_id IF NOT EXISTS "
                "FOR (s:System) REQUIRE s.id IS UNIQUE"
            )
            for system in proposal.get("systems", []):
                session.run(
                    "MERGE (s:System {id: $id}) SET s.name = $name",
                    id=system["id"],
                    name=system["name"],
                )
                counts["systems"] += 1
            for use in proposal.get("uses", []):
                session.run(
                    "MERGE (e:Entity {id: $source_id}) "
                    "ON CREATE SET e.name = $source_name, e.type = 'Person', "
                    "e.influence = 0.5, e.sentiment = 0.5 "
                    "WITH e MATCH (s:System {id: $system_id}) "
                    "MERGE (e)-[r:USES]->(s) "
                    "SET r.telemetry_score = $score",
                    source_id=use["source_id"],
                    source_name=use["source_name"],
                    system_id=use["system_id"],
                    score=use["telemetry_score"],
                )
                counts["uses"] += 1
    finally:
        driver.close()
    return counts


def run(fixture_path: Optional[Path] = None, commit: bool = False) -> dict[str, Any]:
    path = fixture_path or (Path(__file__).parent / "systems.yaml")
    fixture = load_fixture(path)
    proposal = build_telemetry_proposal(fixture)
    proposed_path = write_proposal(proposal)
    result: dict[str, Any] = {"proposed_path": str(proposed_path), "committed": False}
    if commit:
        result["applied"] = commit_to_neo4j(proposal)
        result["committed"] = True
    return result


def _cli() -> None:
    parser = argparse.ArgumentParser(description="Load telemetry fixture.")
    parser.add_argument("--fixture", type=Path, default=None)
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(args.fixture, commit=args.commit), indent=2))


if __name__ == "__main__":
    _cli()
