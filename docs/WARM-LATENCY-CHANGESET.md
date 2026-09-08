# Warm-latency changeset — independent verification brief

Everything in this session targeted **how fast warming happens**, not what gets
warmed. Prefetch policy and prediction were untouched.

This document exists to be handed to a reviewer who did not write the code.
It states what changed, what each change must not have broken, and where the
author is genuinely unsure. Nothing here is committed; the working tree is the
artifact under review.

## Who wrote what

| Change | Author |
|---|---|
| Scheduler, ledger, ADRs, telemetry id guard | orchestrator (Opus, this session) |
| Telemetry module + Python analyzer | subagent A1 (Sonnet) |
| Body drain, priority hints, asset-origin preconnect | subagent A2 (Sonnet) |

Two claims in A1's own report were wrong and were corrected during integration
(see "Corrections already applied"). Assume the same error rate elsewhere.

## Files

**New**

| File | Lines |
|---|---|
| `prototype/src/warm-ledger.js` | 29 |
| `prototype/src/warm-telemetry.js` | 189 |
| `prototype/tests/warm-telemetry.test.mjs` | 218 |
| `tools/measure_warm_latency.py` | 189 |
| `tests/test_measure_warm_latency.py` | 141 |
| `docs/WARM-LATENCY-PLAN.md` | 77 |
| `tools/probe_drain_admission.mjs` | 168 |
| `evidence/derived/drain-admission-probe.json` | artifact |

**Modified** — 514 insertions, 21 deletions

| File | Delta |
|---|---|
| `prototype/src/browser-requester.js` | +115 / -~6 |
| `prototype/src/connection-prewarm.js` | +68 / -~9 |
| `prototype/src/warmer.js` | +69 / -~6 |
| `prototype/tests/browser-requester.test.mjs` | +104 |
| `prototype/tests/connection-prewarm.test.mjs` | +74 |
| `prototype/tests/warmer.test.mjs` | +105 |
| `docs/DECISIONS.md` | ADR-007, ADR-008 |

**Untouched but pre-existing dirty:** `prototype/sandbox.html`,
`tools/sandbox_server.py` (mtimes 15:35 / 15:46, before this session began at
16:35). Not part of this changeset. Do not review them as such.

## The five changes

### 1. Stage-banded dispatch (`warmer.js`)

The fixed two-worker pool no longer draws in manifest order. It draws in
consumption order — PRELOADER, COMMON, SPLASH, critical PRIMARY — and
largest-first *within* each band only.

Rationale is `E[U(t_click)]`, not makespan: a player clicks whenever they click,
so unwarmed critical bytes remaining at click time is the quantity that decides
whether warming helped. See ADR-007.

`dispatchOrder()` returns indices into the original array so `summary.results`
stays addressable by the caller's ordering.

**Must still hold:** concurrency never exceeds 2; no band is ever pulled ahead
of an earlier band; SECONDARY is still unreachable; results still omit URLs.

### 2. Session warm ledger (`warm-ledger.js`, wired into `warmer.js`)

Optional injected ledger. An exact URL already warmed this page-lifetime is
skipped with a new `WarmStatus.SKIPPED`. A **failed** request is deliberately
not recorded, so it retries.

**Must still hold:** the ledger key is the exact URL string, never normalized,
lowercased, sorted, or query-stripped. `?v=17&a=1` and `?a=1&v=17` are two
distinct objects and must both be warmed. There is a test for this; check it
actually asserts what it claims.

### 3. Response body drain (`browser-requester.js`)

Speculative requests now consume the body before resolving — `pipeTo` into a
discarding sink, with `getReader()`/`arrayBuffer()` fallbacks. Opaque
(`no-cors`) responses are skipped untouched.

**MEASURED, and it refuted the original rationale.** The drain was added on the
belief that an unread body may not be cached. `tools/probe_drain_admission.mjs`
tested exactly that: Chromium 136.0.7103.25 admitted and reused the response in
2/2 runs of *both* arms. Draining is **not** required for admission here.

