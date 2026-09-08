# CLAUDE.md — FEG Hackathon Challenge 3: Game Load Time

This is the starting context for this project. Read this fully before writing any code. It contains everything already measured and decided — do not re-derive or re-guess anything listed as VERIFIED below; treat it as ground truth for this session.

---

## Mission, one line

Cut PSK's game-switch time by warming the browser's own HTTP cache before the player clicks, instead of after — proven today to already produce a 5.3x improvement with zero code, using nothing but standard browser caching.

**Environment update:** the staging URL is unavailable because of a technical issue and will not be accessible during the hackathon. Build the generic integration for later sandbox testing on staging; do not substitute production traffic or claim staging validation during the outage.

---

## Platform — do not deviate from this

**Web only. All devices, including mobile. No native app.** We have no access to build or test against any native Android/iOS surface. This was explicitly confirmed via a walkthrough video and is a hard constraint on scope, not a preference.

There is real telemetry showing a native-labeled "Casino Android" platform accounts for ~72% of actual game launches in production — we know this, we are not ignoring it, but it is out of scope for this build. State this honestly in any user-facing material: our mechanism (HTTP cache warming against stable content-hashed URLs) is standard browser behavior and *should* transfer to a WebView-based client, but we have not verified that and must not claim we have.

---

## VERIFIED — real measurements, do not re-model these

### The core mechanism already works (proof, not projection)
Same game (SavannaSunriseDeluxe), same session, cold vs warm HAR capture, cache enabled:
- Cold: 35.5s load, 16.6 MB over the wire, 15/150 requests cached
- Warm: **6.7s load, 12 KB over the wire, 139/149 requests cached**
- This is the entire thesis of the project, proven before we wrote a line of code.

### Real baseline is worse than the brief states
- Brief says 6–8s. FEG's own web-platform telemetry shows **25–31s consistently across 12 months** (session-to-first-game-launched).
- Our own HAR capture independently shows 29–35s for a real launch.
- Static bundle analysis independently corroborates the same order of magnitude.
- Three independent sources agree. State both numbers; ask FEG which one we're judged against.

### The session/handshake call is a connection problem, not a server problem
`session/create` measured at 1,850ms total: DNS 494ms + SSL 321ms + TCP connect 1,046ms + actual server wait only 303ms. **86% of the cost is connection setup.** This directly justifies `preconnect`/`dns-prefetch` on drawer-open — it's not a theoretical optimization, we measured the exact bottleneck.

### A real, measured, trivial waste
A 404 probe (`GameView/Egaming`) costs 712ms before falling back to a generic container view. Fix it; it's free.

### Bundle structure (static analysis, one provider: Spiniq / Empire of Gold SDK)
- **Zero anti-tamper, zero automation/headless detection, zero SRI hashes, standard minification only.** Native-style interception or JS-level cache warming is clean against this bundle — nothing fights us.
- Asset URLs are **stable**: JS is content-hashed at build time, no session tokens or `Date.now()` in fetch paths. Safe to cache aggressively.
- Staged load order: **PRELOADER → COMMON → SPLASH → PRIMARY (~15–20MB, the real wall) → SECONDARY (lazy, safe to background-prefetch even after first spin)**.
- **Two real failure modes to design around, found in the actual code:**
  1. **Resolution branching** — game picks `@1x` or `@0.5x` texture sets *after* JS executes, based on device info. Resolve device tier BEFORE issuing prefetch, or you waste ~30MB warming both tiers, or cold-miss on the wrong one.
  2. **Locale branching** — asset path is `assets/locale/${language}/...`, where `language` is injected at runtime by the operator frame, not present in the URL ahead of time. Read the launch config for target locale before warming.
- No `KHR_parallel_shader_compile` or async shader-compile hint — shader compilation is a real, unfixable-by-us cold-start cost. This is a "known ceiling" item, not a bug to chase.
- Cache-control on this CDN: `max-age` in the tens of years, full CORS (`Access-Control-Allow-Origin: *`). Not opaque — no Cache API storage-padding penalty applies here.

### Cache-partitioning assumption — VERIFY THIS FIRST, BEFORE ANYTHING ELSE
The entire architecture rests on: browser HTTP cache partitions by top-level **site** (e.g. `psk.hr`), not exact origin, so a `fetch()` issued from the parent lobby page (`casino.psk.hr`) can pre-warm a cache entry that a same-site game iframe (`gamelauncher-*.psk.hr` or similar) later hits. **This must be the first thing tested in this session** — two `fetch()` calls and a DevTools check. If it fails, the whole mechanism needs rethinking before anything else is built.

### Real popularity distribution — use this, not a synthetic one
Two independent real sources agree on a hard power law:
- 12mo aggregated stake data (4.2M rows, Croatia, no player-level info): top 10 games = 17.8% of stake, top 100 (3% of catalogue) = 58%, 29% of catalogue = near-dead long tail.
- Real event log (`casino_game_launch` events, 887 distinct titles, 13,682 launches, pseudonymized player IDs): top 10 by real launch count = 34.7% of all launches.
- Provider concentration: **top 5 providers = 69.8% of stake, top 10 = 90.9%.** Five-provider integration is realistic, not a guess.

### Real business-impact baseline (for the pitch, not the code)
- Session-to-game conversion on web: **42–54%** — nearly half of sessions never launch a game.
- Games-per-session, PSK vs other FEG markets: PSK is **lowest of 5 markets (2.43)** while having the **highest session frequency (16.2/player, highest of 5)**. High loyalty, low discovery — the exact pattern the brief names.

