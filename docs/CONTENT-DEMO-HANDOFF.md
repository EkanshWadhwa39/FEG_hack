# Standalone playable demo — implementation handoff

Branch: `agent/content-loading-core`. Entry point: **`npm run demo`** →
**http://127.0.0.1:8095/**. Full laptop instructions: [CONTENT-DEMO-LOCAL.md](CONTENT-DEMO-LOCAL.md).

## Delivery and ownership

This change sits on the four earlier content-core commits ending `3a7f416` (based
on Hansika's `add36df`). It supplies a complete separate **original non-wagering
memory game** and local laptop UI: twenty fixed title/asset identities, top-three
background preparation, hover/focus priority, explicit opt-in, policy/variant
controls, budget/trace panel, iframe launch, trusted accepted-input reporting,
keyboard/touch play, reset, revocation, recovery and responsive styling.

It does not recreate or repair the supplied provider game. The synthetic fixture
bodies actually seed the original game's board, theme and geometric card art.
Downloaded bodies are discarded after derivation; normal browser HTTP caching is
the only asset cache. Neither Cache API nor service worker is used.

No **new** edits were made to Hansika's index/main/sandbox/player/visualizer/provider
files. The branch's earlier shared requester/manifest changes and one-line removal
of `sandbox.js`'s forced `enabled: true` override are retained and disclosed. User
requested pushing this separate branch, **not merging it into main**. Shared diffs
still require review before integration with the teammate's UI.

### Files changed in this addition

- `prototype/content-demo.html`, `prototype/styles/content-demo.css`,
  `prototype/src/content-demo.js`: independent lobby/operator/readiness UI.
- `prototype/src/content-demo-policy.js`, `content-demo-scheduler.js`: top-three
  selection and cancellable serial queue, same-exact-title in-flight reuse.
- `prototype/content-game.html`, `prototype/styles/content-game.css`,
  `prototype/src/content-game.js`, `content-game-model.js`: original playable game.
- `prototype/src/content-loader.js`: explicit validated queue candidate seam;
  cancelled preparation and previous launch grants drain before replacement.
- `tools/content_demo_server.mjs`, `content_demo_fixtures.mjs`: dependency-free,
  loopback-only portable Node host, allowlisted files and generated originals.
- `tools/verify_content_demo.mjs`: serial clean-browser comparisons and diagnostics.
- `prototype/tests/content-demo-scheduler.test.mjs`, `content-demo-server.test.mjs`,
  `content-game-model.test.mjs`, changes to `content-loader.test.mjs`.
- `scripts/javascript_checks.mjs`, `package.json`: shell-glob-free Node test/syntax
  runner, `demo` and `verify:demo` commands; no dependency/version changes.
- `README.md`, `docs/CONTENT-CORE-HANDOFF.md`, this handoff and laptop runbook.

Lead owns integration. Two specialists owned disjoint server/fixture/test and game/
model/style/test files. A read-only reviewer inspected the assembled implementation;
lead corrected all four findings: missing thumbnail projection, hidden/lazy image
loading, persisted-page lifecycle, and same-title abort/restart. Eager original
thumbnails now load for all twenty cards in every browser scenario. Returning via
history/reset pageshow also resets visible authorization/consent to the fail-closed
model; there is no stale granted-looking control. This is material AI assistance.

## Commands and results

**MEASURED on Linux x86_64, Node 18.19.1, Playwright 1.52.0 / Chromium 136.0.7103.25.**
Node 22+ is recommended for laptops; actual macOS/Windows and installed Google
Chrome were **not** tested on this host. The committed verifier supports `--channel
chrome` so the user can repeat the same checks with local Chrome.

| Command / check | Result |
|---|---|
| `./scripts/check.sh` | **PASS: 193 Python + 254 JavaScript tests**, Python lint, 61 JS syntax checks, shell lint |
| `.venv/bin/python tools/measure_har.py --help` | **PASS** |
| `./scripts/serve.sh` on an isolated loopback port + HTTP GET | **PASS**; old surface preserved, not the new demo entry point |
| `npm run verify:demo` | **PASS: three serial isolated pairs + eight diagnostics** |
| All twenty thumbnails, desktop and emulated mobile | **PASS** in every browser scenario; no unexpected console/page/CSP errors |
| Source review fixes | Scheduler regressions pass; thumbnail/history/persisted event regressions pass in browser checks |

Main pairs each start a new browser/context and use the same Node server, top-level
origin, title-01, en, 1x and exact versioned URLs. No route interception, cache
override, throttling, artificial latency or provider requests are used.

**MEASURED in all three pairs:**

| Asset-only metric | CONTROL | TREATMENT |
|---|---:|---:|
| Pre-click asset responses, all top-three titles | 0 | 9 |
| Pre-click server response bodies, all top-three titles | 0 B | 344,064 B (336 KiB) |
| Selected-title launch requests received by asset server | 3 | 0 |
| Selected-title launch server response bodies | 114,688 B | 0 B |
| Matching browser Resource Timing launch transfer sum | 115,588 B | 0 B |
| Selected-title bodies consumed by game JS | 114,688 B | 114,688 B |

These are server **body-write** deltas and browser Resource Timing, not packet
capture wire bytes. Thumbnails, HTML, JS and CSS are excluded. Two unchosen prepared
titles cost 224 KiB: treatment does **not** reduce total visit bandwidth in this
single-title example. Preparation completion is not a guaranteed resident cache hit.

Milestone: **reference asset response bodies consumed**. Automated trusted card
input separately verifies the accepted-input event. Its timing is **not** a human
readiness latency, production input milestone, six-second provider proof or general
catalogue/browser result. No particular millisecond speedup is claimed.

Eight additional diagnostics:

1. Exact hover target title-17 reuses assets; keyboard completes eight pairs; reset
   adds zero asset requests.
2. Keyboard-focus dwell prepares title-18.
3. Wrong title-20 stays cold despite top-three preparation and loaded thumbnails.
4. UNKNOWN, DENIED and ERROR admit neither preparation nor iframe; live revocation
   removes the active frame.
5. Missing network capability blocks speculation but permits authorized launch
   (explicit navigator override, diagnostic only).
6. 390×844 mobile emulation, touch input, reduced motion and no horizontal overflow
   (not an actual device/browser claim).
7. Offline launch has a bounded 20-second fallback and clean online retry (explicit
   offline injection, diagnostic only; expected offline errors are scoped).
8. Real back navigation plus injected persisted-pageshow recovery resets controls
   fail-closed and launches normally afterward. Actual BFCache admission varies.

Reproducible output is ignored `evidence/derived/content-demo-verification.json`;
it contains synthetic summary telemetry only. This **is not a HAR pair** and does
not supersede the final-submission HAR/redaction gate. Older content-core HAR/summary
results concern another host/seam and must not be reused as proof of this game.

## Remaining boundaries / next action

- User: clone this branch, run `npm ci` then `npm run demo`; in Chrome grant the
  simulated authorization and explicitly enable speculation. For a benchmark use
  clean serial profiles and leave DevTools **Disable cache unchecked**.
- The separate clone is important if the user's teammate checkout is dirty.
- Backend is **localhost-only**, not production or a permanent public deployment.
  It supports a trusted local checkout, not a hostile same-user filesystem race.
- Initial popularity is synthetic; favourites come only from bounded in-memory
  accepted plays. Variant controls select distinct fixture identities, not a
  translated UI or real provider device-tier selection.
- All real exclusion-register integration, production manifests/CORS/cache rules,
  provider gameplay readiness and macOS/Windows/device measurements remain UNKNOWN.
- `docs/PRE-SUBMISSION-AUDIT.md` was read. This is a development-branch delivery,
  **not a freeze/submission**. Its wider documentation, access, disclosure/history
  scan, organiser declarations and final reproducibility items remain a separate
  blocking submission gate; do not equate passing these tests with readiness to submit.
