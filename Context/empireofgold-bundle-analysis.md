# Empire of Gold — Bundle Analysis for Caching/Prefetch Layer
**FEG Innovation Hackathon 2026, Challenge 3: Game Load Time**

---

## 1. Bundle Inventory

### 1.1 Size by Type

| Category | Size (bytes) | Size (MB) | % of Total |
|---|---|---|---|
| **Images** (png, jpg, webp, gif) | 57,906,368 | 55.2 | 57.0% |
| **Audio** (mp3, ogg) | 28,538,436 | 27.2 | 28.1% |
| **JSON** | 11,261,025 | 10.7 | 11.1% |
| **JavaScript** | 1,813,165 | 1.7 | 1.8% |
| **Fonts** (ttf, fnt) | 958,103 | 0.9 | 0.9% |
| **Compressed dupes** (.br, .gz) | 867,653 | 0.8 | 0.9% |
| **Atlas** (.atlas) | 208,440 | 0.2 | 0.2% |
| **HTML/CSS** | 77,864 | 0.1 | 0.1% |
| **TOTAL** | **101,631,054** | **96.9** | **100%** |

*Total without .br/.gz duplicates: 100,763,401 bytes (96.1 MB)*

### 1.2 File Counts by Extension

| Extension | Count |
|---|---|
| .png | 92 |
| .json | 80 |
| .ogg | 51 |
| .mp3 | 51 |
| .atlas | 42 |
| .webp | 15 |
| .jpg | 9 |
| .ts | 6 |
| .css | 6 |
| .gz | 5 |
| .br | 5 |
| .ttf | 4 |
| .js | 4 |
| .html | 3 |
| .gif | 3 |
| .fnt | 2 |

### 1.3 Top 15 Largest Files

| Size | Type | Path |
|---|---|---|
| 5,946,281 | audio | `assets/sounds/ogg/FBGM.ogg` |
| 4,751,493 | image | `assets/spines/@1x/king_character.png` |
| 4,750,087 | image | `assets/spines/@0.5x/king_character.png` |
| 4,715,299 | audio | `assets/sounds/ogg/BBGM.ogg` |
| 4,184,698 | audio | `assets/sounds/mp3/FBGM.mp3` |
| 3,508,090 | image | `assets/spines/@0.5x/BG_king_2.png` |
| 3,508,090 | image | `assets/spines/@1x/BG_king_2.png` |
| 3,317,818 | audio | `assets/sounds/mp3/BBGM.mp3` |
| 3,128,206 | image | `assets/spines/@0.5x/bigwins.png` |
| 3,128,206 | image | `assets/spines/@1x/bigwins.png` |
| 2,484,770 | image | `assets/spines/@0.5x/king_character_2.png` |
| 2,484,770 | image | `assets/spines/@1x/king_character_2.png` |
| 2,183,073 | json | `assets/spines/@0.5x/BG_king.json` |
| 2,183,073 | json | `assets/spines/@1x/BG_king.json` |
| 1,853,021 | image | `assets/spines/@0.5x/EOG_Logo_Anim.png` |

### 1.4 All Files ≥ 1 MB

24 files exceed 1 MB. They are: 4 audio files (FBGM.ogg, BBGM.ogg, FBGM.mp3, BBGM.mp3), 18 PNG atlas textures (@0.5x and @1x variants of king_character, BG_king, bigwins, EOG_Logo_Anim, cup, king_character_2, bigwins_2), 2 large JSON files (BG_king.json in both resolutions), and vendor-pixi.js (1.29 MB).

---

## 2. Entry Point and Load Sequence

### 2.1 Load Chain

```
index.html
  ├── CSS: 5 stylesheets with ?v=1788443825853 (blocking, in <head>)
  ├── <link rel="modulepreload"> for 3 JS bundles (speculative preload)
  ├── <script type="module" src="./assets/index-canvas-_ynnR-4e.js">
  │     ├── import { G, g } from "./game-empireofgold-CK6MbOiD.js"
  │     ├── import "./core-engine-DXW-O-mj.js"
  │     └── import "./vendor-pixi-C8WzrnZv.js"
  │
  └── game-empireofgold instantiates main class (extends from core-engine)
        └── Core engine bootstraps PixiJS application
              └── Loads asset bundles in order:
                    PRELOADER → COMMON → SPLASH → PRIMARY → SECONDARY
```

