#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec python3 -m http.server "${PORT:-8090}" --directory src --bind "${BIND:-127.0.0.1}"
