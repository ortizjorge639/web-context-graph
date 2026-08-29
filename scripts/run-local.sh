#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="127.0.0.1"
PORT="${PORT:-8000}"
URL="http://${HOST}:${PORT}"

for command in python3 npm git copilot curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command" >&2
    exit 1
  fi
done

python3 - <<'PY'
import sys

if sys.version_info < (3, 11):
    raise SystemExit("Python 3.11 or newer is required")
PY

copilot version >/dev/null

if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
  python3 -m venv "$ROOT/backend/.venv"
fi

"$ROOT/backend/.venv/bin/pip" install \
  --disable-pip-version-check \
  --quiet \
  -r "$ROOT/backend/requirements.txt"

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  npm --prefix "$ROOT/frontend" ci --silent
fi
npm --prefix "$ROOT/frontend" run build

if ! python3 - "$HOST" "$PORT" <<'PY'
import socket
import sys

host, port = sys.argv[1], int(sys.argv[2])
with socket.socket() as probe:
    try:
        probe.bind((host, port))
    except OSError:
        raise SystemExit(1)
PY
then
  printf 'Port %s is already in use. Set PORT to another local port.\n' "$PORT" >&2
  exit 1
fi

printf 'Starting Lineage App at %s\n' "$URL"
printf 'Vault: %s\n' "${WCG_VAULT_ROOT:-$HOME/web-context-graph-data}"

(
  for _ in {1..60}; do
    if curl --fail --silent "$URL/healthz" >/dev/null; then
      if [ "${WCG_NO_OPEN:-0}" = "1" ]; then
        exit 0
      elif command -v open >/dev/null 2>&1; then
        open "$URL"
      elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" >/dev/null 2>&1 || true
      fi
      exit 0
    fi
    sleep 0.25
  done
  printf 'The local server did not become ready at %s\n' "$URL" >&2
) &

cd "$ROOT/backend"
exec .venv/bin/uvicorn main:app --host "$HOST" --port "$PORT"