### 2.2 JS Bundle Structure

| File | Size | Role |
|---|---|---|
| `vendor-pixi-C8WzrnZv.js` | 1,292,928 B (1.23 MB) | PixiJS v8.18.1 + Spine 3.14.2 + GSAP 3.14.2 |
| `core-engine-DXW-O-mj.js` | 380,058 B (371 KB) | FEG/SpinIQ custom game engine (state machine, asset manager, API layer) |
| `game-empireofgold-CK6MbOiD.js` | 44,570 B (43 KB) | Empire of Gold game logic (views, config, sounds) |
| `index-canvas-_ynnR-4e.js` | 7,138 B (7 KB) | Entry point + cheat tool UI |

**Total JS (in-bundle): 1,724,694 bytes (1.64 MB)**

**⚠️ Missing external module:** The engine imports `./offline-data-DTb4NQY9.js` dynamically — this file is **NOT present in the extracted bundle**. It contains the `encryptObject()` function for SpinIQ API communication and offline/mock response data. At runtime, this module would be fetched from the server — an additional network dependency.

### 2.3 Loading Strategy

- **Scripts**: ES modules with `type="module"` — deferred by spec (not render-blocking). Three `modulepreload` links hint the browser to fetch vendor-pixi, core-engine, and game-empireofgold speculatively.
- **CSS**: 5 blocking `<link rel="stylesheet">` in `<head>` with `?v=1788443825853` cache busters.
- **No dynamic `import()`** found — all JS dependencies are static imports resolved at parse time.
- **Asset loading**: The core engine has a progressive bundle system (PRELOADER → COMMON → SPLASH → PRIMARY → SECONDARY). Assets within each bundle are loaded eagerly when that phase activates. The Splash screen displays while PRIMARY loads.

### 2.4 Asset URL Construction

Asset paths are built deterministically in the core engine using config values:

```javascript
configPath: "/"
gamePath: "/"
// Asset resolution example from core-engine:
this.spinePath = "assets/spines/" + S.config.resolutionPath + "/"
this.langSpinePath = "assets/spines/" + S.config.resolutionPath + "/" + l.language + "/"
```

**Audio loading** (from core-engine):
```javascript
loadSounds(t, e) {
    this.loadingIndex = 0;
    const i = e + "mp3/", s = e + "ogg/";
    // ...
}
```
Where `e` = `basePath` (`"gameassets/"`) + language path. So audio URLs resolve to:
`gameassets/{lang}/mp3/{soundName}.mp3` or `gameassets/{lang}/ogg/{soundName}.ogg`

At the HTTP level, the platform maps `gameassets/` → the bundle's `assets/` directory (or a shared CDN). The bundle itself stores audio at `assets/sounds/mp3/` and `assets/sounds/ogg/` — the platform translation layer is responsible for the `gameassets/` prefix.

**Key finding**: Asset URLs are composed from hardcoded prefix paths (`"assets/spines/"`, `"assets/locale/"`, `"assets/images/"`) + resolution (`@0.5x` or `@1x`) + locale (`/en/`) + asset name + extension. There are NO dynamic query parameters, session tokens, or random components in asset URL construction.

The `configPath` and `gamePath` are both set to `"/"` in the game config. The `basePath` for sounds is `"gameassets/"`.

### 2.5 Cache Stability Verdict

- **JS filenames**: Content hashes (e.g., `-DXW-O-mj`, `-CK6MbOiD`, `-C8WzrnZv`) — **stable per build, excellent for caching**.
- **CSS links**: `?v=1788443825853` — this is a build timestamp, stable per deploy but defeats browser cache across deployments.
- **Sound URLs**: Engine appends `?version=0.036` (from `gameVersion` config) — **stable per build, needs query param normalization** in cache key.
- **All other assets** (PNG, JSON, atlas, webp, fonts, etc.): Static filenames with no versioning — **stable per build, but a new build would silently replace files with same names**.
- **No session tokens, no per-request dynamic query params** in static asset URLs.
- **⚠️ External module `offline-data-DTb4NQY9.js`** is NOT in the bundle — it's fetched at runtime and contains the encryption function. This dynamic import must be intercepted and cached or the game won't boot in offline mode.

