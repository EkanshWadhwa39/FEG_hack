# Warm-latency optimization plan

Scope: how *fast* caching happens, not *what* gets cached. The prefetch policy
and prediction work is a separate contribution and is out of scope here.

Concurrency stays at 2 (ADR-003). Every optimization below is *within* that
ceiling. Raising it is not on the table.

---

## 1. The metric

The codebase currently cannot observe warm speed. `warmAssets` returns
`REQUESTED`, not a proven cache hit, and `measure_har.py` measures bytes and
hit-classification, not latency.

- **`T_admit(asset)`** — ms from warm-trigger to the asset being readable from
  the HTTP cache by a subsequent iframe request. *Not* fetch-resolve. The gap
  between `await fetch()` resolving and the response being cache-readable is
  the most likely place speed work is currently invisible.
- **`T_ready`** — `max T_admit` over PRELOADER + COMMON + SPLASH + critical PRIMARY.
- **`U(t)`** — unwarmed critical bytes remaining at `t` ms after trigger.

**The objective is minimizing `E[U(t_click)]`, not `T_ready`.** The player
clicks when they click; warming does not get to finish. This is what makes the
correct scheduler stage-banded rather than pure shortest-makespan.

The hover-to-click delay distribution is **UNKNOWN**. Do not fabricate one.
Sample two delays (1s, 5s) and report the pair.

**Loopback trap:** the fixture server has RTT ~ 0, so transport wins measure as
noise locally and will be wrongly dismissed. Runs use CDP
`Network.emulateNetworkConditions` with one throttling profile, and every
resulting number is labelled `SIMULATED-NETWORK`.

---

## 2. Optimization surface

Ranked by expected effect on `E[U(t_click)]`:

| # | Lever | Site | Problem |
|---|---|---|---|
| 1 | Asset-origin preconnect | `connection-prewarm.js:28` | Only the *session* origin is hinted. First warm fetch to the asset CDN pays full DNS+TLS. Measured: DNS+connect was 83.3% of the session call. |
| 2 | Cache-admission lag | `browser-requester.js:76` | `response.ok` is checked but the body is never drained. An undrained response may never be admitted to cache. Correctness bug, not just speed. |
| 3 | FIFO scheduling | `warmer.js:119-143` | Fixed 2-worker pool draws in manifest order; makespan is hostage to whichever worker draws the last large asset. |
| 4 | No priority hints | `browser-requester.js:77-82` | No `fetchPriority`. Speculative warms compete equally with the lobby's own rendering. |
| 5 | No warm ledger | `warmer.js` (absent) | Hovering five same-provider titles re-issues COMMON five times and five-times-charges the governor budget. |
| 6 | No launch-time cancellation | `sandbox.js:92` | `AbortSignal` is plumbed but nothing aborts *other titles'* warms on click; they compete with the real launch. |
| 7 | Triple validation before first byte | `manifest.js:44` -> `warmer.js:113` -> `browser-requester.js:75` | O(N) main-thread work ahead of first byte. Real but small — do not spend a wave on it. |

---

## 3. Execution

```
Wave 1 (parallel, Sonnet, no browser)
  A1 warm-clock   — telemetry + analyzer      (new files only)
  A2 transport    — preconnect/priority/drain (browser-requester, connection-prewarm)

Wave 2 (orchestrator, inline)
  scheduler       — stage-banded LPT + warm ledger (warmer.js)
  admission probe + browser A/B  (holds browser lock)
  compliance audit against the ten AGENTS.md invariants
  ADR in docs/DECISIONS.md, integrate, commit
```

Never more than one browser holder. Specialists do not commit; the
orchestrator integrates.

**Definition of done:** a `U(t)` comparison for the current vs new scheduler,
from isolated runs under one throttling profile, at two click delays — with
concurrency still 2, authorization still blocking and fail-closed, and every
number labelled and scoped to browser, title, provider, and run count.

**Biggest risk:** if admission lag dominates, the scheduling work matters far
less than the drain fix. That is why measurement is Wave 1.
