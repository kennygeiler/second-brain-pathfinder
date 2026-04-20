# Prefer a local/tmp venv if one exists, otherwise fall back to system python3.
# Override with `PYTHON=/path/to/python make run` if you want a specific interpreter.
VENV_PY := $(firstword $(wildcard .venv/bin/python /tmp/pathfinder-venv/bin/python))
PYTHON ?= $(if $(VENV_PY),$(VENV_PY),python3)
UVICORN ?= $(PYTHON) -m uvicorn

.PHONY: dev install install-dev test run neo4j-up neo4j-down demo demo-commit demo-cyvl-reset demo-cyvl-reset-neo4j sync red-team dashboard clean-vault help

help:
	@echo "Targets:"
	@echo "  dev           start Neo4j + API + dashboard in ONE terminal (Ctrl-C kills all)"
	@echo "  install       pip install requirements.txt"
	@echo "  install-dev   pip install requirements-dev.txt (adds pytest)"
	@echo "  test          run pytest smoke suite"
	@echo "  neo4j-up      docker compose up -d neo4j"
	@echo "  neo4j-down    docker compose down"
	@echo "  run           run FastAPI on :8000 (only — prefer 'make dev')"
	@echo "  demo          run end-to-end pipeline (proposed-only)"
	@echo "  demo-commit   run end-to-end pipeline and commit to Neo4j"
	@echo "  demo-cyvl-reset        wipe vault (keep templates) + seed Cyvl FDE scenario YAML"
	@echo "  demo-cyvl-reset-neo4j  same + sync entities + telemetry into Neo4j"
	@echo "  sync          vault -> Neo4j proposals"
	@echo "  red-team      run Red Team LangGraph"
	@echo "  dashboard     npm install + npm run dev in dashboard/ (only)"
	@echo "  clean-vault   wipe vault contents (templates kept)"

dev:
	@PYTHON="$(PYTHON)" bash scripts/dev.sh

install:
	$(PYTHON) -m pip install -r requirements.txt

install-dev:
	$(PYTHON) -m pip install -r requirements-dev.txt

test:
	$(PYTHON) -m pytest -v

neo4j-up:
	docker compose up -d neo4j

neo4j-down:
	docker compose down

run:
	@echo "Starting API with $(PYTHON)"
	$(UVICORN) services.api.main:app --reload --host 0.0.0.0 --port 8000

demo:
	$(PYTHON) scripts/run_demo.py

demo-commit:
	$(PYTHON) scripts/run_demo.py --commit

# Force repo ./vault so a bad VAULT_PATH in .env (e.g. /path/to/...) cannot break the seed.
demo-cyvl-reset:
	VAULT_PATH="$(CURDIR)/vault" $(PYTHON) scripts/reset_and_seed_cyvl_demo.py

demo-cyvl-reset-neo4j:
	VAULT_PATH="$(CURDIR)/vault" $(PYTHON) scripts/reset_and_seed_cyvl_demo.py --commit-neo4j

sync:
	$(PYTHON) -m services.api.obsidian_to_neo4j

red-team:
	$(PYTHON) -m agents.red_team_graph

dashboard:
	cd dashboard && npm install && npm run dev

clean-vault:
	find vault -type f -name "*.md" ! -path "vault/templates/*" -delete
	find vault/proposed -type f -name "*.json" -delete || true
