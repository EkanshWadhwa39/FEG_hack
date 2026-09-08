# FEG Challenge 3 — PSK browser cache warming

A web-only, browser-native prototype and evidence toolkit for testing whether the PSK lobby can warm exact static game assets before launch.

## Start here

1. Read [`CODE.md`](CODE.md) — authoritative constraints and measured facts.
2. Read [`AGENTS.md`](AGENTS.md) — coding and multi-agent contract.
3. Read [`docs/AGENT-TEAM.md`](docs/AGENT-TEAM.md) — model routing and delegation prompts.
4. Read [`docs/HACKATHON-RUNBOOK.md`](docs/HACKATHON-RUNBOOK.md) — build/demo sequence.
5. Read [`docs/SUBMISSION-GUIDELINES.md`](docs/SUBMISSION-GUIDELINES.md) — organiser requirements.
6. Read [`docs/STAGING-SANDBOX.md`](docs/STAGING-SANDBOX.md) — later staging integration contract and evidence gates.
7. Before submission, complete [`docs/PRE-SUBMISSION-AUDIT.md`](docs/PRE-SUBMISSION-AUDIT.md) — blocking security, documentation, access, and freeze checks.

## Setup

```bash
./scripts/bootstrap.sh
./scripts/check.sh
./scripts/serve.sh
```

Then open `http://127.0.0.1:8080` through your browser/port forwarding.

The current browser page is deliberately a **SIMULATED scaffold**. It makes no provider requests and proves no production cache behavior yet. The staging URL is unavailable during the hackathon; this build remains environment-neutral so it can undergo controlled sandbox validation when staging is introduced later.

## HAR comparison

```bash
.venv/bin/python tools/measure_har.py \
  Devtools_games/casino.psk.hr_cold.har \
  Devtools_games/casino.psk.hr_warm.har
```

The tool emits aggregate metrics only and does not print URLs, query strings, headers, or cookies. Cache hits are classified conservatively; exporter-specific unknowns remain `UNKNOWN`.

## Large data

Use DuckDB or Polars lazy scans rather than loading multi-GB CSVs into pandas:

```bash
.venv/bin/python - <<'PY'
import duckdb
path = 'FEG Innovation Hackathon 2026/CA_MOM.csv'
print(duckdb.sql(f"SELECT * FROM read_csv_auto('{path}', sample_size=100000) LIMIT 5"))
PY
```

Never output pseudonymized player IDs. Keep only aggregate, non-identifying results in `evidence/derived/`.

## Scope

- Web/mobile web only.
- No certified game code changes.
- No native app, service worker, or custom cache.
- Mandatory authorization remains fail-closed and blocking.
- Results must be scoped and labeled by evidence type.
- Staging validation is a later gate, not a hackathon claim; do not substitute production traffic during the staging outage.
