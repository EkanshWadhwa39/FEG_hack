# Empire confinement / interrupted-handoff recovery

Historical recovery pass. Subsequent guarded-browser work, the empty procfs-link regression fix, source-document reconciliation, current test counts and retained calibration failures are recorded in [EMPIRE-MEASUREMENT.md](EMPIRE-MEASUREMENT.md). Do not treat the remaining-work list below as the newest status.

Scope: private `integration/empire-catalogue` worktree only. No merge, commit, push, provider execution, raw HAR access, or provider/archive modification in this recovery pass. Main, team and content-core branches were not edited.

## Recovered baseline

The latest interrupted server specialist saved adversarial tests but not the corresponding fixes. Fresh checks found **MEASURED: 204 Python server tests passed, 39 failed**. The UI/observation/core boundary suite passed **MEASURED: 57/57**, but the UI still said an isolated interactive launcher did not exist.

## Files changed by the recovery lead

- `tools/empire_catalogue_server.py`: reject duplicate procfs status fields; validate exact hexadecimal/decimal route field shapes and contiguous IPv4 masks; sanitize inspection/probe parsing failures; validate parent-PID observations; reject confinement-mode mutation and recheck the archive signature before binding; forbid the reviewed provider release through the synthetic-fixture escape, including checking its digest before ZIP inspection.
- `prototype/empire-demo.html`: describe the existing isolated graphical launcher, graphical-display requirement, headless alternative, and UNKNOWN visual acceptance. Ordinary browser access remains unsupported.
- `prototype/tests/empire-ui-contract.test.mjs`: add a regression test for those reviewer instructions.
- This handoff.

The interrupted specialist's saved additions in `tests/test_empire_catalogue_server.py` supplied the confinement regressions; this recovery did not weaken or remove them.

## Fresh validation

All counts are **MEASURED on this working tree**, not a frozen or submitted commit.

| Check | Result |
|---|---|
| `.venv/bin/python -m pytest tests/test_empire_catalogue_server.py -q` | 243 passed; all 39 previously failing cases now pass |
| `node --test prototype/tests/empire-ui-contract.test.mjs prototype/tests/empire-observation.test.mjs prototype/tests/empire-core-boundary.test.mjs` | 58 passed |
| `./scripts/check.sh` | 457 Python + 582 JavaScript tests passed; Python lint, JavaScript syntax (83 files), and shell lint passed |
| `.venv/bin/python tools/measure_har.py --help` | Passed, no HAR input |
| `PORT=8188 BIND=127.0.0.1 ./scripts/serve.sh` + bounded localhost GET `/index.html` | Passed; temporary static server stopped; no browser or provider execution |
| Direct host server CLI entrypoint with reviewed pin and nonexistent synthetic-only path | Returned failure as required; generic error, no provider data used |

The first static-smoke shell invocation failed before startup because the tool command shell was `/bin/sh`, which rejected `set -o pipefail`. Repeating with POSIX `set -eu` passed.

## Boundaries and remaining work

- These tests use synthetic archives and mocked kernel observations; the direct-host refusal adds only a local negative check. They do not establish end-to-end isolated-browser acceptance.
- The launcher/firewall boundary is not a defense against a malicious administrator or arbitrary Python-code mutation. The constructor-only fixture escape rejects this pinned provider release; it does not classify every possible provider archive as nonsynthetic.
- No new namespace/browser experiment, paired HAR, performance gain, provider-tier observation, accepted gameplay input, or visual acceptance was established here. Those remain **UNKNOWN/unverified in this recovery pass**.
- The integration worktree retains older `CODE.md` / `Context/FINAL-PLAN.md` copies. The root workspace's updated sandbox-only evaluation brief remains the current direction; reconcile reviewer documentation before freeze rather than reviving staging dependency claims.
- Next action: review the isolated runner's complete measurement/acceptance path, run serial isolated CONTROL/TREATMENT plus negative controls when authorized, then validate the graphical reviewer path in a supported display environment. Complete the pre-submission audit before any freeze/submission.
