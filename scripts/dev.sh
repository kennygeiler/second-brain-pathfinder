#!/usr/bin/env bash
# One-terminal dev runner.
#
#   - Brings up Neo4j via `docker compose up -d` (non-blocking).
#   - Runs FastAPI (uvicorn --reload) + Vite dashboard (npm run dev) in the
#     background, with prefixed + colored log lines streaming into this
#     terminal.
#   - Ctrl-C once → kills everything (uvicorn, vite, awk log-prefixers).
#
# Usage: `make dev`  (or run `bash scripts/dev.sh` from pathfinder-core/)
#
# Env:
#   PYTHON            Path to the python interpreter (default: autodetect venv)
#   SKIP_NEO4J=1      Don't try to start Neo4j (already running, or don't want it)
#   SKIP_DASHBOARD=1  Only run the API (useful when frontend build is broken)

set -uo pipefail

cd "$(dirname "$0")/.."

# ─── Resolve the python interpreter (prefer venvs) ────────────────────────────
PY=""
if [[ -n "${PYTHON:-}" ]]; then
  PY="$PYTHON"
elif [[ -x ".venv/bin/python" ]]; then
  PY=".venv/bin/python"
elif [[ -x "/tmp/pathfinder-venv/bin/python" ]]; then
  PY="/tmp/pathfinder-venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY="python3"
else
  echo "error: no python interpreter found (set PYTHON=...)" >&2
  exit 1
fi

# ─── ANSI helpers ─────────────────────────────────────────────────────────────
C_API="\033[34m"
C_WEB="\033[35m"
C_NEO="\033[36m"
C_INFO="\033[33m"
C_DIM="\033[2m"
C_RESET="\033[0m"

info() { printf "${C_INFO}[dev]${C_RESET} %s\n" "$*"; }

# ─── Recursive cleanup of all spawned processes ───────────────────────────────
API_PID=""
WEB_PID=""

kill_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  # Kill grandchildren first, then direct children, then the pid itself.
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for c in $children; do kill_tree "$c"; done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  printf "\n${C_INFO}[dev]${C_RESET} shutting down...\n"
  trap '' INT TERM EXIT
  kill_tree "$API_PID"
  kill_tree "$WEB_PID"
  # Give processes 2s to exit cleanly, then SIGKILL stragglers.
  sleep 0.5
  [[ -n "$API_PID" ]] && kill -KILL "$API_PID" 2>/dev/null || true
  [[ -n "$WEB_PID" ]] && kill -KILL "$WEB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  printf "${C_INFO}[dev]${C_RESET} stopped.\n"
}
trap cleanup EXIT INT TERM

# ─── Neo4j (optional, non-blocking) ───────────────────────────────────────────
if [[ "${SKIP_NEO4J:-}" != "1" ]]; then
  if docker info >/dev/null 2>&1; then
    info "bringing up Neo4j (docker compose up -d neo4j)..."
    if docker compose up -d neo4j >/tmp/pathfinder-neo4j.log 2>&1; then
      printf "${C_NEO}[neo4j]${C_RESET} up on http://localhost:7474 (bolt :7687)\n"
    else
      printf "${C_NEO}[neo4j]${C_RESET} ${C_DIM}compose failed — see /tmp/pathfinder-neo4j.log; API will fall back to proposed snapshots${C_RESET}\n"
    fi
  else
    printf "${C_NEO}[neo4j]${C_RESET} ${C_DIM}Docker daemon not running — skipping Neo4j. API will serve proposed snapshots.${C_RESET}\n"
  fi
else
  info "SKIP_NEO4J=1 — not touching docker"
fi

# ─── FastAPI (with prefixed logs via awk) ─────────────────────────────────────
info "starting API on :8000 (using $PY)"
(
  "$PY" -m uvicorn services.api.main:app --reload --host 0.0.0.0 --port 8000 2>&1
) | awk -v c="$C_API" -v r="$C_RESET" '{ printf "%s[api]%s   %s\n", c, r, $0; fflush(); }' &
API_PID=$!

# ─── Vite dashboard ───────────────────────────────────────────────────────────
if [[ "${SKIP_DASHBOARD:-}" != "1" ]]; then
  if [[ ! -d "dashboard/node_modules" ]]; then
    info "dashboard/node_modules missing — running npm install (first run only)..."
    if ! (cd dashboard && npm install --no-audit --no-fund); then
      printf "${C_WEB}[web]${C_RESET}   ${C_DIM}npm install failed — skipping dashboard${C_RESET}\n"
      SKIP_DASHBOARD=1
    fi
  fi
fi

if [[ "${SKIP_DASHBOARD:-}" != "1" ]]; then
  info "starting dashboard on :5173"
  (
    cd dashboard && npm run dev 2>&1
  ) | awk -v c="$C_WEB" -v r="$C_RESET" '{ printf "%s[web]%s   %s\n", c, r, $0; fflush(); }' &
  WEB_PID=$!
fi

sleep 1
info "─────────────────────────────────────────────────────────"
info "API:       http://localhost:8000/health"
info "Dashboard: http://localhost:5173"
info "Neo4j:     http://localhost:7474 (neo4j / password_must_be_changed)"
info "Ctrl-C once to stop everything."
info "─────────────────────────────────────────────────────────"

# Wait until any tracked pipeline dies, then cleanup() kills the rest.
if [[ -n "$WEB_PID" ]]; then
  wait -n "$API_PID" "$WEB_PID" 2>/dev/null || true
else
  wait "$API_PID" 2>/dev/null || true
fi
