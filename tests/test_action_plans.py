"""Structured action plans: YAML tasks, PATCH, open_tasks aggregation."""
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from services.api import action_plans
from services.api.config import settings
from services.api.main import app

client = TestClient(app)


def _minimal_plan_body() -> str:
    return """---
id: test-plan-id
generated_at: \"2026-04-19T12:00:00+00:00\"
hotspot_count: 1
plan_schema: 2
summary: Test summary
tasks:
  - idx: 0
    stakeholder_id: \"\"
    stakeholder_name: Jane Commissioner
    action: Schedule GIS review
    rationale: Low telemetry
    due_by: \"2026-04-25\"
    priority: p0
    status: todo
---

# Pathfinder Action Plan

Summary line

## Hotspots

- **Jane** — influence 0.9, telemetry 0.1 on GIS

## Tasks

- [ ] **P0** Schedule GIS review (due 2026-04-25) · _Jane Commissioner_
  _Low telemetry_

## Recommendation

Do the work.
"""


def test_collect_open_tasks(_isolated_vault: Path) -> None:
    plans = _isolated_vault / "action_plans"
    plans.mkdir(parents=True, exist_ok=True)
    p = plans / "Pathfinder-Action-Plan-test.md"
    p.write_text(_minimal_plan_body(), encoding="utf-8")

    open_t = action_plans.collect_open_tasks(limit=10)
    assert len(open_t) == 1
    assert open_t[0]["action"] == "Schedule GIS review"
    assert open_t[0]["idx"] == 0
    assert "action_plans/" in open_t[0]["plan_path"]


def test_collect_open_tasks_skips_bad_idx(_isolated_vault: Path) -> None:
    """Malformed task idx must not take down GET /today."""
    plans = _isolated_vault / "action_plans"
    plans.mkdir(parents=True, exist_ok=True)
    body = _minimal_plan_body().replace("idx: 0", "idx: null")
    p = plans / "Pathfinder-Action-Plan-badidx.md"
    p.write_text(body, encoding="utf-8")
    assert action_plans.collect_open_tasks(limit=10) == []


def test_patch_task_updates_yaml_and_body(_isolated_vault: Path) -> None:
    plans = _isolated_vault / "action_plans"
    plans.mkdir(parents=True, exist_ok=True)
    p = plans / "Pathfinder-Action-Plan-test.md"
    p.write_text(_minimal_plan_body(), encoding="utf-8")
    rel = str(p.relative_to(settings.vault))

    r = client.patch(
        "/action-plans/task",
        json={"path": rel, "idx": 0, "status": "done"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done"

    text = p.read_text(encoding="utf-8")
    assert "- [x]" in text or "[x]" in text
    assert action_plans.collect_open_tasks(limit=10) == []


def test_patch_task_404(_isolated_vault: Path) -> None:
    r = client.patch(
        "/action-plans/task",
        json={"path": "action_plans/missing.md", "idx": 0, "status": "done"},
    )
    assert r.status_code == 404
