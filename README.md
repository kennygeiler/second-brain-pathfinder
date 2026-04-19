# Pathfinder Core

Filesystem-first state machine for FDE-style stakeholder intelligence.
Obsidian Markdown + YAML is the source of truth; Neo4j is the master graph after approved sync; LangGraph drives the Red Team analysis.

## Layout

```
pathfinder-core/
  .cursor/rules/pathfinder.mdc   # LLM guardrails
  .cursorrules                    # duplicate for Ctrl+K
  schema.txt                      # Neo4j schema reference
  vault-schema.yaml               # Obsidian frontmatter contract
  docker-compose.yml              # Neo4j 5 enterprise + APOC + GDS
  vault/                          # Obsidian second brain
    templates/stakeholder.md
    conflicts/  inbox/  proposed/  action_plans/
  agents/                         # LangGraph Red Team + telemetry fixtures
  services/api/                   # FastAPI ledger + conflict + sync
  scripts/                        # cold start + PDF migration
  dashboard/                      # Pencil-exported React + Vite BFF bridge
  inbox/                          # drop meeting transcriptions here
```

## Quickstart

One-time setup:

```bash
cp .env.example .env
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
(cd dashboard && npm install)
```

Then, to run everything (Neo4j + API + dashboard) in a **single terminal**:

```bash
make dev
```

Logs are prefixed `[neo4j]`, `[api]`, `[web]` so you can tell them apart. Ctrl-C once kills all of it. Docker Desktop needs to be running; if it isn't, `make dev` still starts the API and dashboard and the API falls back to the `vault/proposed/` JSON snapshot for the graph.

Then run the showstopper demo (in a second terminal, or after stopping `make dev`):

```bash
make demo
```

## Pipeline

```
inbox → FastAPI ledger → vault/*.md → conflict_detector → vault/conflicts
                                  ↘ obsidian_to_neo4j → vault/proposed → Neo4j
                                                                          ↓
                                                              LangGraph Red Team
                                                                          ↓
                                                         vault/action_plans/*.md
```

All graph writes are staged in `vault/proposed/` first; set `AUTO_COMMIT=true` in `.env` to push to Neo4j in the same step.

## Further reading

- [vault-schema.yaml](vault-schema.yaml) — canonical frontmatter keys
- [schema.txt](schema.txt) — Neo4j constraints and example Cypher
