# FEG Challenge 3 — PSK browser cache warming

A web-only, browser-native prototype and evidence toolkit for testing whether the PSK lobby can warm exact static game assets before launch.

## Start here

1. Read [`CODE.md`](CODE.md) — authoritative constraints and measured facts.
2. Read [`Context/BUILD-PLAN.md`](Context/BUILD-PLAN.md) — current state, ownership split, and the plan of record.
3. Read [`docs/PRODUCTION-CACHE-REUSE.md`](docs/PRODUCTION-CACHE-REUSE.md) — the production proof: 11.25 MB to 35 KB.
4. Read [`docs/SANDBOX.md`](docs/SANDBOX.md) — cold vs warm launch of the provided game package.
5. Read [`AGENTS.md`](AGENTS.md) — coding and multi-agent contract.
6. Read [`docs/AGENT-TEAM.md`](docs/AGENT-TEAM.md) — model routing and delegation prompts.
7. Read [`docs/HACKATHON-RUNBOOK.md`](docs/HACKATHON-RUNBOOK.md) — build/demo sequence.
8. Read [`docs/SUBMISSION-GUIDELINES.md`](docs/SUBMISSION-GUIDELINES.md) — organiser requirements.
9. Read [`docs/STAGING-SANDBOX.md`](docs/STAGING-SANDBOX.md) — later staging integration contract and evidence gates.
10. Before submission, complete [`docs/PRE-SUBMISSION-AUDIT.md`](docs/PRE-SUBMISSION-AUDIT.md) — blocking security, documentation, access, and freeze checks.

## Setup

### Prerequisites (all platforms)

- **Python 3.11+** (3.13 recommended). The throttled sandbox server relies on a
  high-resolution `time.sleep`, which CPython ships on Windows only from 3.11.
- **Node.js 18+**.
- For the cold-vs-warm demo: a **Chromium-based browser** (Chrome, Edge, Brave).
  Firefox and Safari partition the HTTP cache per top-level origin, so the
  parent-origin warm is not visible to the cross-origin game iframe there.

### macOS / Linux

```bash
./scripts/bootstrap.sh    # .venv + Python deps + npm ci
./scripts/check.sh        # tests + lint  (needs shellcheck: brew install shellcheck | apt install shellcheck)
./scripts/serve.sh        # plain scaffold on http://127.0.0.1:8090
```

### Windows

`scripts/*.sh` are bash-only and assume a POSIX venv layout (`.venv/bin`,
`python3`, `shellcheck`). Either run them from **Git Bash / WSL** unchanged, or
set up natively in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install --upgrade pip
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
npm ci

# checks
.\.venv\Scripts\python -m pytest -q
.\.venv\Scripts\python -m ruff check tools tests
npm test

# plain scaffold on http://127.0.0.1:8090
.\.venv\Scripts\python -m http.server 8090 --directory prototype --bind 127.0.0.1
```

The plain scaffold page is a **SIMULATED** decision dashboard: it issues no
provider requests and proves no production cache behavior. The real cold-vs-warm
launch is the sandbox demo below.

## Cold vs warm lobby demo

Serves the lobby on `:8090` and the provided game bundle on `:8091` (separate
origins, like production), with a production-like throttle so a cold launch is
slow and a warmed launch is fast. Point `--bundle` at wherever the package is
extracted; it stays outside the repo.

```bash
# macOS / Linux
.venv/bin/python tools/sandbox_server.py \
  --bundle evidence/private/bundles/empireofgold --throttle-kbps 12000
```

```powershell
# Windows — wrapper clears any stale server first, then starts the throttled host
./scripts/serve-sandbox.ps1
./scripts/serve-sandbox.ps1 -ThrottleKbps 8000 -Bundle C:\path\to\empireofgold
```

Open `http://127.0.0.1:8090/lobby.html`. **Wait for Game 1's card to turn green
and read `3.5s WARM (Ready)` before launching it** — auto-warm takes a few
seconds and a launch during that window loads partly-cold. Then compare
launching Game 1 (warm) against Game 5 (cold). Automated:
`node tools/sandbox_measure.mjs --runs 3` (needs `npx playwright install chromium`).

> **Only one sandbox server at a time.** On Windows a leftover instance can keep
> answering on the same port and silently serve every launch cold; the wrapper
> script and the server's own startup check now guard against this, but if in
> doubt run `Get-Process python | Stop-Process -Force` first.

## HAR comparison

The `.venv/bin/python` in the snippets below is `.venv\Scripts\python` on Windows.

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
