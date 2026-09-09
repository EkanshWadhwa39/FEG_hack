# PSK browser-cache sandbox — FEG Challenge 3

**Status: beta packaging snapshot, not a frozen or submission-ready release.**
This tree packages the selected `feat/optimized-lobby-cache` implementation
(baseline `979aceb`). Packaging does not resolve the runtime and evidence
limitations below.

- **Challenge:** Challenge 3 — Game Load Time.
- **Solution:** prepare eligible supplied resources in the browser HTTP cache
  while browsing, then observe the subsequent game launch.
- **Members:** Ekansh, Hansika, Parth and Shaurya.
- **Team name, Team Lead and team-controlled repository ownership:** confirmation
  required before submission. Do not infer the Team Lead from repository ownership.

## Problem and solution

A game launch can wait on static-resource transfer as well as engine execution.
This sandbox explores moving eligible transfer before the click, without changing
the supplied game code. Cache reuse and launch benefit are outcomes to measure,
not guarantees of a completed fetch.

We use **our own web lobby/sandbox and the supplied assets unchanged**. There is
**no prediction model or training, new game content, substitute/reference game,
native SDK, service worker, custom asset cache or application database**. These
are scope constraints, not missing deliverables. Existing deterministic rules
schedule cache requests only. Judges evaluate this sandbox, not staging.

The current PSK-style lobby has twenty synthetic catalogue slots, hover/focus
blurbs, preparation controls, diagnostics and an iframe launch view. The slots
serve one supplied source build under distinct URL paths; they are not twenty
independently implemented or validated games. CSS card motifs are lobby styling,
not additional supplied game assets.

## Repository map

```text
README.md                    Reviewer guide and demo flow
src/                         Browser application (formerly prototype/)
  lobby.html                 Selected real-request lobby
  index.html                 Simulated decision dashboard
  player.html, sandbox.html  Supporting demonstration surfaces
  src/                       Existing ES modules; relative imports preserved
  styles/                    Existing application CSS
  tests/                     JavaScript and supporting-player browser tests
docs/
  impact-case.md             D3: benefit, cost and evidence boundaries
  compliance-note.md         D4: requirements, implementation and release gates
  architecture.md            Components, flows and deployment assumptions
  dependencies.md            Software, resources, permissions and AI disclosure
tests/                       Python and repository-layout validation
scripts/                     Bootstrap, checks and static serving
tools/                       Sandbox serving and evidence/diagnostic utilities
package.json, package-lock.json, requirements-dev.txt
```

`demo/` will contain only approved presentation material if required; none is
claimed complete in this snapshot. No extra `assets/` or `config/` directory is
needed now: existing UI files are under `src/`, and configuration is documented
below. The provider bundle is a private external prerequisite, not a Git asset.

## Requirements and setup

- Python **3.11+** with `venv` and pip; Node **22 LTS** and npm are recommended.
  The locked Playwright package requires Node 20 or newer; Node 18 is insufficient.
- Chromium installed by the locked Playwright release for browser tests.
- Bash and ShellCheck for the complete shell-based check on Linux/macOS/WSL.
- An organiser-approved local copy of the unchanged supplied game bundle for
  the game demo. It must contain its entry `index.html` and required resources.
  Missing resources must be reported; do not generate replacements.
- Dependency installation and the current lobby's Google Fonts request need
  network access. Font failure falls back to system fonts; see dependencies.

### Linux/macOS/WSL

```bash
# Set PYTHON_BIN to the installed Python 3.11+ executable if necessary.
PYTHON_BIN="$(command -v python3)" ./scripts/bootstrap.sh
npx playwright install chromium
# On a minimal Linux host, install Playwright OS prerequisites if requested.
./scripts/check.sh
.venv/bin/python tools/measure_har.py --help
```

Install ShellCheck using the host's package manager before `check.sh`. A missing
browser can cause browser tests to skip; check the totals rather than treating a
skipped run as full validation. Linux is the checked environment; native Windows
and macOS execution remain unverified for this packaging snapshot.

### Native Windows PowerShell (manual alternative)

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
npm ci
npx playwright install chromium
.\.venv\Scripts\python -m pytest -q
.\.venv\Scripts\python -m ruff check tools tests
npm test
```

The shell lint/syntax command uses POSIX tooling; use WSL for the full check.
No additional PowerShell wrapper is supplied.

## Configuration and startup

No API key, login, production endpoint or secret environment file is needed.
Never point this prototype at a live gambling/authorization service.

### Supporting scaffold only — no bundle required

```bash
./scripts/serve.sh
# Open http://127.0.0.1:8090/index.html
```

`PORT` (default `8090`) and `BIND` (default `127.0.0.1`) configure this static
server. It does **not** implement the `/game/{slot}/` bundle mapping. `npm run
serve` is a separate static alternative; set `BIND=127.0.0.1` to restrict it to
loopback. Do not serve the repository root or private working folders.

### Supplied-bundle lobby

```bash
.venv/bin/python tools/sandbox_server.py \
  --bundle /absolute/path/to/approved/empireofgold \
  --host 127.0.0.1 --lobby-port 8090 --game-port 8091 --throttle-kbps 0
