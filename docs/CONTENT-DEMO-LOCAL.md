# Vault: complete standalone localhost demo

**Branch:** `agent/content-loading-core`
**Status:** runnable original synthetic reference game, not an Empire of Gold replica or final hackathon submission.

This branch adds a separate lobby, game and portable server. It does **not** replace
Hansika's `index.html`, `sandbox.html`, player or visualizer. Use **`npm run demo`**,
not the older `npm run serve` / `serve:content` / Python sandbox commands.

## On your laptop

Install Git, **Node.js 22 LTS or newer**, npm and current desktop Chrome. No Python,
provider archive, `.env`, API key, external service, build step or administrator
privileges are needed to play. The dependency-free server also works on Node 18.19
(the Linux version tested here). macOS and Windows are intended portable targets,
not machines on which this handoff claims a test was run.

```bash
git clone --branch agent/content-loading-core --single-branch https://github.com/EkanshWadhwa39/FEG_hack.git FEG-content-demo
cd FEG-content-demo
npm ci
npm run demo
```

The repository uses your normal GitHub access. Do not paste tokens into a URL or
commit credentials. Clone into an ordinary directory in your home folder, not a
symlink/junction or an untrusted shared directory.

Open **http://127.0.0.1:8095/** in Chrome. `http://localhost:8095/` also works, but
**keep one hostname and port throughout a visit/comparison**: they are different
origins and cache identities. Keep the terminal running; stop with Ctrl+C.

If the port is occupied:

```bash
npm run demo -- --port 8096
```

Use the new port in Chrome. `--port 0` chooses a free port and prints its URL.
Do not open the HTML as `file://`. The server deliberately serves only this demo,
approved source modules and generated fixtures; it does not expose your checkout.

If you already have a dirty team checkout, use the separate clone above. Do not
reset/discard your work just to switch branches.

## A complete visit

1. In the operator panel, choose **Granted — allow this sandbox**. This is an
   explicitly SIMULATED authorization fixture, **not** an exclusion-register check.
   Unknown, denial and error fail closed. Nothing launches around them.
2. Check **Allow speculative asset requests**. It is off by default for consent.
3. Leave **Top three + hover / keyboard focus** and **Synthetic popular, not yet
   played** selected. In a fresh visit, the internal candidates are `title-01`,
   `title-02`, `title-03`. Wait for the top-three pass to finish: normally **9
   completed objects / 336 KiB**. These are preparation bodies, not proven hits.
4. Hover another card for **220 ms**, or Tab/focus it and dwell. Its exact assets
   take priority over background candidates. Leaving resumes the bounded top-three
   pass. The lobby's card order, styling and focus do not change with predictions.
5. Click any card. The parent cancels/drains speculation, checks the sandbox
   authorization again, resolves the exact manifest and mounts the game iframe.
6. Play **Vault Match**: reveal two cards and find eight pairs. A mismatch remains
   visible until **Turn cards back**; reset restarts the same board without fetching
   again. Enter/Space and arrow-key navigation work. No bets or payments exist.
7. The parent reports **Interactive in this scene only** after the first accepted
   trusted card action—not iframe load, first paint or a fabricated timer.
8. Return to the lobby. A title becomes played only after accepted input. Popular
   unplayed candidates exclude it; **Synthetic session favourites** prepares up to
   three actually played titles, ordered by count/recency. With no plays it has no
   favourites. Session history is bounded in memory and disappears on reload.

Twenty titles are twenty **stable asset identities and byte-seeded editions of
one original memory game**, not twenty provider games. Full bodies seed the deck,
colour theme and geometric artwork. The base HTML/JS/CSS also load normally and
are not included in the three-asset metric. The `en` / `hr-HR` and `1x` / `0.5x`
controls select distinct fixture identities; UI text remains English and fixture
sizes remain the same. No SECONDARY or unproven PRIMARY is warmed.

## Reading the results

- **SIMULATED:** catalogue, popularity, authorization and original generated assets.
- **MEASURED:** this browser visit's bytes, timings and accepted game actions.
- **STATICALLY-INFERRED:** configured sizes/limits, not claims about a provider.
- **UNKNOWN:** missing timing/capability, cache residency before launch, all provider readiness.

Three resources contain **114,688 bytes (112 KiB)** per title. A consumed-body count
of 114,688 during launch is normal even when cached: JavaScript still reads those
bytes. It does not tell you whether they came over the network.

A Resource Timing transfer sum of **0** reports no transfer for those matching
launch entries. A sum of **115,588** was observed for full cold transfers in tested
Chromium (body sizes plus Resource Timing's per-resource header allowance, not a
packet capture). `UNKNOWN` is not zero. The automated check corroborates timing
with isolated server request/body-write deltas. Browser eviction, DevTools cache
disabling and request/response rules can still make a prepared title miss.

The **3 MiB per-visit reservation budget** includes cancelled attempts and excludes
normal foreground launch plus ordinary thumbnails/source loading. Maximum two
speculative requests are active through full-body consumption; priority replacement
waits for cancelled workers to drain. Hidden tabs, Save-Data, slow/unknown network
capability, busy foreground work, revoked authorization, disabled consent and
exhausted budgets stop/block speculation. Missing network capability does not block
an otherwise authorized normal launch. A bounded retry handles a busy interval;
there is no polling loop that continuously spends bandwidth.

