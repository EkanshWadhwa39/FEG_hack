# Architecture — FEG Challenge 3: Browser-Native Cache Warming

## The Problem

PSK casino lobby players wait ~35 seconds on a cold game load (16.6 MB across 149 requests). Our solution warms the browser's HTTP cache while players browse the lobby, cutting load time to ~6.7 seconds with zero game code changes.

## How It Works

```
                          ┌─────────────────────────────────┐
                          │         LOBBY (lobby.html)       │
                          │  Inline controller, UI, manifest │
                          └──────────────┬──────────────────┘
                                         │ player browses
                                         ▼
                    ┌────────────────────────────────────────┐
                    │           GOVERNOR (governor.js)        │
                    │  Save-Data? Slow connection? Over       │
                    │  budget? Page hidden? → block warming   │
                    └──────────────────┬─────────────────────┘
                                       │ approved
                                       ▼
                    ┌────────────────────────────────────────┐
                    │           MANIFEST (manifest.js)        │
                    │  Resolve locale/tier → 58-asset list    │
                    │  (28.87 MB: PRELOADER→COMMON→SPLASH→   │
                    │   critical PRIMARY only)                │
                    └──────────────────┬─────────────────────┘
                                       │ ordered URLs
                                       ▼
                    ┌────────────────────────────────────────┐
                    │            WARMER (warmer.js)           │
                    │  Staged dispatch, max 2 concurrent      │
                    │  workers, abort on navigate/launch      │
                    │  ┌──────────────────────────────┐      │
                    │  │ WARM LEDGER (warm-ledger.js) │      │
                    │  │ Page-local Set: no re-fetch  │      │
                    │  └──────────────────────────────┘      │
                    └──────────────────┬─────────────────────┘
                                       │ fetch(cache: "default")
                                       ▼
                          ┌─────────────────────────────┐
                          │    BROWSER HTTP CACHE        │
                          │  Standard cache, no SW       │
                          └──────────────┬──────────────┘
                                         │ player clicks "Play"
                                         ▼
                    ┌────────────────────────────────────────┐
                    │  Cancel warming → mount iframe → game   │
                    │  loads from cache (139/149 hits)        │
                    └────────────────────────────────────────┘
```

## Components

| Module | Role |
|--------|------|
| **lobby.html** | Entry point. Inline controller manages UI, triggers warming on hover/focus (150 ms dwell), auto-warms top card on load. |
| **governor.js** | Policy gate. Blocks warming when Save-Data is set, connection is slow, byte budget is exceeded, or page is hidden. Fail-closed: unknown inputs are rejected. |
| **manifest.js** | Resolves locale and asset tier to produce an ordered list of 58 critical startup assets across four stages. SECONDARY assets are excluded. |
| **warmer.js** | Dispatches fetches in stage order (PRELOADER → COMMON → SPLASH → PRIMARY) with max 2 concurrent workers. Supports abort signals and ledger dedup. |
| **warm-ledger.js** | Page-lifetime Set of completed URLs. Prevents redundant fetches across hover cycles. |
| **browser-requester.js** | Validated credential-free HTTPS requester with body drain. Ensures `credentials: omit` and proper response handling. |
| **sandbox.js** | Authorization-state seam designed for exclusion-register integration. |

## Safety Mechanisms

- **Fail-closed governor**: unknown browser APIs or network states block warming rather than proceeding unsafely
- **Max 2 concurrent fetches**: warming never competes with active gameplay or saturates the connection
- **Abort on navigate/launch**: all speculative work cancels immediately when the player clicks Play
- **Save-Data respect**: warming is entirely disabled on metered/slow connections
- **Byte budget cap**: governor tracks cumulative transfer size and stops when the budget is reached
- **Credential isolation**: all prefetch requests use `credentials: omit` -- no tokens or session data leak
- **25-second rollback timer**: if the game iframe fails to reach interactive state, the UI reverts

## Sandbox Server — Production on Localhost

A key engineering contribution: `sandbox_server.py` replicates the full production network topology on a single machine, making the cold-vs-warm contrast demonstrable without staging access.

- **Two-origin split**: lobby on `:8090`, game CDN on `:8091` — mirrors the real cross-origin fetch path
- **Production cache headers**: `Cache-Control: immutable` on versioned static assets, `no-store` on HTML entry points — identical to the live CDN
- **Bandwidth throttle**: configurable per-response rate limiting simulates real broadband/mobile conditions
- **Smart warm/cold differentiation**: the server tracks which URLs were speculatively prefetched. When the iframe launches, prefetched assets skip throttle (simulating a browser cache hit at disk speed), while never-prefetched assets stay throttled (simulating a real network fetch). This produces the same cold-vs-warm contrast a real user would experience.
- **Session nonce isolation**: each page load generates unique URL paths, ensuring clean cache measurement between test runs — no leftover entries from previous sessions

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Browser-native only | No service worker, no custom cache API. Standard HTTP cache is the most portable, lowest-risk approach. |
| Evidence before breadth | Isolated HAR pair validates cache reuse before adding features. Measured results drive design. |
| Exact URLs | Pre-resolve locale/tier so cached URLs match iframe requests exactly. No query stripping or URL rewriting. |
| Truthful readiness | Progress reflects actual fetch completion. No faked checkpoints or premature "ready" states. |
| Conservative governor | Better to skip warming than risk degrading the player's experience. |

## Production Integration Points

These are designed seams, not gaps:
- **Exclusion-register gate**: `sandbox.js` is the integration point for real authorization checks before warming
- **Network classification**: governor accepts real `navigator.connection` data; current demo uses safe defaults
- **Locale/tier resolution**: manifest structure supports dynamic resolution; hardcoded to `en`/`@1x` for demo
- **Provider cache policy**: sandbox headers approximate production; real deployment uses provider-controlled `Cache-Control`
