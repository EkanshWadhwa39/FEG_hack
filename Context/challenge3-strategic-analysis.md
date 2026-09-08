# Empire of Gold vs. Challenge 3 Requirements — Strategic Analysis

> **SUPERSEDED BACKGROUND — DO NOT IMPLEMENT:** this document's native interception, custom disk-cache, SDK, production-demo, and projected-performance proposals conflict with the authoritative web-only plan in `CODE.md` and `Context/FINAL-PLAN.md`. Retain it only as historical analysis; do not treat its claims as current evidence.

**FEG Innovation Hackathon 2026 — Challenge 3: Game Load Time (6-8 Seconds → Near-Instant)**

---

## 1. CONSTRAINT MAPPING: What "Certified / Cannot Alter" Means for Our Approach

The hackathon brief is explicit:

> *"Games are certified third-party bundles, contractually fixed. The solution space is everything around the game."*
> *"Out of scope: modifying provider code or certified logic, and any change to game mechanics or payouts."*
> *"Certified packages must not be altered."*

Our bundle analysis validates that a **native request interception + disk cache** approach lives **entirely outside** the certified bundle — it operates at the HTTP/network layer, not inside the game code. This is the strongest possible compliance posture.

| Constraint | Our Approach | Status |
|---|---|---|
| Don't modify game JS | Intercept HTTP requests — game code is untouched | ✅ Compliant |
| Don't alter game mechanics | Cache serves identical bytes — no logic change | ✅ Compliant |
| Don't change payouts | Server-side RNG via SpinIQ API untouched | ✅ Compliant |
| Responsible gambling interstitials | These are served by the platform shell (outside the bundle), not the game itself. Our cache is transparent to them. | ✅ Compliant |
| GDPR / ePrivacy | No PII in cached static assets (all game state is heap-memory-only). Cache can be cleared per-session. | ✅ Compliant |

---

## 2. METRICS: Can We Hit the Targets?

The brief sets aggressive targets:

