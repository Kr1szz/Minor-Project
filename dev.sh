#!/usr/bin/env bash
# Run the PipeLab API and the Vite frontend together. Ctrl+C stops both.
#
#   ./dev.sh            API with SQLite in backend/.venv (no Docker needed)
#   ./dev.sh --docker   API, PostgreSQL and Redis through docker compose
#
# Ports can be changed with API_PORT (default 8000) and WEB_PORT (default 5173).
set -euo pipefail
cd "$(dirname "$0")"

API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"
MODE=local
case "${1:-}" in
  "" | --local) ;;
  --docker) MODE=docker ;;
  -h | --help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Unknown option: $1 (see ./dev.sh --help)" >&2; exit 1 ;;
esac

if [[ -t 1 ]]; then
  bold=$'\e[1m' dim=$'\e[2m' green=$'\e[32m' blue=$'\e[34m' magenta=$'\e[35m' reset=$'\e[0m'
else
  bold='' dim='' green='' blue='' magenta='' reset=''
fi
log() { echo "${bold}[dev]${reset} $*"; }
fail() { echo "${bold}[dev]${reset} $*" >&2; exit 1; }
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# Prefix each output line so the two logs stay readable when interleaved.
prefix() { sed -u "s/^/$1 /"; }

for port in "$API_PORT" "$WEB_PORT"; do
  port_in_use "$port" && fail "Port $port is already in use. Stop that process or set API_PORT / WEB_PORT."
done
command -v npm >/dev/null || fail "npm not found. Install Node.js 20 or newer."

if [[ ! -d node_modules || package.json -nt node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
  log "Installing frontend dependencies…"
  npm install --no-fund --no-audit
fi

if [[ $MODE == local ]]; then
  venv=backend/.venv
  if [[ ! -f $venv/.installed || backend/requirements.txt -nt $venv/.installed ]]; then
    # The pinned packages (pydantic-core, psycopg) ship wheels up to Python 3.13,
    # so prefer uv's managed Python 3.12, which also matches the Dockerfile.
    if command -v uv >/dev/null; then
      if [[ ! -d $venv ]]; then
        log "Creating $venv with Python 3.12 (uv downloads it the first time)…"
        uv python install 3.12
        uv venv -q --python 3.12 "$venv"
      fi
      log "Installing backend dependencies…"
      uv pip install --python "$venv/bin/python" -r backend/requirements.txt ||
        fail "Backend install failed. Delete $venv and run ./dev.sh again."
    else
      python=$(command -v python3.12 || command -v python3.13 || true)
      [[ -n $python ]] || fail "Needs Python 3.12 or 3.13, or uv (https://docs.astral.sh/uv/) to download one."
      [[ -d $venv ]] || { log "Creating $venv with $("$python" --version)…"; "$python" -m venv "$venv"; }
      log "Installing backend dependencies…"
      "$venv/bin/pip" install -q -r backend/requirements.txt ||
        fail "Backend install failed. Delete $venv and run ./dev.sh again."
    fi
    touch "$venv/.installed"
  fi
else
  command -v docker >/dev/null || fail "docker not found. Run ./dev.sh without --docker to use SQLite."
fi

cleanup() {
  trap - EXIT INT TERM
  echo
  log "Stopping…"
  [[ $MODE == docker ]] && API_PORT="$API_PORT" docker compose stop >/dev/null 2>&1
  kill 0 2>/dev/null
}
trap cleanup EXIT INT TERM

if [[ $MODE == local ]]; then
  (cd backend && exec .venv/bin/uvicorn app.main:app --reload --port "$API_PORT") 2>&1 |
    prefix "${blue}[api]${reset}" &
else
  API_PORT="$API_PORT" docker compose up --build 2>&1 | prefix "${blue}[api]${reset}" &
fi
api_pid=$!
VITE_API_URL="http://localhost:$API_PORT" npm run dev -- --port "$WEB_PORT" --strictPort 2>&1 |
  prefix "${magenta}[web]${reset}" &
web_pid=$!

(
  for _ in $(seq 120); do
    if curl -fs "http://localhost:$API_PORT/health" >/dev/null 2>&1; then
      log "${green}PipeLab is running${reset}"
      log "  App       http://localhost:$WEB_PORT"
      log "  API docs  http://localhost:$API_PORT/docs"
      log "  ${dim}Ctrl+C to stop both${reset}"
      exit 0
    fi
    sleep 1
  done
  log "The API did not answer on port $API_PORT after 2 minutes; check the [api] log above."
) &

# Stop everything as soon as either server exits.
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do sleep 1; done
