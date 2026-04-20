"""LangGraph Red Team: find Institutional Inertia and write an action plan."""
from __future__ import annotations

import argparse
import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Optional, TypedDict

from services.api import vault
from services.api.action_plans import RedTeamPlanSpec, RedTeamTaskSpec, build_markdown_file, spec_to_task_dicts
from services.api.config import settings

RED_TEAM_SYSTEM_PROMPT = (
    "You are a cynical Senior FDE at Cyvl. Analyze the incoming sentiment against the "
    "usage telemetry. If the sentiment is high but usage is zero, ignore the sentiment "
    "and flag the account as 'At Risk due to Institutional Inertia.' Identify the "
    "specific technical node causing the friction and recommend a concrete intervention "
    "(e.g. 'Send Network Engineer to validate upstream routing config')."
)


class AgentState(TypedDict, total=False):
    raw_input: str
    entities: list[dict[str, Any]]
    sentiment_delta: float
    conflict_detected: bool
    reconciliation_plan: str
    graph_update_required: bool
    structured_plan: dict[str, Any]


INERTIA_CYPHER = (
    "MATCH (e:Entity)-[u:USES]->(s:System) "
    "WHERE e.influence > $influence_threshold "
    "AND coalesce(u.telemetry_score, 0) < $usage_threshold "
    "RETURN e.id AS id, e.name AS name, e.influence AS influence, "
    "e.sentiment AS sentiment, u.telemetry_score AS telemetry, "
    "s.name AS system_name ORDER BY e.influence DESC LIMIT 10"
)


def _inertia_from_neo4j(influence_threshold: float, usage_threshold: float) -> list[dict[str, Any]]:
    try:
        from neo4j import GraphDatabase
    except Exception:
        return []
    try:
        driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        with driver.session() as session:
            records = session.run(
                INERTIA_CYPHER,
                influence_threshold=influence_threshold,
                usage_threshold=usage_threshold,
            )
            out = [dict(r) for r in records]
        driver.close()
        return out
    except Exception:
        return []


def _inertia_from_proposed(
    influence_threshold: float, usage_threshold: float
) -> list[dict[str, Any]]:
    proposed_dir = settings.vault / "proposed"
    if not proposed_dir.exists():
        return []

    system_names: dict[str, str] = {}
    uses: list[dict[str, Any]] = []
    for path in sorted(proposed_dir.glob("telemetry-*.json"), reverse=True):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for system in payload.get("systems", []):
            system_names[system["id"]] = system["name"]
        uses.extend(payload.get("uses", []))
        break

    notes_by_id: dict[str, vault.StakeholderNote] = {
        note.id: note for note in vault.iter_stakeholder_notes()
    }

    results: list[dict[str, Any]] = []
    for use in uses:
        note = notes_by_id.get(use["source_id"])
        if not note:
            continue
        influence = float(note.data.get("influence_score", 0.5))
        if influence <= influence_threshold:
            continue
        telemetry = float(use.get("telemetry_score", 0.0))
        if telemetry >= usage_threshold:
            continue
        results.append(
            {
                "id": note.id,
                "name": note.name,
                "influence": influence,
                "sentiment": float(note.data.get("sentiment_vector", 0.5)),
                "telemetry": telemetry,
                "system_name": system_names.get(use["system_id"], use["system_id"]),
            }
        )
    results.sort(key=lambda item: item["influence"], reverse=True)
    return results[:10]


def find_inertia(
    influence_threshold: float = 0.6, usage_threshold: float = 0.2
) -> list[dict[str, Any]]:
    neo = _inertia_from_neo4j(influence_threshold, usage_threshold)
    if neo:
        return neo
    return _inertia_from_proposed(influence_threshold, usage_threshold)


def _heuristic_narrative(hotspot: dict[str, Any]) -> str:
    return (
        f"**{hotspot['name']}** wields influence {hotspot['influence']:.2f} yet telemetry "
        f"on {hotspot['system_name']} is {hotspot['telemetry']:.2f}. Sentiment of "
        f"{hotspot['sentiment']:.2f} is noise — flag as 'At Risk due to Institutional "
        f"Inertia.' Dispatch a Network Engineer to validate the {hotspot['system_name']} "
        "integration path and unblock actual usage before the next executive review."
    )