### Still unmeasured — do not fabricate a number for these
- **Exclusion-register check latency.** Every HAR so far is anonymous demo mode. This requires a real login on staging. Until measured, treat it as an unknown-latency BLOCKING call — never cache it, never race it, never optimize around it, regardless of what its real cost turns out to be.
- **Cross-provider generalization.** Bundle analysis is confirmed for one provider only (Spiniq). Verify against 2–3 more titles from top-stake providers (Amusnet, Pragmatic, Playtech) via the public demo button before claiming this generalizes.

---

## Architecture — what to build

No native interception layer. No `WebViewClient`, no Kotlin, no iOS parity questions. The mechanism is entirely JS/browser-native:

```
[ Player browsing lobby ]
        |
Resource Governor (JS): navigator.connection, Performance Observer / Long Animation Frames, data budget
        |
Prefetch trigger: hover/dwell 150ms+, or drawer-open
        |
fetch(url, {mode:'no-cors'}) or <link rel="prefetch">
  against target game's PRELOADER + COMMON + PRIMARY tier assets
  (resolution + locale resolved BEFORE this fires)
        |
[ Player taps switch/launch ]
        |
preconnect/dns-prefetch already warmed the session endpoint
        |
Neutral transition screen, live RG state, clears ONLY on input-accepted
        |
Exclusion-register check fires here — BLOCKING, never cached, never raced
        |
Game iframe loads — requests hit warm cache
```

---

## Build modules — in dependency order

**Module 1 — Measurement harness.** Reusable script: takes a HAR pair (cold/warm), outputs load time, bytes-over-wire, cache-hit %. You'll run this constantly — build it once, properly, first.

**Module 2 — Cache-warming core (build this first, it's the highest-risk assumption).**
1. Verify same-site cache partitioning directly (see VERIFIED section above) — do this before anything else.
2. Build the prefetch trigger (hover/dwell, drawer-open).
3. Resolve device tier + locale BEFORE prefetching (the two real failure modes above).
4. Warm PRELOADER + COMMON + PRIMARY only. Never proactively warm SECONDARY — background it opportunistically after first spin instead.
5. `preconnect`/`dns-prefetch` to the session endpoint on drawer-open.
6. Exit criteria: a cold/warm HAR pair where "warm" was achieved by our own prefetch trigger, not a manual replay.

**Module 3 — Prefetch policy (the best differentiator — protect the time for this).**
1. Build the real popularity model from the CSV/event-log data (see VERIFIED), not synthetic.
2. Implement **both** policies — favourite-prefetch and unplayed-prefetch — with a **live toggle**, not a precomputed chart. A judge needs to flip it and watch both run against the real cache.
3. Exit criteria: live toggle, real hit-rate and seconds-saved numbers computed from the actual running system for both policies.

**Module 4 — Transition pipeline & UI.**
1. Transition screen: session clock, net position, limit headroom (synthetic data for demo).
2. Clears ONLY on interactive (spin control accepts input), never on first paint.
3. Drawer: user-initiated only, ordered by favourites/recents/search — never an algorithmic "picks for you."
4. Accessibility: contrast, keyboard nav, `prefers-reduced-motion`, extended-duration path so screen readers can announce the transition state before it clears.

**Module 5 — Governor.**
1. `navigator.connection` gates prefetch on metered/slow connections.
2. Performance Observer pauses prefetch on frame-time regression.
3. Per-session data budget + visible user toggle (ePrivacy requirement, not optional).

**Module 6 — Regulatory/compliance layer.**
1. Neutral RG-state transition screen (never a fake reality check — see reasoning in VERIFIED/proposal).
2. Exclusion-register check integration point: blocking, mocked until staging gives a real number, swap-in-ready.
3. Counter-metric stubs: stake-velocity, time-on-device — even synthetic pre-staging.

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
- **Never manufacture a fake checkpoint** (e.g., a fake reality check or fake age prompt) to fill loading time. Only overlay onto checkpoints that already exist (login/verification window).

---

## Open questions — still need FEG's answer, don't block building on these

1. Exclusion-register check: per-session or per-launch, and what's its real latency?
2. Do other providers share the cache-control/CORS conventions found on the one bundle tested?
3. Is the 6–8s brief baseline measured to first paint or first accepted bet?
4. Is the "Casino Android" platform (72% of real launches) in scope for any future extension?

---

## During the staging outage — do these in this order

1. Maintain the reproducible local cache-partitioning diagnostic, scoped as browser-mechanism evidence only.
2. Build and test the generic sandbox integration using synthetic, credential-free fixtures: exact manifest resolution, conservative governor, maximum concurrency two, cancellation, and fail-closed authorization boundary.
3. Keep staging URLs and environment-specific configuration outside the generic core. Never guess URLs from the private archive or substitute production traffic for staging.
4. Build the measurement and redaction path needed for identical disabled-control and enabled-treatment captures.
5. Present the current UI as `SIMULATED`; the historical HAR pair demonstrates warm-state opportunity, not the prototype's causal effect.

## When staging is introduced later

1. Obtain approved access and record exact browser, title/build, locale, tier, top-level context, URLs, and request semantics.
2. Capture isolated control/treatment runs through the real authorization path without logging exclusion payloads or credentials.
3. Measure exclusion-register timing only through an approved, non-sensitive event; authorization remains blocking and fail-closed.
4. Validate exact parent-to-iframe cache reuse, CORS/cache policy, and the authoritative input-accepted milestone before any player-facing enablement.
5. Ask FEG the open questions above before assuming answers.

---

*Every number in this file is either independently measured (as described), FEG-provided, or explicitly marked unverified. Do not let a coding session round an unverified number into a confident-sounding claim — flag it as unverified in code comments and demo copy alike.*