| Metric | Target | Feasibility with Bundle Analysis |
|---|---|---|
| **Cold Load p50** | < 500 ms | ⚠️ **Extremely challenging.** Cold load requires fetching vendor-pixi.js (1.23 MB) + core-engine (371 KB) + game JS (44 KB) + index (7 KB) + CSS (~45 KB) + preloader assets (~221 KB) + splash assets (~1.5 MB) = **~3.4 MB minimum before splash screen renders**. At 10 Mbps: ~2.7s download alone, plus JS parse/compile (~1-3s). **~4-6s best case on cold.** <500ms requires: prefetch prediction with 100% accuracy + disk cache warming + streaming compilation. |
| **Cold Load p95** | < 500 ms | 🚩 **Impossible on true cold.** But the brief may accept "perceived cold" — if the lobby pre-warms the top-3 likely games in a hidden iframe during browse idle time, then p95 "cold" (from user's perspective) CAN be <500ms. |
| **Warm cache repeat load** | — | ✅ **~0 network bytes.** All 300+ static assets served from disk cache. JS parse + GPU texture upload still takes time, but network is eliminated. |
| **Cache hit / prefetch accuracy** | Target TBD | Predictable: the bundle has exactly 4 JS files + ~300 static assets, all with stable URLs. A manifest-based pre-warm can achieve 100% cache hit rate. |
| **Launch-to-play conversion** | TBD | Directly improved by eliminating network latency — user sees splash screen while GPU textures load. |
| **Games sampled per session** | TBD | Lower friction = more exploration. | 

### The Real Cold-Load Breakdown

```
Cold load pipeline for Empire of Gold:

Phase 1: HTML + CSS (blocking)
  index.html (1.6 KB) + 5 CSS files (~45 KB) → ~50 KB
  @10 Mbps: ~40 ms  ✅

Phase 2: JS bundles (parallel, deferred)
  vendor-pixi.js    1,230 KB
  core-engine.js      371 KB
  game-empireofgold    44 KB
  index-canvas          7 KB
  ─────────────────────────
  Total JS:         1,652 KB
  @10 Mbps: ~1,320 ms download
  + parse/compile: ~1,200-2,500 ms (V8 on mobile)
  ⚠️ 2.5-3.8 seconds

Phase 3: Preloader assets (JSON + font + logo)
  gameContent.json      4 KB
  commonContent.json    14 KB
  brandLogo.png         10 KB
  Mulish.ttf           205 KB
  ─────────────────────────
  Total:              ~233 KB
  @10 Mbps: ~186 ms ✅

Phase 4: Splash assets (shown during primary load)
  splashBG.jpg         659 KB (@1x)
  splashAssets.webp    849 KB (@1x)
  ─────────────────────────
  Total:            ~1,508 KB
  @10 Mbps: ~1,206 ms  ⚠️

Phase 5: Primary assets (parallel, progressive)
  Spine PNGs (~17 files):    ~16,856 KB
  Spine JSONs (~17 files):    ~7,700 KB
  Spritesheet webp/JSON:      ~2,000 KB
  Sounds (initial set):       ~1,500 KB
  Fonts:                        ~750 KB
  ─────────────────────────
  Total:                   ~28,806 KB
  @10 Mbps: ~23 seconds  🚩 (but loaded progressively during gameplay)

CRITICAL PATH TO "PLAYABLE":
  Phase 1 + 2 + 3 + 4 = ~3.4 MB → ~2.7s download + ~1.5s parse = ~4.2s
  This is the "splash screen visible" moment, not "fully playable."
  
  For "fully playable" (spin button active):
  Need at minimum: primary spine symbols + reels_frame + BG_king + king_character
  → additional ~8-12 MB → +6-10s → total ~10-14s cold.
  
  REALITY CHECK: The 6-8s baseline the brief mentions is optimistic
  for a 97 MB bundle on mobile. Our analysis suggests 8-14s is more
  realistic for full playability on cold 4G.
```

---

## 3. SOLUTION ARCHITECTURE: What We Build

Based on the bundle analysis, here's what a winning caching/prefetch layer looks like:

### 3.1 Native Request Interception Layer

```
┌─────────────────────────────────────────────┐
│               FEG Platform Shell             │
│  ┌───────────────────────────────────────┐  │
│  │         Game WebView / iframe         │  │
│  │    ┌─────────────────────────────┐    │  │
│  │    │  empireofgold bundle        │    │  │
│  │    │  fetch() / <script> / <img> │    │  │
│  │    └──────────┬──────────────────┘    │  │
│  │               │ HTTP request          │  │
│  └───────────────┼──────────────────────┘  │
│                  │                          │
│         ┌────────▼──────────┐              │
│         │  Cache Interceptor │              │
│         │  (Service Worker   │              │
│         │   or Native Proxy) │              │
│         └────────┬──────────┘              │
│                  │                          │
│       ┌──────────┼──────────┐              │
│       │          │          │              │
│  ┌────▼────┐ ┌───▼────┐ ┌──▼──────────┐  │
│  │ Disk    │ │Memory  │ │ Origin/Fetch │  │
│  │ Cache   │ │Cache   │ │ (fallback)   │  │
│  │ (SQLite │ │(LRU)   │ │              │  │
│  │  or FS) │ │        │ │              │  │
│  └─────────┘ └────────┘ └──────────────┘  │
└─────────────────────────────────────────────┘
```

### 3.2 Cache Key Normalization Rules (from bundle analysis)

```
RULE 1: Strip query params from cache keys
  Input:  assets/panel/css/common.css?v=1788443825853
  Cache:  assets/panel/css/common.css

RULE 2: Strip sound version param
  Input:  assets/sounds/mp3/FBGM.mp3?version=0.036
  Cache:  assets/sounds/mp3/FBGM.mp3

RULE 3: Handle gameassets/ prefix mapping
  Input:  gameassets/en/mp3/FBGM.mp3
  Cache:  assets/sounds/mp3/FBGM.mp3

RULE 4: Resolution-aware cache (serve both variants)
  Input:  assets/spines/@0.5x/king_character.png
  Cache:  assets/spines/@0.5x/king_character.png
  Input:  assets/spines/@1x/king_character.png
  Cache:  assets/spines/@1x/king_character.png

RULE 5: Locale-aware cache (8 languages)
  Input:  assets/locale/en/gameContent.json
  Cache:  assets/locale/en/gameContent.json
  (All 8 locales pre-cached)
```

### 3.3 Prefetch Strategy

**Phase 0 — Lobby Idle Prediction:**
- Track which games the user has played or hovered over
- Pre-warm the top-3 candidates in hidden iframes/WebViews
- For each: fetch HTML → modulepreload JS bundles → preloader assets

**Phase 1 — Critical Path Prefetch (for selected game):**
```
Priority 1: vendor-pixi-C8WzrnZv.js          (1.23 MB) ← BLOCKS ALL
Priority 2: core-engine-DXW-O-mj.js          (371 KB)  ← BLOCKS ENGINE
Priority 3: game-empireofgold-CK6MbOiD.js    (44 KB)
Priority 4: index-canvas-_ynnR-4e.js         (7 KB)
Priority 5: All 5 CSS files                  (45 KB)
Priority 6: Preloader assets                 (233 KB)
Priority 7: Splash assets (@1x)              (1.5 MB)
```

**Phase 2 — Background Prefetch (during splash display):**
```
Priority 8: Primary spine textures           (16.9 MB)
Priority 9: Primary spine JSON               (7.7 MB)
Priority 10: Spritesheet webp/JSON           (2 MB)
Priority 11: Initial sounds                  (1.5 MB)
```

**Phase 3 — Lazy (during gameplay):**
```
Priority 12: Secondary spine assets          (various)
Priority 13: Background music (FBGM/BBGM)    (10 MB)
Priority 14: Remaining sounds                (12 MB)
```

### 3.4 The Missing Module Problem

The bundle dynamically imports `offline-data-DTb4NQY9.js` which is NOT in the extracted ZIP. This module contains:
- `encryptObject()` — required for SpinIQ API communication
- Offline/mock response data — currently bypasses real API calls

**Our cache MUST handle this:**
1. On first cold load, allow this dynamic import through to the origin
2. Cache the response permanently (it's content-addressed by hash in filename)
3. Include it in the pre-warm manifest for future loads

---

## 4. JUDGING CRITERIA ALIGNMENT

### 4.1 Business Impact (30%) — Strongest Case

| Claim | Evidence from Bundle Analysis |
|---|---|
| **100% reduction in network bytes on warm loads** | All 300+ asset URLs are stable and predictable — cache hit ratio can reach 100% |
| **~80% reduction in cold load time with prefetch** | vendor-pixi.js (1.23 MB) is the single bottleneck — pre-warming just this one file eliminates the dominant cold cost |
| **Higher games-sampled-per-session** | If switching games is ~500ms instead of ~8s, users explore 5-10x more games |
| **Cost-value: zero server-side changes** | All interception happens client-side. No CDN reconfiguration, no backend API changes. |

### 4.2 Customer Experience (20%)

- **Perceived load**: Splash screen appears in ~500ms with pre-warmed JS. GPU texture upload continues in background while user watches the animated splash.
- **Transition smoothness**: Lobby → game feels like a screen transition, not a page load.
- **No white flash**: The modulepreload polyfill + disk cache means CSS is available instantly.

### 4.3 Originality (15%)

What the brief DIDN'T suggest that our analysis enables:
- **Spine-aware texture prefetch**: We can pre-decode spine atlas PNGs into GPU textures before the game engine asks for them, using WebGL `texImage2D` in a hidden canvas
- **Resolution-adaptive cache**: Serve @0.5x on mobile, @1x on desktop/Retina — our cache already handles both
- **Audio codec negotiation at cache level**: Serve mp3 to Safari, ogg to Chrome — pre-cache both, serve the right one

### 4.4 Technical Feasibility (15%)

| Concern | Mitigation |
|---|---|
| Service Worker scope limitations | Use native WebView request interception (Android `shouldInterceptRequest`, iOS `WKURLSchemeHandler`) instead of SW |
| 97 MB bundle won't fit in memory cache | Use disk-backed LRU cache (SQLite), only hot files in memory |
| JS parse time still ~1-2s | Use V8 code caching / bytecode caching for vendor-pixi.js |
| Missing `offline-data-DTb4NQY9.js` | Pre-fetch and cache it alongside other JS bundles |

### 4.5 Product Thinking (10%)

- **Integration surface**: A single SDK that wraps the game WebView — platform team drops it in, no game-by-game configuration needed
- **Manifest auto-generation**: Our tooling analyzes any FEG game bundle and auto-generates the cache manifest (file list, priorities, normalization rules)
- **Backward compatible**: Falls back to direct network requests if cache is cold or corrupted

### 4.6 Compliance by Design (10%)

- **Certified code untouched**: Interception happens at HTTP layer, not inside the bundle
- **Responsible gambling interstitials preserved**: These are platform-shell UI, outside the game iframe — our cache is transparent to them
- **Session isolation**: Cache is keyed by game ID + version, not by user/session — no cross-player data leakage
- **GDPR**: Cached data is static game assets (images, sounds, code) — zero PII
- **Right to deletion**: Clear cache per-user on account deletion — trivial with disk-backed cache

---

## 5. THE DEMO PLAN: Side-by-Side, Instrumented

### Baseline (what to show):

```
Device A: Production build, cold load
  Timeline:
    T+0ms     — User taps game tile
    T+200ms   — WebView initializes
    T+400ms   — HTML downloaded (1.6 KB)
    T+450ms   — CSS downloaded (45 KB)
    T+1,800ms — vendor-pixi.js downloaded (1.23 MB)
    T+2,200ms — core-engine.js downloaded (371 KB)
    T+2,200ms — JS parse/compile begins
    T+3,500ms — JS execution, engine init
    T+4,000ms — Preloader assets loaded
    T+5,200ms — Splash assets loaded, splash screen VISIBLE
    T+8,000ms — Primary assets loaded, user CAN SPIN
    ────────────────────────────
    TOTAL: ~8 seconds to playable
```

### Our Solution:

```
Device B: Our caching layer, pre-warmed
  Timeline:
    T-∞       — Lobby idle: pre-warmed vendor-pixi.js + core-engine in disk cache
    T+0ms     — User taps game tile
    T+50ms    — WebView initializes
    T+60ms    — HTML from disk cache (0 network)
    T+70ms    — CSS from disk cache (0 network)
    T+100ms   — All 4 JS bundles from disk cache (0 network)
    T+100ms   — JS bytecode cache hit → parse in ~200ms
    T+300ms   — JS execution, engine init
    T+400ms   — Preloader from disk cache (0 network)
    T+500ms   — Splash assets from disk cache → splash VISIBLE
    T+800ms   — Primary spine PNGs from disk cache → GPU upload
    T+1,500ms — GPU textures uploaded, user CAN SPIN
    ────────────────────────────
    TOTAL: ~1.5 seconds to playable (~5.3x improvement)
    Splash visible: ~500 ms (meets the target!)
```

### Instrumentation Points:

```
window.__PERF_MARKS__ = {
  tap_to_game:          performance.now(),  // User taps tile
  webview_ready:        ...,                 // WebView created
  html_loaded:          ...,                 // index.html parsed
  js_bundles_loaded:    ...,                 // All 4 JS files available
  js_compiled:          ...,                 // JS execution started
  engine_init:          ...,                 // PixiJS app created
  splash_visible:       ...,                 // First paint with content
  primary_loaded:       ...,                 // Main game assets ready
  spin_enabled:         ...,                 // User can interact
}
```

---

## 6. OPEN QUESTIONS & RISKS

| Question | Impact | Mitigation |
|---|---|---|
| Where does `offline-data-DTb4NQY9.js` live? | Critical — without it, the game can't initialize API layer | Request from FEG mentors; it may be served from the platform's origin alongside the bundle |
| Does the platform use WebViews or system browsers? | Determines interception mechanism (native proxy vs Service Worker) | Support both; native proxy is preferred (broader scope) |
| Are game bundles versioned per-deploy? | Content-hash filenames solve this for JS, but non-JS assets have no hashes | Use ETag/Last-Modified from origin as secondary cache key |
| What's the real production network baseline? | Our estimates assume 10 Mbps — real-world Indian mobile networks may be 2-5 Mbps | Test with network throttling at 3G/4G speeds |
| How many games does a typical user play? | Determines pre-warm budget (how many games to pre-cache) | Track per-user game-switching patterns from event logs |

---

## 7. ONE-PAGER: Compliance Note (D4 Outline)

**Our caching layer and EU baseline compliance:**

1. **GDPR (Art. 5, 17, 25):** Cached data is exclusively static game assets (code, images, sounds, animations) — no personal data. Cache is keyed by `(gameId, version, resolution)`, never by user identifier. Right to erasure: delete cache directory for the user's device.

2. **ePrivacy Directive:** No cookies, no localStorage, no device fingerprinting used by the cache layer. The game itself uses none of these either (confirmed by bundle analysis).

3. **EU AI Act:** Our predictive prefetch is rule-based (recency + frequency), not ML/AI — no high-risk classification applies.

4. **EAA / WCAG 2.1 AA:** The cache layer is transparent to the rendered content. Accessibility features of the original game are preserved unchanged.

5. **Responsible Gambling:** Reality checks, session limits, and age gates are platform-shell features that render outside the game WebView. Our cache never intercepts or alters these. RG interstitials are served fresh from origin (not cached).

6. **AMLD / KYC:** Not applicable — our layer handles game assets, not financial transactions.

7. **eIDAS 2.0:** Not applicable — no electronic signatures or trust services involved in caching.

---

*Analysis based on read-only inspection of certified third-party code. No files modified.*
*Challenge 3 brief: FEG Innovation Hackathon 2026, T-Hub Hyderabad, September 8-9.*