The drain is kept for a different reason. `fetch()` resolves at response
headers, not at body completion, so a worker awaiting only `fetch()` frees its
slot mid-transfer — meaning the concurrency-2 ceiling would bound requests in
flight, not bodies in flight. The drain is what makes ADR-003's ceiling mean
what it says. **That reasoning is from documented `fetch()` semantics and has
not itself been measured** — peak concurrent transfer count is an outstanding
measurement and a good thing for a reviewer to attack.

**Must still hold:** an aborted signal mid-drain must not be reported as a
success; opaque responses must never have `.body` touched.

### 4. Priority hints (`browser-requester.js`)

`priority: "low"` on speculative fetches, per-call override for launch-time
upgrade, feature-detected against `Request.prototype` so unsupported platforms
omit the option rather than throwing. Node 22 lacks it, so the option is absent
under test — meaning **the hint is effectively untested in a real browser.**

### 5. Asset-origin preconnect (`connection-prewarm.js`)

`prewarmConnectionOnDrawerOpen` now takes `exactAssetOrigins[]` and hints the
session endpoint plus each asset origin through one adapter instance, so the
existing `hintedOrigins` Set dedupes across all targets.

**Must still hold:** hints emit only after the governor allows; no session call,
no session creation, no launch advance; the synthetic adapter still does zero
I/O.

## Corrections already applied

- **A1 understated its privacy guard.** It reported rejecting ids containing
  `://`. That was the entire guard (`/:\/\//`), so relative paths —
  `/hr-HR/1x/common.js?v=17`, `assets/locale/hr/x.png`, precisely this
  codebase's shapes — were accepted into telemetry records. Replaced with
  `^[A-Za-z0-9_-]{1,64}$` plus a regression test. **Re-verify this independently.**
- **A1 misreported its interpreter**, claiming `.venv/Scripts/python.exe` was
  absent. It exists; system Python has no pytest, so its stated command could
  not have produced its stated result. The tests do pass under the venv.

## Verification gate

```
npm test                                          # 136 tests, 136 pass, 0 skipped
./.venv/Scripts/python.exe -m pytest tests/ -q    # 43 passed
./.venv/Scripts/python.exe -m ruff check tools tests
npm run check:js
node tools/probe_drain_admission.mjs --runs 2
```

On Windows use `.venv/Scripts/python.exe`, not `.venv/bin/python`.

The browser suite requires `npm install` plus `npx playwright install chromium`
**after** the local `playwright@1.52.0` resolves — installing the browser first
fetches the wrong revision (1243 instead of the pinned 1169) and the suite
silently skips rather than failing.

## Invariants a reviewer should attack

1. Does any change let a speculative request precede, race, or survive a failed
   exclusion-register authorization? Authorization is blocking and fail-closed.
2. Is any URL rewritten, normalized, reordered, or reconstructed anywhere on the
   request path? `requireCredentialFreeHttpsUrl` returns its input unchanged
   **on purpose** — a changed cache key voids the whole mechanism.
3. Does any URL, token, cookie, header, or player identifier reach a return
   value, error message, telemetry record, or emitted JSON?
4. Can speculative concurrency exceed 2 by any path, including the ledger's
   skip path and the prewarm loop?
5. Is SECONDARY reachable for proactive warming by any path?
6. Is every number emitted by `measure_warm_latency.py` labelled `MEASURED`,
   `SIMULATED-NETWORK`, or `UNKNOWN`? Is `T_ready` `UNKNOWN` rather than `0`
   when nothing eligible has been admitted?
7. Do the new tests assert real behavior, or do they assert the implementation
   back to itself? Check the ledger exact-key test and the drain tests hardest.

## What is NOT established

The **scheduler** has no control/treatment run behind it. ADR-007's stage-banded
ordering is a design argument about `E[U(t_click)]`, not a measured improvement.
The `U(t)` machinery to measure it now exists and is untested against a real
waterfall.

The **priority hint** is untested in a browser: Node lacks
`Request.prototype.priority`, so the option is absent under `npm test`.

The **peak concurrent transfer count** claim behind keeping the drain is
reasoned, not measured.

The local fixture server is loopback (RTT ~ 0), so any run without CDP
throttling understates transport effects; such numbers are `SIMULATED-NETWORK`,
never `MEASURED` for production. Staging remains unavailable (ADR-006).

Production CORS, cache-control, `Vary`, partition, and admission behavior remain
`UNKNOWN`.