---

## 3. Anti-Tamper / Integrity / Obfuscation

### 3.1 Minification

- **All 4 JS files are minified**: Single-line, short variable names, dead-code elimination applied.
- **No sourcemap references** found.
- **No eval() or new Function()** detected.

### 3.2 Integrity Checks

- **No Subresource Integrity (SRI)** hashes (`integrity="sha..."`) on any `<script>` or `<link>` tags.
- **No checksum/verify/hash validation** of loaded code in JS.
- **No self-referential code integrity checks** detected.

### 3.3 Anti-Debugging

- **No `debugger` statements** found in any JS file.
- `console.log`, `console.warn`, `console.error`, `console.clear` are used extensively for ordinary logging — these are **diagnostic, not anti-debugging**.
- **No DevTools detection** (no Firebug checks, no `console.log` tampering detection).

### 3.4 Automation / Headless Detection

- **ZERO matches** for: `webdriver`, `navigator.webdriver`, `headless`, `puppeteer`, `selenium`, `phantom`, `nightmare`, `bot`, `crawler`, `automation`.
- Grep hits that appeared were false positives (CSS layout keywords: `"bottom"` matching `"bot"`, etc.).
- **This bundle does not attempt to detect headless browsers or automation.**

### 3.5 Fetch/Network Tampering

- `fetch` is used in:
  - `index-canvas`: for `modulepreload` polyfill (pre-fetches preload links)
  - `core-engine`: for fetching game rules HTML (`fetch(c).then(t=>t.text())`), history data (`window.fetchHistoryData`), locale JSON (`fetch(\`assets/locale/${c}/gameContent.json\`)`), and cheat config (`window.getCheatPath?.()`)
- **No fetch monkey-patching** detected (no override of `window.fetch`, `XMLHttpRequest`).
- **No service worker code** anywhere.

### 3.6 Summary

**This is a clean, well-behaved bundle with no anti-tamper, no integrity checks, no headless detection, and no obfuscation beyond standard minification.** It will not detect or resist request interception, disk caching, or proxying.

---

## 4. Shader / WebGL / Engine Specifics

### 4.1 Rendering Engine

- **PixiJS v8.18.1** (confirmed: `Yh="8.18.1"`), **Spine runtime v3.14.2**, **GSAP 3.14.2** — all bundled into vendor-pixi.js.
- **Three render backends present**: WebGPU (preferred on modern Chrome), WebGL2 (fallback), Canvas2D (last resort). PixiJS 8 auto-selects based on browser capability — no manual override in game code.
- The vendor-pixi bundle is a custom build that includes:
  - `@pixi/*` core (all three renderer systems: WebGPUSystem, WebGLSystem, CanvasSystem)
  - Spine runtime (`spineTextureAtlasLoader`, `spineSkeletonLoader`, `SpinePipe` for both GPU and Canvas pipelines)
  - GSAP (`GreenSockGlobals`, version `3.14.2`)
- **No custom shaders** — all rendering uses PixiJS 8's built-in batch renderer with auto-generated WGSL/GLSL.

### 4.2 WebGL/Shader Details

- The vendor-pixi bundle contains **42+ references to WebGL/shader**, including inline GLSL shader source with `#version 300 es` (WebGL 2.0 / GLES 3.0).
- **GLSL shaders ARE present** — PixiJS includes default shader programs and the bundle includes custom Spine rendering shaders.
- **NO `KHR_parallel_shader_compile`** usage found — PixiJS does not use async shader compilation by default. This is an opportunity for optimization.

### 4.3 Spine Integration

