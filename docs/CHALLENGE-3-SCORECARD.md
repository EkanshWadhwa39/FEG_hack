# Challenge 3 — where the build stands against the brief

One table per section of the brief. Honest about what is measured, what is
projected, and what is not there.

Labels: **MEASURED** (we ran it), **BUILT** (in the product, effect not isolated),
**PARTIAL**, **NOT BUILT**, **UNKNOWN**.

---

## The five areas the brief expects innovation in

| Area | Status | What exists |
|---|---|---|
| **Prediction and prefetching** | **MEASURED** | A graduated speculation ladder: transport hint on first sight, 2.8 MB blocking profile at ~200 ms dwell, a whole engine at ~600 ms of sustained dwell or a touch-down. Signal strength caps the rung — a guess buys a socket, only present-moment attention buys an engine. Plus lobby-load warming of last-played (30.4% hit@1, MEASURED), cross-session warm memory, and pointer-trajectory prediction. `docs/SPECULATION-LADDER.md` |
| **Edge / CDN and caching strategy** | **PARTIAL** | Ours: exact-URL warming against the provider's real cache keys, no normalisation, resolution and locale resolved before any request. Already done by the provider: `max-age` ≈ 19 years, `ACAO: *`, brotli. Not ours to do: `103 Early Hints`, HTTP/3, edge placement — inventoried in `docs/REMAINING-LEVERS.md` §E |
| **Progressive and perceived loading** | **BUILT** | Poster discipline (320×320 WebP, ~7.6 KB, intrinsic dimensions so the grid cannot shift, first rail eager and the rest lazy, `content-visibility` on offscreen rails). A transition screen that paints a correct branded frame in **0–2 ms MEASURED**, showing real session state rather than a manufactured checkpoint |
| **Lobby-to-game transitions** | **BUILT** | The transition screen is the authorization boundary, not decoration: it paints, the exclusion-register check blocks, and only then is a frame revealed or attached. A denial says so on the screen the player is already looking at. Engine retention holds a departed game for 45 s so re-entry is a reveal — **0 ms MEASURED** |
| **Instrumenting real vs perceived** | **BUILT** | Two clocks per launch, never merged: click→branded-screen and click→frame-load. Live p50/p95, split by which rung served the launch. The limits of in-page measurement are stated on the panel itself, not buried |

---

## The five metrics

| Metric | Target | Where it stands |
|---|---|---|
| **Cold load p50 / p95** | < 500 ms | **MEASURED in-page.** Pre-initialised path: **1–2 ms p50**. Baseline path: **~550–580 ms** to the frame's `load` event with no authorization latency. Out-of-page (`tools/sandbox_measure.mjs`, 40 ms RTT, median of 3): click→engine-canvas **542 ms cold / 450 ms warm-bytes / 124 ms pre-init**; click→assets-quiet **4,848 ms cold / no further network pre-init** |
| **Launch-to-play conversion** | — | **UNKNOWN, and reported as UNKNOWN.** "Play" means an accepted bet. The sandbox has no provider backend and the parent cannot see inside a cross-origin frame, so there is no honest way to compute it here. It is not approximated |
| **Games sampled per session** | higher | **Instrumented** as distinct titles launched. The mechanism that should move it — a wrong guess costing the player nothing — is built; whether it *does* move it needs real players |
| **Perceived-load quality** | — | **MEASURED** as click→branded screen: **0–2 ms**, on every path including cold. Reported separately from real load, always |
| **Cache hit / prefetch accuracy** | higher | **MEASURED live.** Of the titles speculative bytes were actually spent on, how many the player launched. Free transport hints are excluded — a bet that costs nothing to lose must not flatter the accuracy figure |

### The honest reading of the headline

**The 500 ms target is met on the pre-initialised path and not on the baseline
path, and the gain is raw speed rather than perceived.** The engine's ~4.8 s of
decode, GPU upload and script execution still happens — it happens during browse
instead of after the click. Nothing was made faster; the work was moved off the
critical path.

Two things that follow, and both belong in the pitch:

- **It only pays when the guess is right.** Hit rate is the whole economics, which
  is why the ladder spends by evidence strength, why accuracy is on the scoreboard,
  and why the cheap rungs exist to catch the cases the expensive one misses.
- **The in-page number is a floor, not a full account.** For this package the
  engine keeps streaming past its own `load` event. The 4.8 s figure comes from
  outside the page and is the number the baseline should be judged on.

---

## The guardrail

> Speed must not bypass anything that protects the user.

| Requirement | How it is enforced |
|---|---|
| Exclusion-register check is never bypassed | It gates **every rung**, not only the launch. Warming a title for a self-excluded player is speculative work on a launch that must never happen, so a denial stops the ladder, aborts warming already in flight, refunds the budget, and tears down any engine |
| Its cost is carried, not optimised away | A demo slider injects exclusion-check latency. Every millisecond lands **inside** the reported launch time. The check is never raced, cached, or rendered past |
| A blocked launch is not a fast launch | Blocked launches are excluded from the speed distribution and counted separately. Including them would let the guardrail flatter the numbers |
| RG state stays at full fidelity | The transition screen shows live session length, net position and limit headroom. It shows **real state and never a manufactured checkpoint** — `CODE.md` forbids inventing a reality check to fill loading time, and the screen exists because the player is owed the information |
| Certified packages unaltered | The sandbox serves the provided bundle byte-for-byte. No service worker, no request interception, no custom cache. Warming issues ordinary credential-free GETs at the package's own exact URLs |
| Predictor output never reaches the player | Rails are the player's own history or a fixed order identical for everyone. `buildRails` returns `algorithmic: false`; a browser test asserts the rendered titles, providers, chips and order are unchanged before and after the ladder climbs. The per-tile ladder badge is operator instrumentation behind a toggle |

---

## What is not there

| Gap | Why it matters |
|---|---|
| **No staging validation** | Every cache-reuse result is from a local sandbox. Production/staging partition behaviour, CORS, `Vary`, and real exclusion-register latency remain UNKNOWN. This is a blocking later gate, not a hackathon claim |
| **Does "playable" gate on all 143 assets?** | The single highest-value unknown. If the spin control activates on a subset, today's real warm number may already be 1–2 s rather than 4.8 s. **Only FEG can answer this, and it costs nothing to ask** |
| **One title, one provider, one browser family verified end to end** | Chromium and Firefox both verified for the lobby and the ladder. Cross-provider bundle behaviour is confirmed for Spiniq only |
| **No real-device mobile run** | Touch intent is built and tested under emulation. Memory, battery and thermal cost of a speculative engine on a real mid-range phone is not measured |
| **Launch-to-play, and whether discovery actually improves** | Both need real players. The instrumentation is in place to answer them the moment there are any |

---

## The side-by-side to demo

Same page, seconds apart, identical packages, judge picks the tiles.

1. Click a tile you never touched → baseline path, frame load ~550 ms, engine still streaming for seconds after.
2. Rest on another tile until its badge reads `ENGINE` → click → **1–2 ms**, no further network at all.
3. Tick **Simulate exclusion-register denial** mid-warm → the ladder stops, warming aborts, the budget refunds, the engine is torn down, and the player is told on the screen they are already looking at.
4. Drag **Exclusion-register latency** to 900 ms and launch again → the number goes up by 900 ms. The guardrail costs what it costs.
5. Tick **Disable speculation** → the control arm, in the same page.

Reproduce the out-of-page numbers with:

```bash
node tools/sandbox_measure.mjs --runs 3
```
