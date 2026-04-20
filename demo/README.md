# Cyvl FDE demo scenario

## What’s in the box

- **`cyvl_fde_scenario.yaml`** — Eight stakeholders (Metro Regional DOT–style), ~6 months of **`source_lineage`** (voice, email, meeting, crawl, PDF), wiki-links for graph edges, one **sentiment conflict**, **Red Team snapshot** + **action plan** (schema v2 tasks), and **hotspots** aligned with the narrative.
- **`cyvl_fde_systems.yaml`** — **Telemetry** systems + `USES` rows resolved by stakeholder **name** after notes exist.

## Reset everything and seed

From the repo root (with your venv activated if you use one):

**Set `VAULT_PATH` to a real directory** (do not use a literal `/path/to/...` placeholder). Easiest: use the repo’s vault folder:

```bash
cd pathfinder-core
export VAULT_PATH="$PWD/vault"
```

If you omit `VAULT_PATH`, the default is `./vault` relative to the **current working directory** of the process (so run commands from the repo root, or set `VAULT_PATH` explicitly).

```bash
# Vault + proposed JSON + clear Neo4j graph (no DB write unless --commit-neo4j)
python scripts/reset_and_seed_cyvl_demo.py

# Same, plus commit Entity + LINKS_TO + System + USES into Neo4j (requires Neo4j up)
python scripts/reset_and_seed_cyvl_demo.py --commit-neo4j
```

Makefile shortcuts:

```bash
make demo-cyvl-reset          # vault + local proposed queue only
make demo-cyvl-reset-neo4j    # also loads graph + telemetry into Neo4j
```

`make clean-vault` only removes markdown outside `vault/templates/`; it does **not** clear Neo4j or re-seed. Use the script for a full **blank slate + demo**.

## After seeding

1. `make run` or `make dev` — open the dashboard.
2. Start with **Today**, **Moments**, **Stakeholder** (Maria Santos), **Risk Intel** / **Pathfinder Map**.

Adjust **`anchor_date`** in `cyvl_fde_scenario.yaml` if you want the storyline centered on another “demo day.”
