"""End-to-end showstopper demo: transcription → vault → conflict → sync → Red Team."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agents import red_team_graph
from agents.telemetry import loader as telemetry_loader
from services.api import obsidian_to_neo4j
from services.api.config import settings
from services.api.ledger_processor import LedgerPayload, process_transcription


def seed_baseline(vault_root: Path) -> None:
    """Write a baseline Jane note with high sentiment so the next pass triggers a conflict."""
    from services.api import vault as vault_mod

    existing = vault_mod.find_by_name("Jane Commissioner")
    if existing:
        return
    vault_mod.create_stakeholder_note(
        name="Jane Commissioner",
        entity_type="Gatekeeper",
        source_lineage_entry={
            "type": "voice_ledger",
            "id": "baseline-meeting-001",
            "timestamp": vault_mod.now_iso(),
        },
        influence_score=0.9,
        sentiment_vector=0.95,
        confidence_score=0.6,
    )
    _ = vault_root


def main() -> None:
    parser = argparse.ArgumentParser(description="Pathfinder showstopper demo.")
    parser.add_argument(
        "--inbox",
        type=Path,
        default=ROOT / "inbox" / "sample-meeting-bad.txt",
        help="Transcription file to process.",
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Apply proposals to Neo4j (requires neo4j running).",
    )
    args = parser.parse_args()

    print(f"[1/5] Vault: {settings.vault}")
    seed_baseline(settings.vault)

    transcription = args.inbox.read_text(encoding="utf-8")
    payload = LedgerPayload(
        transcription=transcription,
        source_id=args.inbox.stem,
        source_type="voice_ledger",
    )
    response = process_transcription(payload)
    print(f"[2/5] Ledger: touched {len(response.files_touched)} files, "
          f"{len(response.conflicts)} conflict(s)")
    for entity in response.entities:
        print(f"    - {entity['name']} ({entity['type']}) "
              f"sentiment={entity['sentiment_vector']:.2f}")

    print("[3/5] Telemetry fixture -> vault/proposed/")
    telemetry_result = telemetry_loader.run(commit=args.commit)
    print(f"    proposed: {telemetry_result['proposed_path']}")

    print("[4/5] Obsidian -> Neo4j proposals")
    sync_result = obsidian_to_neo4j.sync(auto_commit=args.commit)
    print(json.dumps(sync_result, indent=2))

    print("[5/5] Red Team")
    red = red_team_graph.run_red_team({"raw_input": transcription})
    print(json.dumps({
        "hotspots": len(red.get("entities", [])),
        "plan_path": red.get("raw_input"),
        "conflict_detected": red.get("conflict_detected", False),
    }, indent=2))


if __name__ == "__main__":
    main()
