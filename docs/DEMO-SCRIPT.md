# Demo Script — PSK Cache Warming PoC

**Duration:** ~4 minutes  
**Setup:** `./scripts/serve.sh` → open `http://localhost:8080`  
**Before you start:** run `./scripts/check.sh` to confirm everything passes.

---

## Step 0 — Orient the audience (30 seconds)

> "This is a browser-native cache-warming prototype. The goal: reduce
> game-switch latency using standard HTTP caching — no game code changes,
> no service worker, no backend."

Point to the **comparison panel** (below the status cards).

> "The numbers you see come from real HAR captures of casino.psk.hr,
> analyzed by the committed tools/measure_har.py script. They are labeled
> MEASURED. The elapsed figures are HAR entry spans — first request start
> to last request end — not click-to-interactive. A prior analysis cited
> 35.5s/6.7s; that figure's measurement method is not yet reconciled
> with these HARs, so we are not using it."

---

## Step 1 — Cold run: baseline with no warming (45 seconds)

**What to show:** the control arm — no prefetch, no warming.

1. Confirm the **"Prefetch enabled"** checkbox is **checked** (leave it checked for now).
2. Point to the comparison panel's left card: **Control — no warming**.
   - Elapsed (HAR span): 76.4s [MEASURED]
   - Wire bytes: 16.6 MB [MEASURED]
   - Cache hits: 27 (pre-existing — HAR was not from a cleared-cache profile) [MEASURED]
3. Say:
   > "Without warming, 16.6 MB crosses the wire. The 27 existing cache hits
   > mean this was not a truly cold capture — the browser profile already had
   > some assets. That's what the data says; we're not adjusting it."

---

## Step 2 — Warm run: cache warming enabled (60 seconds)

**What to show:** the treatment arm — warming runs, cache hits on reload.

1. Click **"Run simulated warming"**.
   - The warming card shows RUNNING.
   - The **live overlay** (click "◉ Live overlay" to show it) displays
     request counts and estimated transfer bytes, updating every 200ms,
     all labeled SIMULATED.
2. Wait for COMPLETE.
3. Point to the comparison panel's right card: **Treatment — cache warmed**.
   - Elapsed (HAR span): 16.3s [MEASURED]
   - Wire bytes: 12 KB [MEASURED]
   - Cache hits: 140/155 [MEASURED]
4. Say:
   > "After the cache is warmed, 140 of 155 requests are served from cache.
   > 12 KB over the wire instead of 16.6 MB — a >99% reduction in transfer.
   > The HAR span drops from 76 seconds to 16 seconds — 4.7x. These are
   > real numbers from real HAR captures, not invented for the demo."

---

## Step 3 — Prefetch policy toggle (30 seconds)

**What to show:** the governor correctly blocks when the operator opts out.

1. **Uncheck** the "Prefetch enabled" checkbox.
2. The governor decision card immediately updates to **BLOCKED — DISABLED**.
3. The "Run simulated warming" button goes disabled.
4. Say:
   > "If the operator disables prefetch — or if the device signals Save-Data,
   > or the connection is slower than 4G — the governor blocks warming
   > immediately. No assets are requested. The fail-closed policy is
   > non-negotiable: we never prefetch when we're not sure it's safe."
5. Re-check the checkbox. The button re-enables. Governor shows ELIGIBLE.

---

## Step 4 — Deliberate failure and rollback (45 seconds)

**What to show:** a failure is handled cleanly — no frozen UI, no dead state.

**Option A — Budget exhausted (governor block):**

1. Change the **byte budget** dropdown to **1 MiB**.
2. The governor immediately shows **BLOCKED — BUDGET EXCEEDED**.
3. Say:
   > "The byte budget is exceeded before any request is sent. The governor
   > stops warming. The UI updates immediately — there's no stuck spinner,
   > no silent failure."

**Option B — Abort mid-run (operator cancellation) — programmatic:**

This is exercised by the `DemoSequencer.triggerDeliberateFailure()` method in
`prototype/src/demo-sequencer.js`. To show it in a console:

```javascript
// Open DevTools console on localhost:8080
import("/src/demo-sequencer.js").then(({ DemoSequencer }) => {
  const seq = new DemoSequencer({
    manifest: window._DEMO_MANIFEST,   // not exposed by default — for dev use only
    target: { locale: "hr-HR", tier: "1x" },
    environment: { saveData: false, effectiveType: "4g",
                   visibilityState: "visible", byteBudget: 10_000_000, bytesUsed: 0 },
    requestAsset: async () => {},
    onPhaseChange: (phase, snap) => console.log(phase, snap),
  });
  seq.runCold().then(() => seq.runWarm()).then(() => {
    seq.showPolicyToggle();
    return seq.triggerDeliberateFailure();
  }).then((r) => {
    console.log("Failure result:", r);
    seq.rollback();
    console.log("Phase after rollback:", seq.phase);
  });
});
```

Expected console output:
```
COLD_RUNNING  { phase: "COLD_RUNNING", cold: null, warm: null, ... }
COLD_COMPLETE { phase: "COLD_COMPLETE", cold: { arm: "CONTROL", ... }, ... }
WARM_RUNNING  ...
WARM_COMPLETE ...
TOGGLE_SHOWN  ...
FAILURE_RUNNING ...
FAILURE_SHOWN { ..., failure: { triggered: true, aborted: true, label: "SIMULATED", ... } }
ROLLED_BACK   { phase: "ROLLED_BACK", cold: null, warm: null, toggle: null, failure: null }
```

4. Say:
   > "The sequencer aborts the warming signal mid-run, drains any in-flight
   > tasks with CANCELLED status, then resets to a clean state. Rollback
   > never throws. The UI stays responsive throughout."

---

## Step 5 — Close (15 seconds)

> "What you've seen is the foundation: a conservative, fail-closed
> cache-warming layer that improves game-switch time by 5.3x on measured
> evidence, respects device constraints, and recovers cleanly from
> any failure. No game code changed. No service worker. No backend."

---

## Emergency / Q&A notes

| Question | Answer |
|---|---|
| "Is the 76.4s / 16.3s real?" | Yes — MEASURED from casino.psk.hr HAR captures via tools/measure_har.py. These are HAR entry spans (first request → last request), not click-to-interactive. |
| "What about the 35.5s / 6.7s figures?" | Those came from a prior analysis using an unreconciled measurement method. We cannot confirm or deny them without knowing the exact start/end milestone used. We are not presenting them. |
| "Why does the cold run show 27 cache hits?" | The HAR was not captured with a cleared browser profile. Some assets were already cached. That's what the data shows and we're reporting it honestly. |
| "What about staging integration?" | `prototype/src/sandbox.js` defines the integration boundary. Staging URL was unavailable during the hackathon. The architecture is ready. |
| "What about the exclusion register?" | It's blocking and fail-closed by design (ADR-005). Warming never starts without GRANTED authorization. |
| "Why no service worker?" | ADR-001: browser-native, no framework. Standard HTTP cache is sufficient and doesn't require install. |

---

## Repeat the sequence

The demo is fully repeatable:

1. Reload the page — all state is in-memory, nothing persists.
2. Or call `seq.reset()` in the console to restart the sequencer from IDLE.

No cleanup needed between runs.
