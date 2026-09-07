#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON_BIN="${PYTHON_BIN:-/usr/bin/python3}"
command -v "$PYTHON_BIN" >/dev/null || { echo "Python not found: $PYTHON_BIN" >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js is required (Ubuntu: apt install nodejs npm)" >&2; exit 1; }

if [[ ! -d .venv ]]; then
  "$PYTHON_BIN" -m venv .venv
fi
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r requirements-dev.txt

mkdir -p evidence/derived evidence/private
printf 'Ready: Node %s, Python %s\n' "$(node --version)" "$(.venv/bin/python --version)"
echo 'Next: ./scripts/check.sh'
