# Pathfinder Core

**Pathfinder** is a filesystem-first **stakeholder intelligence engine** for Field Development Engineers (FDEs) covering city and agency accounts. It treats **Obsidian Markdown + YAML** as the source of truth, stages graph changes before they hit **Neo4j**, and uses **LangGraph** for **Red Team** analysis—high-influence actors who show **low product usage** (institutional inertia).

This README explains **what the product does**, **how an FDE should use it** to track and monitor a city account, and **how the pieces connect**.

---

## Table of contents

1. [Who this is for](#who-this-is-for)
2. [Core ideas](#core-ideas)
3. [Full feature set (what is wired)](#full-feature-set-what-is-wired)
4. [How an FDE should use Pathfinder for a city account](#how-an-fde-should-use-pathfinder-for-a-city-account)
5. [Technical layout & pipeline](#technical-layout--pipeline)
6. [Setup & environment](#setup--environment)
7. [Running locally](#running-locally)
8. [Verification & demos](#verification--demos)
9. [What is not built yet](#what-is-not-built-yet)
10. [Further reading](#further-reading)

---

## Who this is for

- **FDEs** who need a **single place** to see **who matters**, **how they feel**, **what is blocked**, and **where power ignores the product**—without losing the audit trail to a SaaS black box.
- Teams that already think in **notes + graph** (Obsidian-compatible Markdown) and want **Foundry-style lineage**: every change has a source.

---

## Core ideas

| Concept | Meaning |
|--------|---------|
| **Vault** | Directory of `.md` files with YAML frontmatter (`vault/`). The **authoritative** store for stakeholders, conflicts, proposed sync payloads, and action plans. |
| **Master graph** | **Neo4j** holds entities and relationships for analytics and the live dashboard maps. Sync is **staged** (`vault/proposed/`) before commit when you choose. |
| **Ledger** | Ingestion path from **meeting text** → extracted entities + sentiment → **new or updated stakeholder notes**. |
| **Conflict** | When **new sentiment** diverges enough from the **stored** baseline, a conflict note is created for human reconciliation. |
| **Red Team** | An automated pass that finds **high influence + low telemetry usage** (institutional inertia), writes a **Pathfinder Action Plan** Markdown file, and saves a **snapshot** for the **Today** view. |
| **Today** | Dashboard tab that **prioritizes**: open conflicts, last Red Team hotspots, **stale** contacts (no recent voice/email/meeting touch), and **ghost** nodes (cold-start or unverified). |

---

## Full feature set (what is wired)

### Ingestion & capture

- **POST `/ledger`** — Accepts a transcription and metadata (participants, location, meeting id, source type, optional `entities_override`).
- **POST `/ledger/preview`** — **Dry run**: extraction + conflict preview **without writing** to the vault.
- **Dashboard: Capture tab** — Paste transcript → **Dry Run** → editable entity table → **Commit** to vault. Optional **⌘↵** to preview from the textarea.
- **Extraction** — Uses **OpenAI** (when `OPENAI_API_KEY` is set) with a **heuristic fallback** when the key is absent.

### Conflicts & reconciliation

- **Conflict detector** — Compares incoming vs stored sentiment; over threshold → **Markdown file** under `vault/conflicts/` with YAML front matter.
- **Dashboard** — Surfaces conflicts in **Risk Intel**, **Stakeholder** audit view, **Today**, and **⌘K** search.

### Graph & sync

- **`obsidian_to_neo4j`** — Walks vault notes, builds **proposed** node/edge payloads, **optional** commit to Neo4j (`AUTO_COMMIT` / manual sync).
- **GET `/graph`** — Returns nodes/edges from **Neo4j** when available; otherwise from the **latest `vault/proposed/sync-*.json`** snapshot.

### Red Team

- **POST `/red-team`** — Runs the LangGraph pipeline (or sequential fallback): query inertia hotspots → narrative (LLM or heuristic) → **action plan** under `vault/action_plans/`.
- **Snapshot** — Every run writes **`vault/.state/last_red_team.json`** (run time, plan path, hotspots) for **Today → At risk**.
- **Dashboard** — **Run Red Team** from **Today** or **Initiate Strategic Pivot** from **Health Matrix**; same backend.

### Today (priority surface)

- **GET `/today`** — Aggregates: recent **conflicts**, **at-risk** rows from the last Red Team snapshot, **stale** stakeholders (configurable **`STALE_DAYS`**), **ghost** candidates.
- **Today tab** — Replaces a generic overview: date header, last Red Team summary, metric cards, **clickable rows** into the Stakeholder audit.

### Stakeholder CRUD (vault-native)

- **PATCH `/stakeholders/{id}`** — Update whitelisted YAML fields (type, influence, sentiment, blockers, etc.).
- **PUT `/stakeholders/{id}/notes`** — Replace Markdown **body** (private notes) under frontmatter.
- **POST `/stakeholders/{id}/merge`** — Merge one note into another; source **archived** under `vault/archive/`.
- **DELETE `/stakeholders/{id}`** — **Soft-delete** (archive file).
- **Dashboard** — Inline editing, notes editor, merge modal, archive—on **Stakeholder** tab.

### Search & navigation

- **⌘K / Ctrl+K** — Command palette over **loaded** stakeholders, conflicts, action plans (fuzzy match, grouped).
- **Tabs** — Today, Capture, Health Matrix, Stakeholder, Risk Intel, Pathfinder Map **live graph** (force layout, influence/sentiment coloring).

### Cold start & scripts

- **Firecrawl / PDF scripts** — Optional seeding of **ghost** stakeholders from public or PDF sources (require API keys / paths as documented in scripts).

---

## How an FDE should use Pathfinder for a city account

Think in **loops**: **map → capture → reconcile → graph → stress-test → prioritize**.

### 1. Cold start the map (week zero)

- Use **cold-start scripts** (Firecrawl, PDFs) or **manual** stakeholder notes so the vault is not empty.
- Mark uncertain actors as **ghost** or rely on **ghost heuristics** (cold lineage only) until you meet them.
- Run **sync** so **Neo4j** or **proposed** JSON reflects the map; open **Pathfinder Map** / **Risk Intel** to see topology.

### 2. Capture every meaningful meeting (ongoing)

- Open **Capture**; paste **Otter**, **Zoom transcript**, or raw notes.
- **Dry Run** → fix names, types, influence, sentiment, blockers in the **table** (LLMs err; **you** are the editor).
- **Commit** → notes update; **conflicts** appear automatically if sentiment **jumps** vs the last baseline.
- Use **participants / location / meeting id** for **auditability** in lineage.

### 3. Reconcile conflicts same day

- **Today** and **Stakeholder** show **conflict** context; use the reconciliation question to decide **ground truth**.
- Update the stakeholder record via **inline edit** or notes so the **vault** matches reality.

### 4. Keep the graph honest

- Use **wiki-links** in note bodies where your ontology supports it (edges flow from links + sync).
- After bulk edits, **sync** to refresh **Neo4j** / proposed snapshot so **graphs** match the vault.

### 5. Run Red Team on a rhythm (weekly / pre-QBR)

- **Run Red Team** from **Today** or **Pivot** from **Health Matrix**.
- Read the generated **action plan** in `vault/action_plans/`; **Today → At risk** lists the same hotspots **without** re-running queries.
- Use this to answer: *“Where does formal power ignore the product?”*

### 6. Monitor priority daily

- Start from **Today**: **conflicts** → **at risk** → **stale** → **ghosts**; click through to **Stakeholder**.
- Use **⌘K** to jump to a person or conflict file path without scrolling.

### 7. Deduplicate and clean (as needed)

- **Merge** duplicate stakeholders after capture mistakes; **archive** retired actors.
- Tune **`STALE_DAYS`** in `.env` to match **your** account motion (e.g. 30 vs 14 days).

### 8. Optional: external automation

- Call **`POST /ledger`** from **n8n** or another webhook when transcripts land in a shared drive—Pathfinder does not require it, but the API is ready.

---

## Technical layout & pipeline

```
pathfinder-core/
  .cursor/rules/pathfinder.mdc   # LLM guardrails
  schema.txt                      # Neo4j schema reference
  vault-schema.yaml               # Obsidian frontmatter contract
  docker-compose.yml              # Neo4j 5 + APOC + GDS
  vault/                          # Obsidian second brain
    templates/  conflicts/  inbox/  proposed/  action_plans/  archive/  .state/
  agents/                         # LangGraph Red Team + telemetry fixtures
  services/api/                   # FastAPI ledger, conflicts, sync, Today BFF
  scripts/                        # dev runner, demo, cold start, verify_openai
  dashboard/                      # React + Vite dashboard
  inbox/                          # sample transcriptions
```

**Pipeline (simplified):**

```
inbox / Capture UI
  → POST /ledger → vault/*.md
       → conflict_detector → vault/conflicts/*.md
       → obsidian_to_neo4j → vault/proposed → Neo4j (optional)

POST /red-team → LangGraph Red Team
  → vault/action_plans/*.md
  → vault/.state/last_red_team.json

Dashboard ← GET /stakeholders, /conflicts, /action-plans, /graph, /today
```

---

## Setup & environment

```bash
cp .env.example .env
```

Minimum for local use:

- **`VAULT_PATH`** — default `./vault`
- **`NEO4J_*`** — match `docker-compose.yml` credentials
- **`OPENAI_API_KEY`** — **recommended** for real extraction and Red Team narratives

Optional:

- **`STALE_DAYS`** — Today tab staleness (default `30`)
- **`AUTO_COMMIT`** — sync applies to Neo4j when true
- **Firecrawl** — cold-start scripts only

See **`.env.example`** for the full list.

---

## Running locally

**One terminal (Neo4j + API + Vite):**

```bash
python3 -m venv .venv && source .venv/bin/activate   # once
pip install -r requirements.txt                     # once
(cd dashboard && npm install)                       # once

make dev
```

- **Dashboard:** http://localhost:5173  
- **API:** http://localhost:8000/health  
- **Neo4j Browser:** http://localhost:7474 (if compose is up)

**Ctrl+C** stops all processes started by `make dev`.

---

## Verification & demos

```bash
# Python tests
pytest

# Dashboard typecheck + build
(cd dashboard && npx tsc --noEmit && npm run build)

# OpenAI key smoke test
python scripts/verify_openai.py

# End-to-end demo (separate from make dev if needed)
make demo
```

---

## What is not built yet

Roughly aligned with a **Days 6–7** style follow-up:

- **Structured action plans** — Checklist tasks with PATCHable status (not only Markdown prose).
- **Nightly jobs + Slack + in-app notifications** for Red Team deltas without opening the UI.
- **Multi-user auth**, hosted multi-tenant vaults, and **Obsidian plugin** sync are **out of scope** for this repo unless you add them.

---

## Further reading

- [vault-schema.yaml](vault-schema.yaml) — canonical frontmatter keys  
- [schema.txt](schema.txt) — Neo4j constraints and example Cypher  
- [SHOWSTOPPER.md](SHOWSTOPPER.md) — MVP validation checklist (if present)

---

*Pathfinder: **vault in, graph out, Red Team stress-tests the gap between sentiment and usage.***
