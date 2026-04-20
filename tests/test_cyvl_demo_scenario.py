"""Cyvl demo scenario YAML structure."""
from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SCENARIO = ROOT / "demo" / "cyvl_fde_scenario.yaml"
SYSTEMS = ROOT / "demo" / "cyvl_fde_systems.yaml"


def test_cyvl_scenario_yaml_loads() -> None:
    data = yaml.safe_load(SCENARIO.read_text(encoding="utf-8"))
    assert data.get("anchor_date")
    assert len(data.get("stakeholders") or []) == 8
    assert data.get("hotspots")
    assert data.get("action_plan", {}).get("tasks")
    maria = next(s for s in data["stakeholders"] if s["name"] == "Maria Santos")
    assert len(maria.get("lineage") or []) >= 5


def test_cyvl_systems_yaml_loads() -> None:
    data = yaml.safe_load(SYSTEMS.read_text(encoding="utf-8"))
    assert len(data.get("systems") or []) >= 1
    assert len(data.get("uses") or []) >= 1
