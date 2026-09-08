# CLAUDE.md — FEG Hackathon Challenge 3: Game Load Time

This is the starting context for this project. Read this fully before writing any code. It contains everything already measured and decided — do not re-derive or re-guess anything listed as VERIFIED below; treat it as ground truth for this session.

---

## Mission, one line

Test whether PSK can reduce same-title launch transfer/time by warming eligible static assets in the browser's own HTTP cache after authorization and before the player clicks. Historical repeat-state HARs show a 5.3× asset-batch opportunity; they do not prove prototype causality.

**Evaluation update (latest team brief): judges will test our sandbox, not staging.** Build a complete local sandbox experience and collect causal control/treatment evidence there; staging is not a hackathon acceptance dependency. See `docs/SANDBOX-FINAL-PRODUCT-PLAN.md` for the current delivery plan and `docs/SANDBOX-GAME-AUDIT.md` for the unchanged-bundle feasibility audit. The current page remains a simulated scaffold until integrated. Real-site deployment still requires its own approved validation; never substitute production traffic or claim staging validation.

---

## Platform — do not deviate from this

**Web only. All devices, including mobile. No native app.** We have no access to build or test against any native Android/iOS surface. This was explicitly confirmed via a walkthrough video and is a hard constraint on scope, not a preference.

There is real telemetry showing a native-labeled "Casino Android" platform accounts for ~72% of actual game launches in production — we know this, we are not ignoring it, but it is out of scope for this build. State this honestly in any user-facing material: our mechanism (HTTP cache warming against stable content-hashed URLs) is standard browser behavior and *should* transfer to a WebView-based client, but we have not verified that and must not claim we have.

---

## VERIFIED — real measurements, do not re-model these

### Historical warm-state opportunity and local mechanism proof
Same game (SavannaSunriseDeluxe), historical cold vs repeat HAR captures, cache enabled:
- Cold: exact final 16-request asset batch completed at 35.568s from capture start; 16,597,198 wire bytes over 177 requests; parser classification: 27 confirmed cache hits, 148 misses, 2 unknown
- Warm: **the same exact batch completed at 6.714s; 12,431 wire bytes over 155 requests; parser classification: 140 confirmed cache hits, 14 misses, 1 unknown**
- The HAR pair measures repeat-state opportunity, not click-to-interactive or prototype causality. A separate controlled local experiment proves parent-to-iframe cache reuse for one exact object. Integrated sandbox proof is the next hackathon gate; real-site proof is required only before real-site enablement.

### Historical baselines have different milestones
- Brief says 6–8s. FEG's web-platform telemetry shows **25–31s across 12 months** for session-to-first-game-launched; that broader interval includes browsing and is not a click-to-ready baseline.
- The historical cold HAR's exact final asset batch completes at 35.568s from capture start; it does not contain an authoritative input-accepted event.
- Static bundle analysis identifies potential transfer/CPU costs but does not measure readiness.
- Do not equate these milestones. The sandbox comparison must preregister its own start and end events. The claimed six-second local playable baseline is UNKNOWN after the fresh boot audit.

### The session/handshake call is a connection problem, not a server problem
One historical `session/create` request measured 1,849.593ms total: DNS 494.022ms, connect 1,046.412ms (including an SSL subset of 321.076ms), and server wait 302.772ms. DNS plus connect is **83.3%** of total; SSL must not be double-counted. This measures a connection-setup opportunity for `preconnect`/`dns-prefetch` on drawer-open, but the causal milliseconds saved by hints remain **UNKNOWN** until an isolated approved-environment comparison is run.

### A real, measured, trivial waste
A 404 probe (`GameView/Egaming`) costs 712ms before falling back to a generic container view. Fix it; it's free.

### Bundle structure (static analysis, one provider: Spiniq / Empire of Gold SDK)
- **STATICALLY-INFERRED for this supplied build:** no anti-tamper, automation/headless detection, service worker, or SRI hashes were found. This narrows implementation risk but does not prove production cacheability or permission to warm.
- The archive contains content-hashed JavaScript and ordinary asset paths. Sandbox deployment URLs and policies must be explicitly configured and validated against actual requests. Real-site deployable URLs, response policy, credentials and eligibility require a later approved capture; never infer real production URLs from archive paths.
- Staged load order: **PRELOADER → COMMON → SPLASH → PRIMARY → SECONDARY**. Proactive warming is limited to PRELOADER, COMMON, SPLASH, and a proven critical PRIMARY subset; SECONDARY is never proactively warmed.
- **Two real failure modes to design around, found in the actual code:**
  1. **Resolution branching** — game picks `@1x` or `@0.5x` texture sets *after* JS executes, based on device info. Resolve device tier BEFORE issuing prefetch, or you waste ~30MB warming both tiers, or cold-miss on the wrong one.
  2. **Locale branching** — asset path is `assets/locale/${language}/...`, where `language` is injected at runtime by the operator frame, not present in the URL ahead of time. Read the launch config for target locale before warming.
