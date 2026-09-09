# Impact case — BETA packaging snapshot

**Status: not submission-ready.** This note describes selected source `979aceb`,
with packaging paths updated to `src/`. It is not a new performance experiment,
a release approval, or end-to-end evidence of active-lobby behavior.

Read with [README](../README.md), [architecture](architecture.md),
[compliance](compliance-note.md), and [dependencies](dependencies.md).

## Problem and bounded proposition

Waiting for static game resources after a deliberate launch is avoidable work
if the same resources can be fetched during prior lobby browsing and subsequently
reused by the browser HTTP cache. Moving transfer before click may reduce launch
wait; it does **not** necessarily reduce total transfer or processing work.

Our evaluation target is **our own web/mobile-web sandbox only**. Staging is not
an evaluation dependency. The catalogue is **SIMULATED: 20 display slots**, each
mapped to the same **FEG-PROVIDED: one supplied unchanged game bundle**.
These are not independent games, provider integrations, or licensed new assets.
No model, training, new game assets, substitute/reference game, native client,
service worker, custom cache, or application database is part of this scope.

## What the beta actually does

**STATICALLY-INFERRED** from [the active lobby](../src/lobby.html):
- Warming is enabled by default; the first slot is automatically warmed.
- Hover/focus dwell can trigger warming of other slots; leaving cancels work.
- A direct requester drains successful fetch bodies into the browser's normal
  request/cache path. An in-memory URL ledger avoids repeated completed work.
- A governor checks the toggle and estimated budget, but receives hardcoded
  connection/visibility inputs. Concurrency is bounded per job, not globally.
- Clicking mounts the supplied game in an iframe and cancels background work.

This is an engineering hypothesis worth testing, not a quantified business win.
The active path lacks an exclusion-register authorization gate. Its readiness
heuristics, cache labels, and rollback behavior prevent a trustworthy playable-time
claim. See [architecture](architecture.md) for the implementation boundaries.

## Evidence ledger

| Item | Classification and reviewer interpretation |
|---|---|
| Catalogue and UI connection profile | **SIMULATED**; no observed player demand or actual network classification. |
| Lobby manifest | **STATICALLY-INFERRED**: 58 entries and fixed variants; not a demonstrated complete critical path. |
| Fetch/body counters | **STATICALLY-INFERRED instrumentation**; body size/estimates are not necessarily wire bytes or cache hits. |
| On-screen cold/warm ETA constants | **UNKNOWN validity**: 10.3 s and 3.5 s are source constants, not measurements established by this packaging review. |
| “100% cached”, “0 wire transfer”, “interactive” | **UNKNOWN** as launch outcomes; ledger completion and heuristic readiness do not prove them. |
| Packaging checks: 50 Python / 136 JS passes, zero skips | **MEASURED** on the relocated working tree; structure and existing component/supporting-player coverage, not causal active-lobby evidence. |
| Current causal transfer/time improvement | **UNKNOWN**; no qualifying current-lobby control/treatment result is asserted here. |
| Conversion, revenue, retention, harm effects | **UNKNOWN**; no numerical business uplift is claimed. |

Historical HAR comparisons are not reused as beta success evidence. Repeat-state
opportunity is not proof that this lobby caused a same-title launch improvement.
Browser, title/build, milestone, and run count must accompany any future result.

## Cost-benefit model, with explicit units

The following are **STATICALLY-INFERRED accounting formulas**, not fitted estimates.
For matched sandbox runs define:
- `T_C`, `T_T`: seconds from the same deliberate click to the same valid milestone
  in CONTROL (warming off) and TREATMENT (warming on).
- `B_C`, `B_T`: post-click wire bytes for that same launch window.
- `W`: all treatment speculative wire bytes, including cancelled/unused warming.
- `L_C`, `L_T`: other wire bytes in the identical observation window (including UI
  and font traffic), excluding bytes already counted in `B` or `W`.

Then report separately:
- Launch wait reduction: `delta_T = T_C - T_T` seconds; negative means regression.
- Launch transfer reduction: `delta_B_launch = B_C - B_T` bytes.
- Whole-window transfer saving: `delta_B_total = (L_C + B_C) - (L_T + W + B_T)`.
- Relative wait reduction, only when `T_C > 0`: `delta_T / T_C`.
- Useful warming fraction: `U / W`, where `U` is warmed wire-byte cost attributable
  to exact resources demonstrably reused in the defined window; undefined if `W=0`.

A fast warm launch with positive `delta_B_launch` can still have negative
`delta_B_total`. Report time spent warming and time spent browsing before click;
do not hide those costs by starting the clock only after warming finishes.

For a later authorised cost assessment, let `N` be eligible sessions per period,
`c_GB` the relevant delivery price per decimal GB, and `C_fixed` the period's
integration, testing, support, permissions, and maintenance cost in currency.
If per-session observations are representative:
`net_delivery_value = N * E[delta_B_total] / 1e9 * c_GB - C_fixed`.
All inputs and representativeness are **UNKNOWN** for this beta.
User data-plan, battery, CPU/GPU contention, cache eviction, and accessibility
costs require separate assessment; a CDN price alone does not capture them.

If the team later values reduced friction, define an independently measured
benefit `V_friction` and use `net_value = V_friction + net_delivery_value`.
Do not substitute increased betting, stake velocity, or time-on-device as an
assumed benefit. No currency-per-second or conversion multiplier is supplied.

## What would make the impact claim credible

These are gates for later authorised work, not experiments run for this package:
1. Establish truthful readiness and authorization handling, or limit the claim to
   an explicitly named weaker network milestone without claiming playability.
2. Reconcile the benchmark's enforced **36-entry** manifest with the lobby's
   **58-entry** manifest; a different warm set cannot validate this implementation.
3. Remove or explicitly isolate the server's **3.2× prefetch-classified throttle
   rate** when enabled. It is a configured asymmetry, not cache-warming benefit.
4. Use serial isolated CONTROL/TREATMENT profiles, the same title/build, locale,
   resolution, cache policy, network conditions, and milestone. Treatment must
   start clean and be warmed only by the actual lobby before click.
5. Collect exact-URL reuse evidence, whole-window wire costs, warm lead time,
   failures, cancellations, and uncertainty across a disclosed number of runs.
6. Redact evidence before sharing. Do not request production traffic to fill gaps.

## Decision at beta

Package for transparent review, not deployment or business extrapolation.
The mechanism may shift work earlier; whether that produces net user value is
**UNKNOWN**. Sandbox proof, if later obtained, would still not establish actual
FEG authorization behavior, production cache/CORS policy, or catalogue coverage.
No staging access, model training, or new/reference game is needed for this scope.
