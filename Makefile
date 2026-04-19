# Prefer a local/tmp venv if one exists, otherwise fall back to system python3.
# Override with `PYTHON=/path/to/python make run` if you want a specific interpreter.
VENV_PY := $(firstword $(wildcard .venv/bin/python /tmp/pathfinder-venv/bin/python))
PYTHON ?= $(if $(VENV_PY),$(VENV_PY),python3)
UVICORN ?= $(PYTHON) -m uvicorn

.PHONY: install install-dev test run neo4j-up neo4j-down demo demo-commit sync red-team dashboard clean-vault help

help:
	@echo "Targets:"
	@echo "  install       pip install requirements.txt"
	@echo "  install-dev   pip install requirements-dev.txt (adds pytest)"
	@echo "  test          run pytest smoke suite"
	@echo "  neo4j-up      docker compose up -d neo4j"
	@echo "  neo4j-down    docker compose down"
	@echo "  run           run FastAPI on :8000"
	@echo "  demo          run end-to-end pipeline (proposed-only)"
	@echo "  demo-commit   run end-to-end pipeline and commit to Neo4j"
	@echo "  sync          vault -> Neo4j proposals"
	@echo "  red-team      run Red Team LangGraph"
	@echo "  dashboard     npm install + npm run dev in dashboard/"
	@echo "  clean-vault   wipe vault contents (templates kept)"

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

sync:
	$(PYTHON) -m services.api.obsidian_to_neo4j

red-team:
	$(PYTHON) -m agents.red_team_graph

dashboard:
	cd dashboard && npm install && npm run dev

clean-vault:
	find vault -type f -name "*.md" ! -path "vault/templates/*" -delete
	find vault/proposed -type f -name "*.json" -delete || true