- No `KHR_parallel_shader_compile` or async shader-compile hint — shader compilation is a real, unfixable-by-us cold-start cost. This is a "known ceiling" item, not a bug to chase.
- Production/staging cache-control, CORS, `Vary`, credential, redirect, and partition behavior remain **UNKNOWN**. The supplied archive cannot establish response headers, and this project does not use the Cache API.
- **New feasibility audit:** 20 relative atlas-page references are unresolved; `book.png` returned 404 in three fresh local boots. No authoritative input-accepted milestone was established. Preserve unchanged provider mode and offer a separately labelled reference scene rather than patching missing dependencies.

### Parent-to-iframe cache-reuse gate
The load-bearing behavior is exact parent-to-iframe browser HTTP-cache reuse under the target environment's real top-level context, URL, request semantics, and response policy. A controlled local Chromium diagnostic passed for one exact object, including exact-key and `no-store` negative controls. Its mapped top-level-site result must not be generalized. Staging/production partition and reuse behavior remain **UNKNOWN** until the later approved serial control/treatment gate.

### Historical popularity distribution — do not misrepresent synthetic journeys as real demand
Two independent real sources agree on a hard power law:
- 12mo aggregated stake data (4.2M rows, Croatia, no player-level info): top 10 games = 17.8% of stake, top 100 (3% of catalogue) = 58%, 29% of catalogue = near-dead long tail.
- Real event log (`casino_game_launch` events, 887 distinct titles, 13,682 launches, pseudonymized player IDs): top 10 by real launch count = 34.7% of all launches.
- Provider concentration: **top 5 providers = 69.8% of stake, top 10 = 90.9%.** Five-provider integration is realistic, not a guess.

### Real business-impact baseline (for the pitch, not the code)
- Session-to-game conversion on web: **42–54%** — nearly half of sessions never launch a game.
- Games-per-session, PSK vs other FEG markets: PSK is **lowest of 5 markets (2.43)** while having the **highest session frequency (16.2/player, highest of 5)**. High loyalty, low discovery — the exact pattern the brief names.

### Still unmeasured — do not fabricate a number for these
- **Exclusion-register check latency.** Every HAR so far is anonymous demo mode. This requires a real login on staging. Until measured, treat it as an unknown-latency BLOCKING call — never cache it, never race it, never optimize around it, regardless of what its real cost turns out to be.
- **Cross-provider generalization.** Bundle analysis is confirmed for one provider only (Spiniq). Verify additional providers only in an organiser-approved environment after access is restored; do not use public production traffic as an outage substitute.

---

## Architecture — what to build

No native interception layer. No `WebViewClient`, no Kotlin, no iOS parity questions. The mechanism is entirely JS/browser-native:

```
[ Authorization state: exclusion-register check has succeeded ]
        |  denial, timeout, malformed response, or unknown => no warming
[ Player browsing lobby ]
        |
Resource Governor (JS): navigator.connection, Performance Observer / Long Animation Frames, data budget
        |
Prefetch trigger: hover/dwell 150ms+, or drawer-open
        |
credential-free fetch of exact PRELOADER + COMMON + SPLASH URLs
  plus only a proven critical PRIMARY subset
  (resolution + locale resolved BEFORE this fires; SECONDARY excluded)
        |
[ Player taps switch/launch ]
        |
Neutral transition screen, live RG state
        |
Authorization is rechecked if required by the approved integration contract
        |
Game iframe loads; cache reuse remains an observed outcome, not an assumption
        |
Screen clears only on an authoritative input-accepted signal
```

---

## Build modules — in dependency order

**Module 1 — Measurement harness.** Reusable script: takes a HAR pair (cold/warm), outputs load time, bytes-over-wire, cache-hit %. You'll run this constantly — build it once, properly, first.