# Open http://127.0.0.1:8090/lobby.html (not the server's printed sandbox.html link)
```

On PowerShell, substitute `.\.venv\Scripts\python` for `.venv/bin/python`.
Only the provider bundle directory—not the raw hackathon data directory—should
be supplied to `--bundle`. Reviewer access to this bundle requires an approved
secure handoff. A clone alone does not include it; that handoff remains a release gate.

The default lobby requests `/game/{slot}/...` on **its own origin**; the server
also provides a second origin on port 8091. Two listening ports do not make the
default flow cross-origin. Do not use the currently unvalidated `?game=` override
with untrusted or external destinations. Keep the server local.

`--throttle-kbps 0` disables synthetic throttling. Nonzero values currently apply
per-response throttling and a **3.2× rate multiplier** to qualifying speculative
requests. They are not one uniform network condition and cannot support an
unqualified fair-network comparison. `SANDBOX_VERBOSE=1` enables request logs;
keep logs private and do not use credential-bearing URLs. Stop only the server
you started with Ctrl+C; do not kill unrelated Python processes.

## Demo flow and interpretation

1. Start the supplied-bundle server locally and open `lobby.html`.
2. Inspect the fixed catalogue and hover/focus overlays. The current page starts
   automatic preparation immediately; its authorization gate is **not integrated**.
3. Observe preparation diagnostics, then select the prepared slot. Record what
   actually loads and any missing dependency or rollback. Card labels are not
   proof of cache admission or accepted game input.
4. For a functional comparison, inspect an unprepared slot or disable speculation.
   Disabling it does not empty the browser cache. Different-slot comparisons and
   fresh randomized URL namespaces are not a matched causal control/treatment pair.
5. Exercise the visible interruption/close flow as a diagnostic, not evidence of
   a real exclusion-register decision or comprehensive failure recovery.
6. Before claiming benefit, run isolated **serial** arms of the same title/build,
   variant, exact URLs and milestone with comparable network conditions. Preparation
   by the actual lobby must be the only treatment difference. This evidence gate
   is not complete in the current package.

Do not run simultaneous browser experiments. `npm run benchmark:cold-vs-warm`
and the older diagnostic tools are not acceptance proof: the benchmark uses a
separate preparation path/manifest. Production-probe tools are historical and
must not be run as a substitute for sandbox evaluation.

## Validation and known limitations

`./scripts/check.sh` runs Python tests, Ruff, JS tests/syntax and ShellCheck.
`tests/test_submission_layout.py` additionally checks required paths, the four-doc
limit, local documentation links and exclusion of internal agent material.
**MEASURED packaging checks:** 50 Python tests and 136 JS tests passed, with no
skips, using Node 22.23.2, npm 9.2.0, Python 3.12.3, Playwright 1.63.0 and Chromium
153.0.8010.12. Ruff, JS syntax, ShellCheck and the HAR CLI help check passed.
All 42 browser files moved byte-for-byte; no UI or game-loading logic was changed.
Checks also passed in a clean candidate copy after fresh dependency installation
(using the installed Playwright browser cache). Local startup/HTTP route checks
passed for both static servers and the supplied-bundle server; no game launch or
provider-asset request was made. This was an uncommitted candidate copy, not a
clone or security audit of the eventual frozen commit and its history.
These checks are **not** an end-to-end validation of the active lobby's safety or
cache-effect claims. Final clean-clone, supplied-bundle demo and matched evidence
must be checked against the eventual final commit.

Open issues include the active authorization boundary, launch timeout cleanup,
readiness heuristics, global concurrency/budget enforcement, browser-condition
gating, destination validation, fixed locale/tier, unsupported cache/ETA copy and
biased/mismatched benchmark paths. No authoritative accepted-input result,
catalogue-wide coverage, production improvement or revenue uplift is claimed.
See the four documents for the detailed boundaries and release gates.

## Submission documents and disclosure

- [Architecture](docs/architecture.md)
- [Impact case — D3](docs/impact-case.md)
- [Compliance note — D4](docs/compliance-note.md)
- [Dependencies, permissions and AI assistance](docs/dependencies.md)

Computer/cptr assisted with audit, planning, documentation and repository
packaging. The team must confirm the complete assistance record and any required
written permissions. Removing internal agent instructions does not remove this
disclosure obligation. Keep the repository private, verify designated reviewer
read access, resolve permission/security/history gates, and record the final
commit only when the package is approved for freeze.