def _heuristic_plan_spec(hotspots: list[dict[str, Any]]) -> RedTeamPlanSpec:
    tasks: list[RedTeamTaskSpec] = []
    for i, h in enumerate(hotspots):
        due = (date.today() + timedelta(days=7 + i * 2)).isoformat()
        tasks.append(
            RedTeamTaskSpec(
                stakeholder_name=str(h.get("name") or "Unknown"),
                action=(
                    f"Schedule a working session on {h.get('system_name', 'system')} "
                    "integration and unblock measured usage."
                ),
                rationale=(
                    f"Influence {float(h.get('influence', 0.0)):.2f} vs telemetry "
                    f"{float(h.get('telemetry', 0.0)):.2f} — institutional inertia risk."
                ),
                due_by=due,
                priority="p0" if i == 0 else "p1",
            )
        )
    return RedTeamPlanSpec(
        summary=(
            "Institutional inertia detected: high-influence stakeholders show "
            "low product telemetry relative to their authority."
        ),
        tasks=tasks,
    )


def _llm_structured_plan(hotspots: list[dict[str, Any]]) -> Optional[RedTeamPlanSpec]:
    if not settings.openai_api_key or not hotspots:
        return None
    try:
        from langchain_core.messages import HumanMessage, SystemMessage
        from langchain_openai import ChatOpenAI
    except Exception:
        return None
    try:
        model = ChatOpenAI(
            model=settings.openai_model,
            api_key=settings.openai_api_key,
            temperature=0.2,
        )
        structured = model.with_structured_output(RedTeamPlanSpec)
        return structured.invoke(
            [
                SystemMessage(
                    content=(
                        RED_TEAM_SYSTEM_PROMPT
                        + " Respond with structured output: a short summary (2-3 sentences) "
                        "and 3-5 tasks. Each task must have stakeholder_name matching a hotspot "
                        "name, a concrete imperative action, rationale, due_by as ISO date "
                        "within 14 days, and priority p0/p1/p2."
                    )
                ),
                HumanMessage(content=json.dumps(hotspots, indent=2)),
            ]
        )
    except Exception:
        return None


def _llm_narrative(hotspots: list[dict[str, Any]]) -> Optional[str]:
    if not settings.openai_api_key or not hotspots:
        return None
    try:
        from langchain_core.messages import HumanMessage, SystemMessage
        from langchain_openai import ChatOpenAI
    except Exception:
        return None
    try:
        model = ChatOpenAI(
            model=settings.openai_model,
            api_key=settings.openai_api_key,
            temperature=0.2,
        )
        response = model.invoke(
            [
                SystemMessage(content=RED_TEAM_SYSTEM_PROMPT),
                HumanMessage(
                    content=(
                        "Hotspots (high influence, low telemetry):\n"
                        + json.dumps(hotspots, indent=2)
                        + "\n\nWrite a markdown action plan: bullet per hotspot, "
                        "concrete intervention, and a single overall next step."
                    )
                ),
            ]
        )
    except Exception:
        return None
    return getattr(response, "content", None)


def persist_red_team_snapshot(
    hotspots: list[dict[str, Any]], plan_path: Optional[Path]
) -> None:
    """Write machine-readable state for the Today view + external notifications."""
    state_dir = settings.vault / ".state"
    state_dir.mkdir(parents=True, exist_ok=True)
    rel_plan = ""
    if plan_path is not None:
        try:
            rel_plan = str(plan_path.resolve().relative_to(settings.vault))
        except ValueError:
            rel_plan = str(plan_path)
    snapshot: dict[str, Any] = {
        "run_at": vault.now_iso(),
        "plan_path": rel_plan or None,
        "hotspots": [
            {
                "id": h.get("id"),
                "name": h.get("name"),
                "influence": h.get("influence"),
                "usage": h.get("telemetry"),
                "sentiment": h.get("sentiment"),
                "system_name": h.get("system_name"),
                "reason": "high influence, low telemetry",
            }
            for h in hotspots
        ],
    }
    out = state_dir / "last_red_team.json"
    out.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")