**Module 2 — Cache-warming core (build this first, it's the highest-risk assumption).**
1. Preserve the local parent-to-iframe diagnostic; now verify exact reuse from the integrated sandbox lobby in isolated browser processes. Real-site validation remains a later deployment gate.
2. Build the prefetch trigger (hover/dwell, drawer-open).
3. Resolve device tier + locale BEFORE prefetching (the two real failure modes above).
4. After authorization, warm PRELOADER + COMMON + SPLASH and only a proven critical PRIMARY subset. Never proactively warm SECONDARY.
5. `preconnect`/`dns-prefetch` to the session endpoint on drawer-open.
6. Exit criteria: a cold/warm HAR pair where "warm" was achieved by our own prefetch trigger, not a manual replay.

**Module 3 — Prefetch policy (the best differentiator — protect the time for this).**
1. Use intent/recent/favourite policies with labelled synthetic local journeys first. An optional real-popularity prior must use only approved aggregate CSV/event-log results; never represent synthetic demand as real player behavior.
2. Implement **both** policies—favourite-prefetch and unplayed-prefetch—behind an operator/demo toggle that affects speculative cache requests only, never player-visible ordering.
3. Policy benchmarks over synthetic journeys are MEASURED on a SIMULATED workload, not real-player accuracy. Sandbox time/transfer gains require isolated local comparisons; real-player effects remain UNKNOWN pending a later approved deployment experiment.

**Module 4 — Transition pipeline & UI.**
1. Transition screen: session clock, net position, limit headroom (synthetic data for demo).
2. Clears as `interactive` ONLY on an authoritative input-accepted signal, never on iframe load or first paint; otherwise use the precise weaker or `SIMULATED` state.
3. Drawer: user-initiated only, ordered by favourites/recents/search — never an algorithmic "picks for you."
4. Accessibility: contrast, keyboard nav, `prefers-reduced-motion`, extended-duration path so screen readers can announce the transition state before it clears.

**Module 5 — Governor.**
1. `navigator.connection` gates prefetch on metered/slow connections.
2. Performance Observer pauses prefetch on frame-time regression.
3. Per-session data budget + visible user toggle (ePrivacy requirement, not optional).

**Module 6 — Regulatory/compliance layer.**
1. Neutral RG-state transition screen (never a fake reality check — see reasoning in VERIFIED/proposal).
2. Exclusion-register integration point: blocking and explicitly SIMULATED for the evaluated sandbox; real service timing remains UNKNOWN. Never present the fixture as real authorization.
3. Counter-metrics: foreground delay, wasted bytes, failures and accessibility; real stake-velocity/time-on-device effects remain UNKNOWN in the sandbox.

**Module 7 — Instrumentation & demo assembly.**
1. On-screen overlay: live network waterfall, cache-hit indicator, running clock.
2. Baseline arm: same app, prefetching disabled, for honest side-by-side.
3. Demo script: cold run → warm run → policy toggle → deliberate failure (kill network mid-switch, show clean rollback, not a dead UI).
4. Final pass: label every number on screen as measured / simulated / FEG-provided.

---

## Hard rules — do not violate these regardless of what seems convenient mid-build

- **Never cache, race, or optimistically render past the exclusion-register check.** It blocks. If it's slow, the transition screen tells the truth and waits. This is non-negotiable even under demo-day time pressure.
- **Never surface the predictor's output to the player.** It drives the cache only. The drawer shows favourites/recents/search — never an algorithmic recommendation. This is what keeps us out of AI Act / non-inducement problems.
- **Never use real player data.** CSV/event-log data used for the popularity model is aggregated or pseudonymized (SHA-256 hashed player IDs) — do not attempt to de-anonymize, join across datasets to re-identify, or display individual player hashes anywhere, including logs or debug output.
- **Never fabricate a number for the exclusion-register latency or claim cross-provider generalization beyond what's tested.** Label unknowns as unknown.
- **Never manufacture a fake checkpoint** (e.g., a fake reality check or fake age prompt) to fill loading time. Warming may use idle time only after exclusion authorization has succeeded; it must never overlap or race the authorization check.

---

## Open questions — still need FEG's answer, don't block building on these

1. Exclusion-register check: per-session or per-launch, and what's its real latency?
2. Do other providers share the cache-control/CORS conventions found on the one bundle tested?
3. Is the 6–8s brief baseline measured to first paint or first accepted bet?
4. Is the "Casino Android" platform (72% of real launches) in scope for any future extension?

---

## Sandbox-only evaluation — do these in this order

1. Resolve package completeness and a truthful input/asset milestone; keep provider code unchanged and use a labelled reference-scene fallback if required.
2. Connect the existing modules to a real-request sandbox lobby and iframe, retaining exact manifests, maximum concurrency two, bounded cost and fail-closed simulated authorization.
3. Capture isolated serial control/treatment pairs under identical conditions; only prototype preparation differs. Unthrottled local results must be reported even when gains are small or absent.
4. Expand to twenty explicitly synthetic catalogue entries with stable distinct cache identities, realistic policy misses and total-session cost accounting.
5. Ship a reproducible reviewer package, impact model and honest evidence labels. The historical HAR pair remains context, not this prototype's causal effect. Keep real-environment configuration outside the core and never use production traffic as a shortcut.

## Before any future real-site deployment (not a sandbox judging prerequisite)

1. Obtain approved access and record exact browser, title/build, locale, tier, top-level context, URLs, and request semantics.
2. Capture isolated control/treatment runs through the real authorization path without logging exclusion payloads or credentials.
3. Measure exclusion-register timing only through an approved, non-sensitive event; authorization remains blocking and fail-closed.
4. Validate exact parent-to-iframe cache reuse, CORS/cache policy, and the authoritative input-accepted milestone before any player-facing enablement.
5. Ask FEG the open questions above before assuming answers.

---

*Every number in this file is either independently measured (as described), FEG-provided, or explicitly marked unverified. Do not let a coding session round an unverified number into a confident-sounding claim — flag it as unverified in code comments and demo copy alike.*
