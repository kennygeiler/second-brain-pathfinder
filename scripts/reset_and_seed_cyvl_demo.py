"""Wipe vault (except templates) + optional Neo4j, then seed the Cyvl FDE demo scenario.

Usage:
  python scripts/reset_and_seed_cyvl_demo.py
  python scripts/reset_and_seed_cyvl_demo.py --commit-neo4j

Requires VAULT_PATH / cwd vault. Does not call OpenAI.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Literal, Optional

import frontmatter
import yaml

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agents.telemetry import loader as telemetry_loader
from services.api import vault
from services.api.action_plans import RedTeamPlanSpec, RedTeamTaskSpec, build_markdown_file, spec_to_task_dicts
from services.api.config import settings
from services.api import obsidian_to_neo4j


SCENARIO_PATH = ROOT / "demo" / "cyvl_fde_scenario.yaml"
SYSTEMS_PATH = ROOT / "demo" / "cyvl_fde_systems.yaml"


def _die_vault_path(msg: str) -> None:
    print(msg, file=sys.stderr)
    print(
        "  Fix: use a real directory, e.g. from the repo root:\n"
        '    export VAULT_PATH="$PWD/vault"\n'
        "  Or unset VAULT_PATH so the default ./vault is used (relative to the process cwd).",
        file=sys.stderr,
    )
    sys.exit(1)


def ensure_vault_path_is_usable() -> Path:
    """Reject doc placeholders like /path/to/... and ensure the vault dir can be created."""
    raw = settings.vault_path
    expanded = raw.expanduser()
    s = str(expanded)
    # Common mistake: copying README examples literally.
    if s.startswith("/path/to") or "/path/to/" in s or s.strip() in {"/path", "/path/to"}:
        _die_vault_path(f"ERROR: VAULT_PATH looks like a placeholder, not a real path: {raw!r}")
    try:
        resolved = expanded.resolve()
    except OSError as exc:
        _die_vault_path(f"ERROR: cannot resolve VAULT_PATH {raw!r}: {exc}")

    try:
        resolved.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        _die_vault_path(f"ERROR: cannot create vault directory {resolved}: {exc}")
    return resolved


def clear_neo4j() -> bool:
    try:
        from neo4j import GraphDatabase
    except ImportError:
        print("    (neo4j driver not installed — skip DB clear)")
        return False
    try:
        driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        with driver.session() as session:
            session.run("MATCH (n) DETACH DELETE n")
        driver.close()
        print("    Neo4j: all nodes and relationships deleted.")
        return True
    except Exception as exc:
        print(f"    Neo4j clear failed (is the server running?): {exc}")
        return False


def reset_vault_files(vault_root: Path) -> None:
    """Remove stakeholder notes, conflicts, plans, proposed JSON, state — keep templates/."""
    for md in vault_root.rglob("*.md"):
        rel = md.relative_to(vault_root)
        if rel.parts and rel.parts[0] == "templates":
            continue
        md.unlink()

    for sub in ("proposed", "conflicts", "action_plans", ".state", "archive", "inbox"):
        d = vault_root / sub
        if not d.is_dir():
            continue
        for p in sorted(d.rglob("*"), reverse=True):
            if p.is_file():
                p.unlink()


def _max_lineage_ts(lineage: list[dict[str, Any]]) -> str:
    best = ""
    for entry in lineage:
        ts = str(entry.get("timestamp") or "")
        if ts > best:
            best = ts
    return best or vault.now_iso()


def write_stakeholder(note: dict[str, Any]) -> None:
    lineage = note.get("lineage") or []
    last_updated = _max_lineage_ts(lineage)
    meta: dict[str, Any] = {
        "id": note["id"],
        "name": note["name"],
        "type": note["type"],
        "influence_score": float(note["influence_score"]),
        "sentiment_vector": float(note["sentiment_vector"]),
        "confidence_score": float(note.get("confidence_score", 0.7)),
        "ghost": bool(note.get("ghost", False)),
        "last_updated": last_updated,
        "source_lineage": lineage,
        "technical_blockers": note.get("technical_blockers") or [],
    }
    body = (note.get("body") or f"# {note['name']}\n").rstrip() + "\n"
    post = frontmatter.Post(content=body, **meta)
    slug = vault.slugify(note["name"])
    path = settings.vault / f"{slug}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        frontmatter.dump(post, fh)


def write_conflict(row: dict[str, Any]) -> None:
    name = row["stakeholder_name"]
    note = vault.find_by_name(name)
    if not note:
        print(f"    Warning: conflict skipped — stakeholder not found: {name}")
        return
    slug = vault.slugify(name)
    suffix = row.get("file_suffix", "demo")
    path = settings.vault / "conflicts" / f"{slug}-CONFLICT-{suffix}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    prev = float(row["previous_sentiment"])
    new = float(row["new_sentiment"])
    delta = new - prev
    preview = str(row.get("body_preview", "")).strip()
    body = (
        "---\n"
        f'stakeholder: "{note.name}"\n'
        f'entity_id: "{note.id}"\n'
        f"previous_sentiment: {prev}\n"
        f"new_sentiment: {new}\n"
        f"delta: {delta:.3f}\n"
        f'created: "{row["created"]}"\n'
        "---\n\n"
        f"# Conflict — {note.name}\n\n"
        f"- Previous sentiment: **{prev:.2f}**\n"
        f"- New sentiment: **{new:.2f}**\n"
        f"- Delta: **{delta:+.2f}**\n\n"
        "## Reconciliation question\n\n"
        "Which signal reflects reality — field office narrative or executive sentiment?\n\n"
        "## Context excerpt\n\n"
        f"> {preview}\n"
    )
    path.write_text(body, encoding="utf-8")


def write_red_team_state(scenario: dict[str, Any], plan_rel: str) -> None:
    state_dir = settings.vault / ".state"
    state_dir.mkdir(parents=True, exist_ok=True)
    red = scenario.get("red_team") or {}
    hotspots_in = scenario.get("hotspots") or []
    hotspots_out: list[dict[str, Any]] = []
    for h in hotspots_in:
        tel = float(h.get("telemetry", h.get("usage", 0)))
        hotspots_out.append(
            {
                "id": h.get("id"),
                "name": h.get("name"),
                "influence": float(h.get("influence", 0)),
                "usage": tel,
                "sentiment": float(h.get("sentiment", 0.5)),
                "system_name": h.get("system_name", "—"),
                "reason": h.get("reason", "high influence, low telemetry"),
            }
        )
    snapshot = {
        "run_at": red.get("run_at") or vault.now_iso(),
        "plan_path": plan_rel,
        "hotspots": hotspots_out,
    }
    (state_dir / "last_red_team.json").write_text(json.dumps(snapshot, indent=2), encoding="utf-8")


def write_action_plan_file(scenario: dict[str, Any]) -> str:
    ap = scenario.get("action_plan") or {}
    tasks_raw = ap.get("tasks") or []
    pri: Literal["p0", "p1", "p2"]
    tasks: list[RedTeamTaskSpec] = []
    for t in tasks_raw:
        raw_pri = str(t.get("priority") or "p1").lower()
        if raw_pri == "p0":
            pri = "p0"
        elif raw_pri == "p2":
            pri = "p2"
        else:
            pri = "p1"
        tasks.append(
            RedTeamTaskSpec(
                stakeholder_name=str(t["stakeholder_name"]),
                action=str(t["action"]),
                rationale=str(t.get("rationale") or ""),
                due_by=str(t.get("due_by") or ""),
                priority=pri,
            )
        )
    plan_spec = RedTeamPlanSpec(
        summary=str(ap.get("summary") or "").strip(),
        tasks=tasks,
    )
    hotspots = scenario.get("hotspots") or []
    task_dicts = spec_to_task_dicts(plan_spec, hotspots)
    narrative = str(ap.get("narrative") or "").strip()
    text = build_markdown_file(
        summary=plan_spec.summary,
        narrative=narrative,
        hotspots=hotspots,
        task_dicts=task_dicts,
    )
    rel = str(scenario.get("red_team", {}).get("plan_relative_path") or "action_plans/Cyvl-Metro-Demo-Action-Plan-2026-04-18.md")
    path = settings.vault / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return rel


def seed_from_yaml(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def print_day_in_life(anchor: str) -> None:
    print(
        """