def write_action_plan(
    narrative: str,
    hotspots: list[dict[str, Any]],
    plan_spec: RedTeamPlanSpec,
) -> Path:
    task_dicts = spec_to_task_dicts(plan_spec, hotspots)
    text = build_markdown_file(
        summary=plan_spec.summary.strip()
        or f"Pathfinder action plan — {len(hotspots)} hotspot(s).",
        narrative=narrative.strip(),
        hotspots=hotspots,
        task_dicts=task_dicts,
    )
    action_dir = settings.vault / "action_plans"
    action_dir.mkdir(parents=True, exist_ok=True)
    path = action_dir / f"Pathfinder-Action-Plan-{date.today().isoformat()}.md"
    path.write_text(text, encoding="utf-8")
    return path


def build_graph():
    """Assemble the LangGraph state machine.

    We expose a callable `run` that mirrors the compiled graph; if langgraph is
    installed we compile a real StateGraph, otherwise we fall back to sequential
    execution so the pipeline still works.
    """

    def node_query(state: AgentState) -> AgentState:
        hotspots = find_inertia()
        state["entities"] = hotspots
        state["graph_update_required"] = bool(hotspots)
        return state

    def node_red_team(state: AgentState) -> AgentState:
        hotspots = state.get("entities", [])
        plan_spec = _llm_structured_plan(hotspots)
        if not plan_spec or not plan_spec.tasks:
            plan_spec = _heuristic_plan_spec(hotspots)
        narrative = _llm_narrative(hotspots)
        if not narrative:
            narrative = "\n\n".join(_heuristic_narrative(h) for h in hotspots) or (
                "No hotspots detected. Graph is healthy relative to current thresholds."
            )
        state["reconciliation_plan"] = narrative
        state["structured_plan"] = plan_spec.model_dump()
        state["conflict_detected"] = bool(hotspots)
        return state

    def node_write(state: AgentState) -> AgentState:
        hotspots = state.get("entities", [])
        narrative = state.get("reconciliation_plan", "")
        raw_spec = state.get("structured_plan")
        plan_spec: Optional[RedTeamPlanSpec] = None
        if raw_spec:
            try:
                plan_spec = RedTeamPlanSpec.model_validate(raw_spec)
            except Exception:
                plan_spec = None
        if hotspots and not plan_spec:
            plan_spec = _heuristic_plan_spec(hotspots)
        plan_path: Optional[Path] = None
        if hotspots and plan_spec:
            plan_path = write_action_plan(narrative, hotspots, plan_spec)
            state["raw_input"] = str(plan_path)
        persist_red_team_snapshot(hotspots, plan_path)
        return state

    try:
        from langgraph.graph import END, StateGraph

        graph = StateGraph(AgentState)
        graph.add_node("query", node_query)
        graph.add_node("red_team", node_red_team)
        graph.add_node("write", node_write)
        graph.set_entry_point("query")
        graph.add_edge("query", "red_team")
        graph.add_edge("red_team", "write")
        graph.add_edge("write", END)
        compiled = graph.compile()

        def run(initial: Optional[AgentState] = None) -> AgentState:
            return compiled.invoke(initial or {})

        return run
    except Exception:
        def run(initial: Optional[AgentState] = None) -> AgentState:
            state: AgentState = initial or {}
            state = node_query(state)
            state = node_red_team(state)
            state = node_write(state)
            return state

        return run


def run_red_team(initial: Optional[AgentState] = None) -> AgentState:
    return build_graph()(initial)


def _cli() -> None:
    parser = argparse.ArgumentParser(description="Run the Pathfinder Red Team.")
    parser.add_argument("--input", default="", help="Optional seed transcription to log.")
    args = parser.parse_args()
    state: AgentState = {"raw_input": args.input}
    result = run_red_team(state)
    print(json.dumps({
        "hotspots": len(result.get("entities", [])),
        "plan_path": result.get("raw_input"),
        "conflict_detected": result.get("conflict_detected", False),
    }, indent=2))


if __name__ == "__main__":
    _cli()
