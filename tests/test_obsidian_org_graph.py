"""Org frontmatter → Neo4j proposals (REPORTS_TO, MEMBER_OF, rank, org_unit)."""
from __future__ import annotations

from pathlib import Path

from services.api import vault
from services.api.obsidian_to_neo4j import build_proposals


def test_build_proposals_emits_org_edges_and_node_props(_isolated_vault: Path) -> None:
    _ = _isolated_vault
    unit = vault.create_stakeholder_note(
        name="Operations Unit",
        entity_type="Agency",
        source_lineage_entry={"type": "voice_ledger", "id": "t", "timestamp": vault.now_iso()},
    )
    mgr = vault.create_stakeholder_note(
        name="Pat Manager",
        entity_type="Person",
        source_lineage_entry={"type": "voice_ledger", "id": "t2", "timestamp": vault.now_iso()},
    )
    person = vault.create_stakeholder_note(
        name="Sam Engineer",
        entity_type="Person",
        source_lineage_entry={"type": "voice_ledger", "id": "t3", "timestamp": vault.now_iso()},
    )
    person.data["reports_to"] = "Pat Manager"
    person.data["department"] = "Operations Unit"
    person.data["rank"] = "Senior IC"
    vault.save_note(person)

    nodes, edges = build_proposals()
    node_by_id = {n.id: n for n in nodes}
    assert node_by_id[person.id].rank == "Senior IC"
    assert node_by_id[person.id].org_unit == "Operations Unit"

    rels = {(e.source_id, e.target_id, e.relationship) for e in edges}
    assert (person.id, mgr.id, "REPORTS_TO") in rels
    assert (person.id, unit.id, "MEMBER_OF") in rels