╔══════════════════════════════════════════════════════════════════╗
║  Cyvl FDE — suggested “day in the life” after seed               ║
╠══════════════════════════════════════════════════════════════════╣
║  1. Open Today — conflicts, open Red Team tasks, stale (David),  ║
║     ghosts (Legacy vendor), at-risk from last Red Team.           ║
║  2. Moments — scroll 6 months of lineage; click a day → ledger. ║
║  3. Capture — paste standup notes → Dry Run → Commit.            ║
║  4. Stakeholder — Maria Santos → ledger + conflict context.      ║
║  5. Risk Intel / Pathfinder Map — graph + telemetry edges.       ║
║  6. PATCH a task in Today or Obsidian to show closure.           ║
╚══════════════════════════════════════════════════════════════════╝
Anchor date in scenario: """
        + anchor
        + "\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset vault + Neo4j and seed Cyvl FDE demo.")
    parser.add_argument(
        "--commit-neo4j",
        action="store_true",
        help="After seeding, sync vault → Neo4j (applies nodes, edges, telemetry).",
    )
    parser.add_argument(
        "--no-clear-neo4j",
        action="store_true",
        help="Do not run MATCH (n) DETACH DELETE n before seeding.",
    )
    parser.add_argument(
        "--scenario",
        type=Path,
        default=SCENARIO_PATH,
        help="Path to cyvl_fde_scenario.yaml",
    )
    args = parser.parse_args()

    vault_root = ensure_vault_path_is_usable()
    print(f"Vault root: {vault_root}")
    print("[1/7] Resetting vault files (templates preserved)…")
    reset_vault_files(vault_root)

    if not args.no_clear_neo4j:
        print("[2/7] Clearing Neo4j…")
        clear_neo4j()
    else:
        print("[2/7] Skipping Neo4j clear (--no-clear-neo4j).")

    print("[3/7] Loading scenario YAML…")
    scenario = seed_from_yaml(args.scenario)
    anchor = str(scenario.get("anchor_date") or "")

    print("[4/7] Writing stakeholders + conflicts + action plan + Red Team snapshot…")
    for note in scenario.get("stakeholders") or []:
        write_stakeholder(note)
    for c in scenario.get("conflicts") or []:
        write_conflict(c)
    plan_rel = write_action_plan_file(scenario)
    write_red_team_state(scenario, plan_rel)

    print("[5/7] Telemetry proposal (demo/cyvl_fde_systems.yaml)…")
    telemetry_loader.run(fixture_path=SYSTEMS_PATH, commit=False)

    print("[6/7] Obsidian → proposed JSON + optional Neo4j Entity nodes…")
    sync_result = obsidian_to_neo4j.sync(auto_commit=args.commit_neo4j)
    print(json.dumps(sync_result, indent=2))

    if args.commit_neo4j:
        print("[7/7] Telemetry → Neo4j System nodes + USES edges…")
        tel = telemetry_loader.run(fixture_path=SYSTEMS_PATH, commit=True)
        print(json.dumps(tel, indent=2))

    print_day_in_life(anchor)
    print("Done. Start API + dashboard: make dev   or   make run")


if __name__ == "__main__":
    main()