- Spine runtime is **fully embedded** in vendor-pixi.js (spineTextureAtlasLoader, spineSkeletonLoader, SpinePipe for both GPU and Canvas pipelines).
- The core engine builds on top with:
  - `SpinePool` — object pool for spine instances (MIN_SIZE=5)
  - `getSpineAnim()`, `playSpineAnimation()`, `destroySpine()`, `patchSpineDataAtRuntime()`
  - Symbol spine data flows through: `scatter`, `chest`, `book`, `shield`, `cup`, `low_1–5`
- Spine assets have per-resolution duplicates (`@0.5x` and `@1x` — identical file sets, 2× storage cost).

### 4.4 Texture Memory Estimate

**Spine textures only (17 unique PNGs at @0.5x, verified via atlas dimensions):**

| Texture | Dimensions | Raw RGBA (bytes) | Compressed (bytes) |
|---|---|---|---|
| BG_king.png | 2048×1879 | 15,392,768 | 1,747,631 |
| EOG_Logo_Anim.png | 1964×1848 | 14,517,888 | 1,853,021 |
| bigwins.png | 2048×2048 | 16,777,216 | 3,128,206 |
| chest.png | 1889×649 | 4,903,844 | 267,788 |
| cup.png | 2031×1977 | 16,061,148 | 1,400,549 |
| explosion1.png | 1118×234 | 1,046,448 | 136,166 |
| jp_wins.png | 1875×890 | 6,675,000 | 751,247 |
| king_character.png | 2046×2022 | 16,548,048 | 4,750,087 |
| low_1–5.png | various | ~12,496,836 | 1,180,359 |
| multiplayer.png | 1204×514 | 2,475,424 | 219,807 |
| reels_frame.png | 2048×1818 | 14,893,056 | 924,024 |
| scatter.png | 1794×396 | 2,841,696 | 238,429 |
| shield.png | 1605×650 | 4,173,000 | 259,039 |

**Spine subtotals:**
- Compressed on disk: **16.9 MB**
- Estimated raw RGBA at load: **~128.8 MB**

Note: The atlas files reference _2 and _3 texture pages (e.g., BG_king_2.png, king_character_2.png, king_character_3.png) whose dimensions aren't in the primary atlas — they are likely same-size overflow pages, adding roughly **~24.6 MB** additional raw RGBA.

**Non-spine images** (UI, webp spritesheets, fonts, icons, paytable): 6.4 MB compressed, estimated ~38 MB raw at 6:1 average compression.

**Grand texture memory estimate:**
| Metric | Value |
|---|---|
| All images compressed (disk) | ~23.3 MB |
| Estimated total raw RGBA (GPU) | **~160–180 MB** |
| Compression ratio | ~13–14% |
| With @1x duplicates in GPU (if both loaded) | **~280–340 MB** |

### 4.5 Asset Loading Pipeline

The core engine uses its own asset loader (not browser-native resource loading). It:
- Reads bundle manifest arrays (PRELOADER → SECONDARY) defined in game JS
- Resolves TYPE+NAME+ASSETTYPE to concrete file paths using resolution/locale-aware path construction
- Uses the PixiJS `Assets` loader (which internally uses `fetch` and image decoding)
- Loads Spine assets as multi-file groups: `.json` + `.atlas` + `.png` (and _2, _3 variants)

This means a **generic disk cache that intercepts HTTP requests will work** — all assets are fetched via standard HTTP (for local serving) or fetch() calls with predictable, stable URLs.

---

## 5. Network / CORS / Caching Signals

### 5.1 Service Worker

- **No service worker registration** found anywhere in code.
- **No `sw.js` file** exists in the bundle.
- **No `navigator.serviceWorker` references.**

### 5.2 Manifest / Config Files

- `assets/manifest.json`: Defines 3 bundles (default, preloader, primary) but all are structurally empty (`"assets": []`). The actual asset lists are hardcoded in `game-empireofgold-CK6MbOiD.js` as JavaScript arrays (`We`, `He`, `Re`, `Me`, `Fe`).
- Sprite atlas JSONs (`controlPanelAssets.json`, `gameElements.json`, `symbols.json`, etc.): These are spritesheet frame descriptors (PixiJS texture atlas format). They map logical names to coordinates within webp/png sprite sheets.
- Locale JSONs: 8 languages × 2 files (commonContent, gameContent). These are fetched dynamically at runtime based on the selected language.

