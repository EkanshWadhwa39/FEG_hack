#!/usr/bin/env bash
# Compatibility entry point. Provider execution now uses ordinary host networking;
# no Linux namespace, firewall, sudo, process attestation, or egress restriction.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec node tools/verify_empire.mjs "$@"
