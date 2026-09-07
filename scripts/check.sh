#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON=".venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  echo 'Missing .venv. Run ./scripts/bootstrap.sh first.' >&2
  exit 1
fi

printf '\n== Python tests ==\n'
"$PYTHON" -m pytest -q
printf '\n== Python lint ==\n'
"$PYTHON" -m ruff check tools tests
printf '\n== JavaScript tests ==\n'
npm test
printf '\n== JavaScript syntax ==\n'
npm run check:js
printf '\n== Shell lint ==\n'
shellcheck scripts/*.sh
printf '\nAll checks passed.\n'