Top-three prediction costs **336 KiB** initially even if you play only one title.
Only 112 KiB helps that title; 224 KiB was prepared for alternatives. This is moving
work before click with a bounded prediction cost, **not reducing total visit bytes**.

## Fair CONTROL / TREATMENT

A reload is **not** a cold reset. Navigation/restoration starts a fresh fail-closed
authorization model and clears the visible consent controls; grant and opt in again. Use separate clean Chrome profiles, or close
**every** Incognito window between arms (concurrent Incognito windows share state).
Do not use your normal profile's arbitrary existing cache as the baseline.

- **CONTROL:** fresh session, grant sandbox authorization, leave preparation off,
  click the chosen title and record **asset response bodies consumed**.
- **TREATMENT:** fresh session, same origin/title/locale/tier, grant authorization,
  enable preparation, wait for it to complete **before click**, then launch.
- Keep DevTools **Disable cache unchecked** in both arms, the tab visible, the
  same browser and milestone. Do not route/intercept fixture requests or change
  version query strings to manufacture a result.
- `clickToInputAcceptedMs` includes your thinking/clicking delay. Do **not** present
  it as autonomous time-to-interactive or compare it as a loading speedup.
- Localhost bodies are small and fast. Transfer reuse is the primary assertion;
  this demo promises no particular milliseconds or six-second provider launch.

## Tests

Unit/security/model tests and syntax checks are portable Node commands:

```bash
npm test
npm run check:js
```

For three isolated serial CONTROL/TREATMENT pairs and additional browser diagnostics:

```bash
npx playwright install chromium
npm run verify:demo
```

Optional: run the verifier against your **installed desktop Google Chrome**:

```bash
npm run verify:demo -- --channel chrome
```

The verifier does not use your personal Chrome profile. Linux CI may additionally
need Playwright's documented browser system dependencies. Default automated tests
use pinned Playwright 1.55.1 Chromium; this patch fixes the inherited browser-download
certificate-validation advisory. The server/playable app does not require Playwright.
`--runs 1` is a quicker smoke check. Do not run multiple browser verifiers together.

Output: ignored `evidence/derived/content-demo-verification.json`. It contains only
bounded synthetic measurements. It is **not a HAR pair** and does not replace the
separate HAR/redaction release gate for a final submission. The older
`npm run verify:content` proves a different Python-hosted fixture seam; its prior
results are not silently reused for this new Node host/game.

Diagnostics cover hover, keyboard-focus preparation, full keyboard board completion,
reset without refetch, wrong-title cold miss, fail-closed states/revocation, unavailable
network capability, emulated mobile viewport/reduced motion, bounded offline
fallback/online recovery, navigation return and persisted-page restoration. Browser automation
can generate trusted browser inputs: that tests the event path, not human provenance.

The repository's broader Python checks remain `./scripts/bootstrap.sh`,
`./scripts/check.sh`, `.venv/bin/python tools/measure_har.py --help`; they are not
prerequisites for the standalone laptop demo.

## Limits and integration handoff

- This is a completed **standalone local reference experience**, not final FEG
  submission readiness. `docs/PRE-SUBMISSION-AUDIT.md` still governs submission.
- Real exclusion-register endpoints, production manifests/cache/CORS/redirect rules,
  provider input signals and real catalogue policy hit rates remain unvalidated.
- No provider bundles/artwork/code, raw datasets, player identities, custom asset
  cache, service worker, native app or cache-key rewriting are used here.
- Server source reads reject symlinks/junctions and unknown routes and bind loopback
  only, with Host/Origin checks and bounded reads/requests. The portable Node host
  assumes a **trusted checkout**; unlike the old Linux pinned-directory host, it
  does not defend against a malicious local process racing ancestor replacement.
- Policies, game model, scheduler and transport are tested independently. The UI
  reuses content-loader/adapters/governor/manifest/warmer; it does not copy or modify
  Hansika's player/visualizer. Review shared branch diffs before any merge to main.
- Main new files: `prototype/content-demo.html`, `content-game.html`, matching
  `src/content-demo*`, `src/content-game*`, styles, Node tests,
  `tools/content_demo_server.mjs`, `content_demo_fixtures.mjs`,
  `verify_content_demo.mjs`, `scripts/javascript_checks.mjs`.
- The earlier content-core commits already include shared requester/manifest edits
  and a one-line `sandbox.js` fix removing its forced `enabled: true` override.
  Those security changes are retained, not a rewritten UI. This addition makes
  no further edits to Hansika's sandbox/player/visualizer/provider files.
- The launcher/test scripts in `package.json` and the content-loader's explicit
  queue-candidate/drain logic are intentional integration edits. See
  `docs/CONTENT-DEMO-HANDOFF.md` for test results and branch ownership.
- AI assistance: the Computer lead implemented orchestration/UI/verifier/docs;
  two specialists implemented disjoint original game and portable server modules;
  a separate read-only review informed integration. Lead owns the final checks.
