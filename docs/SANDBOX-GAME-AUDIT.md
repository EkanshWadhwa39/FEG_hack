# Supplied game: sandbox feasibility and fresh local boot audit

## Decision

The supplied Empire of Gold archive is valuable real asset/engine input, but **a six-second playable baseline is UNKNOWN**. Do not plan a promised six-to-one-second improvement around it.

The archive was read directly, not patched, extracted over, or supplemented with replacement provider assets. New diagnostics were run for this audit; no staging or production traffic was used.

## Static audit

**STATICALLY-INFERRED — this supplied Empire of Gold build only:**

| Finding | Result |
|---|---:|
| Archive files, including metadata | 379 |
| Uncompressed bytes, including metadata | 101,637,202 |
| Atlas files | 42 |
| Atlas-page references without a matching relative archive member | 20 |
| Unresolved references in `@0.5x` / `@1x` | 10 / 10 |
| `book.png` present | No |
| Dynamically referenced `offline-data-…js` present | No |

The older 101,631,054-byte inventory excludes a 6,148-byte metadata item; these totals have different scopes.

Missing relative atlas pages include book, cards and jackpot-family textures. An unresolved static path is **not automatically a runtime failure**: some may be unused, served by an operator path mapping, or dependent on another environment. The `book.png` dependency did fail in the actual local boot probe below. Neither missing assets nor dependency completeness can be repaired by cache warming.

## Runtime method

**MEASURED — three serial fresh browser processes:**

- Empire of Gold / SpinIQ; Chromium 136.0.7103.25, Playwright 1.52.0.
- Linux host, headless, viewport 1280×720, device scale factor 1.
- Unchanged archive bytes served directly over loopback HTTP.
- **SIMULATED response policy:** `no-store` plus restrictive CSP.
- External browser requests blocked through routing and CSP; service workers blocked.
- No network or CPU throttling, no real authorization integration and no wager/input probe.
- Nominal observation window: 15 seconds after DOMContentLoaded. Browser work delayed collection; actual snapshots occurred 19.924–22.185 seconds after navigation.
- Playwright routing disables HTTP caching. This is a **fresh-boot feasibility diagnostic, not a CONTROL/TREATMENT cache experiment**.

A separate generic WebGL2 capability probe on the same headless configuration reported ANGLE/Vulkan SwiftShader and two logical processors. This establishes a software-rendering environment, not which provider operation caused a particular long task. No GPU stage was individually profiled.

## Observations

All numeric observations below are **MEASURED locally**. The input-accepted row is **UNKNOWN**.

| Observation | Run 1 | Run 2 | Run 3 |
|---|---:|---:|---:|
| DOMContentLoaded (ms from navigation) | 355.4 | 355.2 | 522.6 |
| Window load (ms) | 498.3 | 491.1 | 661.9 |
| First contentful paint (ms) | 128 | 128 | 108 |
| First canvas attachment (ms) | 347.3 | 347.4 | 513.8 |
| Canvas dimensions | 1280×720 | 1280×720 | 1280×720 |
| Browser request events | 146 | 146 | 146 |
| Observed 200 / 404 responses | 143 / 1 | 143 / 1 | 143 / 1 |
| `book.png` returned 404 | Yes | Yes | Yes |
| Completed CDP encoded transfer bytes | 45,434,839 | 45,434,839 | 45,434,839 |
| Last completed Resource Timing entry (ms) | 15,038.8 | 17,676.0 | 13,104.4 |
| Long-task count | 22 | 23 | 23 |
| Long-task total duration (ms) | 18,412 | 16,368 | 18,713 |
| Longest observed task (ms) | 3,042 | 3,318 | 3,277 |
| Cumulative script duration (ms) | 1,823.9 | 2,023.5 | 2,439.6 |
| JS heap used at snapshot (bytes) | 26,817,408 | 24,594,040 | 26,799,664 |
| Authoritative input-accepted time | UNKNOWN | UNKNOWN | UNKNOWN |

Request events, responses and completed timing entries have different lifecycles; they are not required to have identical counts. CDP encoded transfer bytes are not raw ZIP size, decoded object size, or approved prefetch budget. The launched engine can request far more than we are permitted to warm proactively.

Long-task totals span the whole observation window and may include continuous rendering. They are **not a direct measurement of startup-only CPU cost, shader time, or time saved by prefetch**. The diagnostic's blocking-time approximation is not a Lighthouse TBT score. Memory is JS heap only, not total process or GPU texture memory.

Zero `pageerror` events does not mean successful loading: console/asset failures can occur without an uncaught exception. The explicit missing-image HTTP result remains a failure.

## What to optimize, and what not to promise

| Parameter | Present conclusion | Next action |
|---|---|---|
| Package completeness | Missing runtime texture; full readiness unestablished | Obtain complete approved package or use labelled reference scene |
| Cacheable transfer | One-object parent-to-iframe reuse proved separately | Build exact sandbox stage manifest; test same iframe topology |
| Locale / tier | Bundle has branching; this probe used one environment | Resolve and record actual runtime variant before warming |
| PRIMARY criticality | Not established by all early request timestamps | Start with no speculative PRIMARY until a dependency/milestone proof exists |
| CPU / decode / GPU | Significant long tasks in this host configuration | Profile representative hardware; do not credit cache with eliminated execution |
| HTTP delivery | Diagnostic is intentionally no-store/uncompressed | Test compression/cache configuration in separate symmetric experiments |
| Authorization | No real service involved | Simulated allow/deny/error/timeout contract, separate from game assets |
| First accepted input | No validated provider signal captured | Approved provider event or honestly named reference-scene signal |
| Six-second local load | Not reproduced as an authoritative milestone | Record the original device, start event and end event if available |
| Cross-title behavior | One actual build | Label catalogue aliases synthetic; test cross-alias cache isolation |

A faster paint, canvas attachment or missing-resource failure is not a faster playable game. Do not remove failing dependencies, edit provider code, insert hidden placeholders or use altered game bytes to manufacture a successful treatment.

## Reproduce

Raw archive remains private and is not included in a clean clone. Obtain it through an approved organiser/team channel.

```bash
./scripts/bootstrap.sh
npx playwright install chromium
.venv/bin/python tools/local_game_probe_server.py \
  --zip 'FEG Innovation Hackathon 2026/empireofgold (1).zip' --inventory
node tools/probe_local_game.mjs \
  --zip 'FEG Innovation Hackathon 2026/empireofgold (1).zip' \
  --runs 3 --observe-ms 15000
```

The tools emit only aggregate results and read-only local diagnostics. They do not emit provider source, credentials, full request URLs, bodies or logs. Generated aggregate JSON is retained under ignored `evidence/derived/local-game-{inventory,boot-probe}.json`; the table above is the shareable result.

Synthetic tests do not need the archive:

```bash
.venv/bin/python -m pytest -q tests/test_local_game_probe_server.py
node --check tools/probe_local_game.mjs
```

See [SANDBOX-FINAL-PRODUCT-PLAN.md](SANDBOX-FINAL-PRODUCT-PLAN.md) for the updated evaluated deliverable and fallback decision.