### 5.3 Hardcoded Endpoints / Domains

**External API backend discovered:** The game communicates with the **SpinIQ** backend:

| Endpoint | Method | Purpose |
|---|---|---|
| `https://api.spiniq.io/gs/pack-alpha/games/init` | POST | Game initialization (playerId, token, deviceType) |
| `https://api.spiniq.io/gs/pack-alpha/games/spin` | POST | Spin results (bet, epoch, combination) |
| `https://api.spiniq.io/gs/pack-alpha/games/feature` | POST | Feature/freespin outcomes |
| `https://api.spiniq.io/gs/ext-api/external/report/betHistory/` | GET | Bet history (with `Authorization: Bearer {token}`) |
| `https://gaming-studio.spiniq.io/history/` | GET | History panel iframe |

All game outcomes come from the server — there is **no client-side RNG**. Requests are encrypted via `encryptObject()` (defined in the missing `offline-data-DTb4NQY9.js` module). In the current build, the API calls are **bypassed in favor of offline mock data** — the game runs entirely on local static responses.

**Static asset paths** are all relative:
- `./assets/` — JS bundles
- `assets/panel/css/` — CSS
- `assets/spines/@0.5x/` or `@1x/` — Spine data
- `assets/locale/{lang}/` — locale JSON
- `assets/sounds/mp3/` or `ogg/` — audio (loaded with `?version=0.036` query param)
- `assets/images/` — images/spritesheets
- `assets/fonts/` — fonts

No CDN references for static assets. The bundle is designed to be served from a single origin for all game content.

### 5.4 Cache-Control / Versioning Assessment

| Signal | Finding | Caching Impact |
|---|---|---|
| JS filename content hashes | `-DXW-O-mj`, `-CK6MbOiD`, `-C8WzrnZv`, `-_ynnR-4e` | ✅ **Excellent** — immutable across builds |
| CSS query params | `?v=1788443825853` (timestamp) | ⚠️ **Stable per deploy but defeats browser cache across versions** — cache layer should strip or normalize `?v=` |
| Image/audio/font filenames | No hashes, no versioning | ⚠️ **New build silently replaces** — but stable within a version |
| Modulepreload hints | Present in HTML for all 4 JS bundles | ✅ Browser will pre-warm these |
| Compressed duplicates | `.br` and `.gz` alongside originals | Irrelevant — server picks one based on `Accept-Encoding` |

### 5.5 CORS

- `crossorigin` attribute is present on `<script type="module" crossorigin>` and `<link rel="modulepreload" crossorigin>` — these use `crossorigin="anonymous"` by presence (for credential-less CORS requests).
- The modulepreload polyfill in `index-canvas` constructs `{credentials: "omit"}` for anonymous and `{credentials: "same-origin"}` for same-origin — standard behavior.
- **No `Access-Control-*` header manipulation in code.**

### 5.6 Content-Security-Policy

- **No CSP meta tags** in HTML.
- **No CSP references** in JS.

---

## 6. Storage / State Footprint

### 6.1 localStorage

One reference found in `index-canvas-_ynnR-4e.js`:

```javascript
localStorage.removeItem("zoom")
sessionStorage.removeItem("zoom")
```

**Keys:** `"zoom"` — used to clear any previously stored zoom state. Write-only (removal at startup). No other localStorage reads/writes.

### 6.2 sessionStorage

Same as above — only `sessionStorage.removeItem("zoom")`. No persistent session data stored client-side.

### 6.3 IndexedDB

**Zero references.** No IndexedDB usage anywhere in the bundle.

### 6.4 Cookies

**Zero references.** No `document.cookie` reads or writes.

### 6.5 Wallet / Balance / Session / Auth Tokens (Updated)

These concepts are present in the engine (core-engine and game-empireofgold):

