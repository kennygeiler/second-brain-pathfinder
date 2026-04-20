# Pathfinder Project Memory

Last updated: 2026-04-20

This file is a practical handoff for continuing work quickly (human or agent).

## 1) Product Intent (current)

Pathfinder is moving toward a weekly operating system for account execution:

1. ingest stakeholder signal,
2. identify adoption/org risk,
3. assign actions,
4. track movement over time.

Primary UX should answer:

- What is most urgent now?
- What action is due next?
- Are we trending in the right direction?

## 2) Current Implementation Status

### Completed recently

- Org-aware graph sync and map relationship filters:
  - `REPORTS_TO`, `MEMBER_OF`, `rank`, `org_unit`
  - filter modes: `all/org/product/combined`
- Graph payload normalization for proposed snapshots (`source/target/type`).
- Graph readability improvements:
  - auto-fit framing, reset behavior, overlay alignment, in-UI "how to read".
- P0 data correctness:
  - stale-contact now uses contact semantics (not profile-edit semantics).
  - conflict filenames are unique (no same-day overwrite).
- Red Team run history:
  - append snapshots to `vault/.state/red_team_runs/`.
- New first-class Actions API:
  - `POST /actions`
  - `PATCH /actions/{id}`
  - `GET /actions`
- New Progress APIs:
  - `GET /progress/summary`
  - `GET /progress/timeline`
  - `GET /stakeholders/{id}/progress`
- New `GET /network/insights` endpoint.
- Dashboard load is now partial-failure tolerant (`Promise.allSettled`).
- New Progress tab added in UI (first cut).

### Tests

- Current suite passing in local venv context:
  - `make test` -> 31 passed (warnings only from pytest cache perms in this environment).
- Added test file:
  - `tests/test_progress_actions.py`

## 3) Known Environment Gotchas (important)

- If API health shows vault path under `/path/to/...`, shell env is overriding `.env`.
  - Fix: `unset VAULT_PATH` then `export VAULT_PATH="$PWD/vault"` from repo root.
- `make demo-cyvl-reset(-neo4j)` expects writable `vault/` and valid Docker/Neo4j availability.
- In this agent environment, git writes may fail with:
  - `.git/index.lock: Operation not permitted`
  - If that happens, run git commands directly in user terminal.

## 4) Repo Navigation (where to look first)

### Backend

- API entrypoint/routes:
  - `services/api/main.py`
- Vault note model + mutation semantics:
  - `services/api/vault.py`
- Today aggregation:
  - `services/api/today.py`
- Moments timeline aggregation:
  - `services/api/moments.py`
- Conflict detection:
  - `services/api/conflict_detector.py`
- Ledger ingest/preview:
  - `services/api/ledger_processor.py`
- Graph sync:
  - `services/api/obsidian_to_neo4j.py`
- Actions store logic:
  - `services/api/actions.py`
- Progress aggregates:
  - `services/api/progress.py`

### Frontend

- Main app orchestration / tab routing:
  - `dashboard/src/App.tsx`
- API client types + endpoint calls:
  - `dashboard/src/api.ts`
- Live graph renderer:
  - `dashboard/src/components/LiveGraph.tsx`
- Graph pages:
  - `dashboard/src/pencil/CityIntelligenceMap.tsx`
  - (`CityNavigationMap.tsx` still exists but top nav now favors single network surface)
- Stakeholder workspace:
  - `dashboard/src/pencil/StakeholderAuditDashboard.tsx`
- Capture:
  - `dashboard/src/pencil/CaptureTab.tsx`
- Health matrix:
  - `dashboard/src/pencil/ExecutiveHealthMatrix.tsx`
- Moments:
  - `dashboard/src/components/MomentsOverview.tsx`

### Demo / scripts

- Reset + seed scenario:
  - `scripts/reset_and_seed_cyvl_demo.py`
- Scenario fixture:
  - `demo/cyvl_fde_scenario.yaml`

## 5) What Should Happen Next (recommended order)

### Next UI tranche

1. Expand `Progress` tab into full view:
   - trend lines for 30/90/180,
   - intervention impact table,
   - top movers.
2. Add Stakeholder Progress panel in audit view:
   - use `GET /stakeholders/{id}/progress`.
3. Fully consolidate to one graph tab:
   - remove duplicate graph route/components from top-level flow,
   - use `GET /network/insights`.

### Next backend tranche

1. Add richer delta math in `services/api/progress.py` (currently first-cut).
2. Add explicit action-plan -> actions promotion path in UI and API glue.
3. Harden event history model for robust trend reconstruction.

## 6) Working Commands

From repo root (`pathfinder-core`):

- Start dev:
  - `make dev`
- Run tests:
  - `make test`
- Typecheck dashboard:
  - `cd dashboard && npx tsc --noEmit`
- Reset demo vault:
  - `make demo-cyvl-reset`
- Reset demo + Neo4j commit:
  - `make neo4j-up && make demo-cyvl-reset-neo4j`

## 7) Current Branch Hygiene Notes

- If committing current in-progress work, include:
  - `services/api/actions.py`
  - `services/api/progress.py`
  - `tests/test_progress_actions.py`
  - plus touched API/UI files in `git status`.
- If git lock permission appears, commit/push via local terminal.

