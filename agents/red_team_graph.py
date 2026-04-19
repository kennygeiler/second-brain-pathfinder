"""LangGraph Red Team: find Institutional Inertia and write an action plan."""
from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path
from typing import Any, TypedDict

from services.api import vault
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


def _llm_narrative(hotspots: list[dict[str, Any]]) -> str | None:
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


def write_action_plan(narrative: str, hotspots: list[dict[str, Any]]) -> Path:
    action_dir = settings.vault / "action_plans"
    action_dir.mkdir(parents=True, exist_ok=True)
    path = action_dir / f"Pathfinder-Action-Plan-{date.today().isoformat()}.md"
    body = (
        "---\n"
        f"generated_at: \"{vault.now_iso()}\"\n"
        f"hotspot_count: {len(hotspots)}\n"
        "---\n\n"
        "# Pathfinder Action Plan\n\n"
        f"Generated {vault.now_iso()} — {len(hotspots)} institutional inertia hotspot(s).\n\n"
        "## Hotspots\n\n"
    )
    for hotspot in hotspots:
        body += (
            f"- **{hotspot['name']}** — influence {hotspot['influence']:.2f}, "
            f"telemetry {hotspot['telemetry']:.2f} on {hotspot['system_name']}\n"
        )
    body += "\n## Recommendation\n\n"
    body += narrative.strip() + "\n"
    path.write_text(body, encoding="utf-8")
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
        narrative = _llm_narrative(hotspots)
        if not narrative:
            narrative = "\n\n".join(_heuristic_narrative(h) for h in hotspots) or (
                "No hotspots detected. Graph is healthy relative to current thresholds."
            )
        state["reconciliation_plan"] = narrative
        state["conflict_detected"] = bool(hotspots)
        return state

    def node_write(state: AgentState) -> AgentState:
        hotspots = state.get("entities", [])
        narrative = state.get("reconciliation_plan", "")
        if hotspots:
            path = write_action_plan(narrative, hotspots)
            state["raw_input"] = str(path)
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

        def run(initial: AgentState | None = None) -> AgentState:
            return compiled.invoke(initial or {})

        return run
    except Exception:
        def run(initial: AgentState | None = None) -> AgentState:
            state: AgentState = initial or {}
            state = node_query(state)
            state = node_red_team(state)
            state = node_write(state)
            return state

        return run


def run_red_team(initial: AgentState | None = None) -> AgentState:
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