| Concept | Context | Nature |
|---|---|---|
| `token` | Read from URL params → `playerData.token` | ✅ **Auth token** — sent in all API requests. **Hardcoded fallback: `"61d44c3121cb4f524f4daecf"`** (dev placeholder). Used as `sessionId` in message envelopes and `Authorization: Bearer {token}` for history API. |
| `playerId` | Read from URL params; falls back to `Math.round(Math.random()*1e7)` | Player identifier for API requests |
| `epoch` | Returned by gameinit, sent with spin/feature requests | Server-side sequencing token |
| `creditValue` | Game config (`creditValue: 20`) | Static config, denomination |
| `balance` | `gameInfo.balance` → updated after each spin | Server-provided, never persisted client-side |
| `bet` | `betAmount`, `betsArray[]`, `getTotalBet()`, anteBet | Gameplay — bet position stored in memory only |
| `session` | `promoSpinSession`, `freeSpinsSession`, `autoPlaySession` | In-memory game state booleans, not auth sessions |

**Critical finding:** The auth token is stored **only in JavaScript memory** (`playerData.token`), never in localStorage/cookies/IndexedDB. It must be provided via `?token=` URL parameter on each page load, or the hardcoded dev default is used. The FEG platform shell supplies this token when embedding the game in production.

**All game state lives exclusively in JS heap memory.** There is zero persistence of balance, bets, or session across page reloads. This has important implications for caching — the cache can safely serve identical static assets regardless of which player/session is active.

### 6.6 Fingerprinting / Device Identification

| Pattern | Found? | Context |
|---|---|---|
| `fingerprint` | No | — |
| `deviceId` / `device_id` | No | — |
| `clientId` / `client_id` | No | — |
| `screen.width/height` | Yes (likely in core-engine) | Layout/viewport adaptation |
| `navigator.userAgent` | Yes (typical in PixiJS/engine) | Feature detection |
| `navigator.language` | Yes | Locale selection |
| `performance.now` | Yes (typical in game loop) | Frame timing |
| `Date.now` | Yes (throughout) | General timestamps |

These are standard game-engine patterns, not tracking/fingerprinting.

---

## 7. Synthesis: Practical Answers

### 7.1 Can this bundle be served from a native disk cache without re-fetching?

**Yes.** Asset URLs are stable across loads within a build:

- **JS bundles** use content hashes in filenames → immutable per build, infinite cache possible.
- **CSS** uses `?v=TIMESTAMP` which is stable per build — the cache layer should strip/normalize this parameter.
- **All other 250+ assets** (PNG, JSON, OGG, MP3, atlas, webp, fonts) have **static, predictable paths** with no session tokens, no per-request query params, no dynamic components.
- **No Service Worker** complicates the caching strategy.
- **No integrity hashes** prevent local modification or caching proxy insertion.

A native file-system cache that maps URL → local path can serve this entire bundle from disk with zero network requests on repeat loads, provided the cache key normalizes away the `?v=` CSS parameter.

### 7.2 One dominant bootstrap cost or death-by-many-requests?

**One dominant bootstrap cost.** The critical path for first paint is:

1. **vendor-pixi.js (1.23 MB)** — the single largest JS bottleneck. Must be fetched + parsed + compiled before PixiJS initializes. This is ~72% of all JS and ~1.2% of total bundle but **blocks everything**.
2. **core-engine.js (371 KB)** — second JS bottleneck, loaded in parallel but needed before game logic runs.
3. **index.html + game-empireofgold.js + index-canvas.js** — negligible (~53 KB combined).

After JS boots, the engine loads asset bundles progressively. The **preloader phase** loads only 2 small JSONs + 1 font + brandLogo.png. The **splash phase** loads splashBG + splashAssets sprites (small webp + jpg). The **primary phase** is the heavy one (spine assets, sounds, gameElements, symbols). Background music (BBGM/FBGM at ~4 MB each) and secondary spine assets load during gameplay, not during initial load.

**The bottleneck is clearly `vendor-pixi.js` (1.23 MB) for cold starts.** A prefetch strategy should prioritize this single file, then core-engine.js, then preloader assets.

Asset count is high (~300 files), but they are loaded progressively and many are lazy.

### 7.3 Any signal this bundle would detect/block automation, headless browsers, or non-standard request interception?

**No.** This is a clean bundle:

