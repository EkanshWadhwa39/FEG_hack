# FEG Hackathon Agent Contract

Read `CODE.md` completely before doing any work. It is the authoritative technical and compliance brief. Then read `Context/FINAL-PLAN.md`. Consult the other `Context/` documents for evidence, but do not revive their native-SDK proposal: this build is web-only.

## Mission

Prove that the PSK lobby can warm the browser HTTP cache *before* launch and reduce same-title launch transfer/time, without modifying certified game code or bypassing mandatory checks.

## Non-negotiable invariants

1. Web/mobile-web only. No native app, service worker, custom cache, or provider-code modification.
2. Never cache, race past, bypass, or optimistically render past the exclusion-register authorization. Error, timeout, malformed response, and denial fail closed.
3. Predictor output affects speculative cache requests only. It never changes player-visible ordering, recommendations, styling, or focus.
4. Never expose player hashes, tokens, cookies, Authorization headers, launch URLs with credentials, or exclusion payloads. Redact HARs before display.
5. Resolve exact locale and resolution tier before prefetch. Use exact production URLs, including version query strings. Never normalize cache keys in browser code.
6. Proactive warming includes only PRELOADER, COMMON, SPLASH, and a proven critical PRIMARY subset. Never proactively warm SECONDARY.
7. A UI may say `interactive` only after an authoritative input-accepted signal. iframe load/first paint is not playable.
8. Label every number and state as `MEASURED`, `FEG-PROVIDED`, `STATICALLY-INFERRED`, `SIMULATED`, or `UNKNOWN`.
9. Scope every result to the browser, title, provider, and number of runs actually tested. Do not claim native or catalogue-wide coverage.
10. Do not edit or commit raw data, media, HAR evidence, provider bundles, or credentials.

## Priority order

1. Reproduce exact parent-to-iframe cache reuse in the demo browser and preserve evidence.
2. Build the HAR measurement/redaction harness.
3. Build one-title exact-manifest warming with isolated cold/treatment runs.
4. Add bounded governor, truthful transition state machine, and failure fallback.
5. Add policy toggle only after the causal proof passes.
6. Polish UI and pitch last.

## Repository ownership

- `prototype/`: browser product code and JS tests.
- `tools/`: Python evidence and data-analysis utilities.
- `tests/`: Python tests.
- `docs/`: decisions, runbooks, evidence index, and handoffs.
- `evidence/derived/`: redacted/generated summaries only; raw HARs remain in `Devtools_games/`.

## Engineering rules

- Prefer vanilla HTML/CSS/ES modules. No framework or build step unless explicitly approved.
- Prefer pure functions and dependency injection for browser APIs (`fetch`, clock, connection, observers).
- Maximum prefetch concurrency: 2. Missing browser capability must degrade conservatively without crashing.
- Do not load multi-GB CSVs with pandas. Query them with DuckDB or Polars lazy scans and project only required columns.
- Every code task includes tests and a handoff: files changed, commands run, result, risks, and next action.
- One agent owns a file at a time. Sub-agents should review or work on disjoint files; the orchestrator integrates.
- Never let multiple agents run production-browser experiments simultaneously; shared cache/network state invalidates evidence.

## Required checks

```bash
./scripts/check.sh
./scripts/serve.sh
.venv/bin/python tools/measure_har.py --help
```

## Definition of done for the core claim

A clean control HAR and a clean treatment HAR exist from isolated browser profiles/contexts. The treatment began clean, was warmed only by prototype code before click, used the same title and milestone, and shows exact warmed URLs reused at launch. The result is reproducible and all sensitive fields are redacted before presentation.