- Zero anti-debugging (no `debugger` statements, no DevTools detection).
- Zero headless/automation detection (no `navigator.webdriver`, no bot/crawler checks).
- Zero integrity verification (no SRI, no checksums, no code self-checking).
- Zero fetch/XHR monkey-patching.
- No service worker that could bypass or conflict with our caching layer.

The bundle is designed to run inside FEG's platform WebView — it trusts its host environment completely and performs no adversarial checks.

### 7.4 What's the realistic "cold load" byte count before playable?

Assuming we count everything that must be fetched before the player sees the main game (splash → main game transition):

| Phase | Files | Size |
|---|---|---|
| HTML entry | `index.html` | ~1.6 KB |
| CSS (5 files) | `common.css`, `footer.css`, `commonGameRules.css`, `gameRules.css`, `history.css` | ~45 KB |
| JS bundles (4 files) | vendor-pixi, core-engine, game-empireofgold, index-canvas | **~1.72 MB** |
| Preloader assets | gameContent.json, commonContent.json, brandLogo.png, Mulish.ttf | ~221 KB |
| Splash assets | splashBG.jpg, splashAssets.webp (both @1x) | ~1.5 MB |
| Primary assets (min to play) | controlPanelAssets, gameElements, symbols, reel_frame, BG_king spine, king_character spine, explosion1, loader_anim.gif, bitmapFont, lang assets, sounds (first contact) | ~18–22 MB |

**Realistic cold-load before playable: ~22–28 MB** at minimum (JS + preloader + splash + primary assets). On a 4G connection (~10 Mbps), this is **~18–22 seconds** of raw download time, plus JS parse/compile overhead (~1–3 seconds for 1.72 MB of JS), plus GPU texture upload.

With a warm disk cache on repeat visits: **~0 bytes** cross the network (all assets served from local cache). The JS parse/compile and GPU texture upload would still take time, but network is eliminated entirely.

### 7.5 What would break our native interception + disk cache approach?

**Minimal breakage risk.** This bundle is unusually cache-friendly for a casino game:

1. **CSS `?v=` timestamp parameter** would cause cache misses if not normalized. **Mitigation**: Strip `?v=` from cache keys for CSS files (the underlying files don't change within a build anyway).

2. **Resolution-aware path construction** (`@0.5x` vs `@1x`) means the game requests one or the other based on `window.devicePixelRatio`. A cache layer must handle both resolution variants or risk missing assets.

3. **Locale-aware paths** (`assets/locale/{lang}/`) mean 8× the locale JSON files. Only one language is fetched per session, but the cache must have all if serving multiple locales.

4. **Audio format selection**: Both `.mp3` and `.ogg` are present. The engine likely selects one format based on browser support. The cache must either serve both or detect which format the engine requests.

5. **Spine multi-page textures**: Some spine assets span 2–3 texture pages (`_2.png`, `_3.png`). The engine constructs these paths by appending `_2`, `_3` to the base texture name. If the cache doesn't have these overflow pages, spine animations will render with missing textures.

   6. **Sound `?version=0.036` query param**: All sound files get a version query string appended by Howler.js. The cache layer must strip or normalize this parameter.

   7. **Missing external module `offline-data-DTb4NQY9.js`**: This dynamically-imported module contains the `encryptObject()` function and offline mock data. Without it, the game cannot boot. The cache must either: (a) include this file in the pre-warmed asset set, or (b) allow it to pass through to the origin on first load and cache it thereafter.

   8. **SpinIQ API endpoints** (`api.spiniq.io`): These API calls (gameinit, spin, feature) are outside the scope of static asset caching — they require the live backend or a mock server. In the current build, these calls are bypassed via offline mock data embedded in the missing external module.

**None of these break caching fundamentally** — they are known-schema issues that a well-designed cache layer handles with URL normalization rules and a complete asset manifest. This bundle has no per-session URL tokens on static assets, no dynamic query params, and no anti-tamper mechanisms. It is an ideal target for our native interception + disk cache approach.

---

*Analysis conducted read-only against certified third-party code. No files modified.*
*Bundle: Empire of Gold (gameId: `empireofgold`, version: `0.036`), FEG Platform*