# Content-loading core — incremental integration handoff

## Step 0 / ownership reconciliation

Based on Hansika's remote `add36df` (18 commits ahead of the session's original
checkout). Her `81a1ef8` added `prototype/sandbox.html`, `tools/sandbox_server.py`
and `tools/sandbox_measure.mjs`; `c3f7aa0` added the player surface. Read these
and the shared resolver/governor/warmer/requester/drawer/player in full first.
The shared preparation modules were inherited unchanged from `c1040ce`, not
new copies on her branch. There is no `tools/CODE.md`; root `CODE.md` is the brief.
The original checkout's latest sandbox-only planning supersedes staging dependency.

Reuse: shared exact locale/tier resolver, pure conservative governor, two-worker
warmer, one-way intent design and server substrate. Do not use the old sandbox's
untyped discovered URL list as a real manifest: it marks everything COMMON,
assumes one-byte assets and calls header-only no-cors requests without a governor.
Keep this separate diagnostic and the UI untouched rather than silently combining
incompatible preparation paths. The new content coordinator uses injected interfaces.

Worktree: `/home/ubuntu/FEG_content_core`, branch `agent/content-loading-core`.
Original working-tree edits, raw inputs and UI/style files are not staged here.
No production or staging requests are authorized or needed by this work.

## Increment 1: safety boundary

- Extend existing resolver with strict title/build/locale/tier/version validation.
- Requester now requires explicit approved origins, HTTPS by default, no redirects,
  credentials omitted, no referrer, readable CORS body drained to completion.
- Separate explicitly loopback-only HTTP adapter; production HTTPS boundary unchanged.
- Two requester slots cover full-body lifetime even across candidate cancellation.
- Positive body reservation, declared length check, streaming overrun detection,
  cancellation and timeout. Response/body completion still does NOT prove cache reuse.
- Fix old sandbox coordinator overriding explicit disablement.

Validation: `node --test prototype/tests/{browser-requester,manifest,sandbox,warmer}.test.mjs`.
Risks: a body budget is not an exact wire-byte cap. Transport buffers/headers and a
chunk already delivered before overrun detection may exceed the estimate. Retain
reservations for failed/aborted work, report observed overruns, and stop speculation;
do not claim zero wasted bytes. An adapter that ignores AbortSignal retains its
request slot until it actually settles, conservatively degrading rather than
starting unbounded replacement transfers.

## Increment 2: independent synthetic catalogue and policy

**SIMULATED configuration:** exactly twenty stable titles, two explicit locales,
two explicit tiers, three eligible startup stages per variant. Each title has its
own immutable versioned keys and original generated SVG. These are NOT twenty
provider games. No provider artwork, bundles, real user rows or personal history
were copied into product code.

- `catalogue.js`: deeply frozen fixtures, exact identities and the existing
  drawer-only player projection (`id`, `title`, `provider`).
- `candidate-policy.js`: cache-only OFF / FAVOURITE / POPULAR_UNPLAYED policies.
  Favourite means most played in this synthetic in-memory session, then most
  recent, then fixed catalogue order. No-history favourite and exhausted
  unplayed history return no candidate. Explicit dwell/click intent overrides
  the statistical choice, but never OFF.
- Prior: **SIMULATED** Zipf fit to the **MEASURED direct-extraction aggregate**
  documented in `Context/FINAL-PLAN.md`: top ten of 887 titles account for 34.7%
  of launches. Equal-rank buckets provide synthetic weights for the twenty
  fixtures; these are NOT measured per-title popularity or personalized scores.
- `catalogue-bindings.js`: delegated dwell/click events, child-transition and
  detached/replaced-node guards, hidden-page cancellation, safe disposal,
  bounded text thumbnail fallback with no retry loop. No skin/theme edits.
- `tools/content_server.py`: reuses the existing sandbox handler substrate but
  overrides serving/cache policy for original synthetic content only. Loopback,
  no provider mount, pinned Linux source-root descriptor, no symlink/traversal
  fallback, immutable fixture success and no-store errors/source/diagnostics.
  CSP stays enabled. Aggregate metrics contain no URLs, headers or identities
  beyond the bounded synthetic title IDs.

**MEASURED checks:** twenty focused catalogue/policy/binding Node tests passed;
164 synthetic-server HTTP tests passed. HTTP coverage includes every binary key,
all thumbnail SVGs, GET/HEAD, missing-thumbnail isolation, parser errors,
traversal/symlinks/root replacement, metrics and descriptor cleanup. Linux-only
confinement is deliberate; do not claim platform portability.

Ownership: the original failed delegations were explicitly released before
recovery. The replacement catalogue and server specialists completed and
released their disjoint files; lead reviewed and integrated them. Only lead ran
browser experiments. No specialist committed or changed the UI.

## Increment 3: content coordinator and UI handoff

New modules: `content-loader.js`, `content-adapters.js`, `content-integration.js`.
New tests: `content-loader.test.mjs`, `content-integration.test.mjs`; strict
manifest tests also cover explicit version-query names and content-hash path
identity without rebuilding the URL.

**SIMULATED defaults:** warming starts disabled, policy OFF. The coordinator
reserves a caller-configured session body budget atomically before scheduling;
never refunds cancellations/failures/unstarted remainder; observes delivered
chunks; stops the session on overrun. Request slots remain owned until body work
settles. Completed URL metadata prevents duplicate speculative requests, but is
not a custom asset cache and never asserts that the HTTP cache retained an object.

Every preparation requires exact title/build/locale/tier/version, a fresh explicit
`GRANTED` authorization result and an independently current grant. Every launch
performs its own fresh check, cancels speculative work, waits for cancellation to
settle, then returns either a blocked result or `LAUNCH_AUTHORIZED`. A grant carries
a live AbortSignal for revocation/replacement/disposal. No player-visible launch
or iframe is created by the coordinator. Authorization denial, error, timeout or
malformed result never falls through to foreground launch.

Governor inputs are live and conservative: Save-Data, unknown/slow connection,
hidden document, disabled opt-in, observed long tasks and exhausted budget block
new speculation. Missing connection/visibility capabilities do not invent a fast
network. Requester bounds are readable-body bounds, **not exact wire-byte caps**.

### Narrow integration seam (UI owner)

1. Run `npm run serve:content` for the **SIMULATED**, loopback-only fixture server.
   `/health` and `/__metrics` are safe diagnostics. `/` still serves the existing
   UI; it is **not automatically wired to this core**. No HTML/CSS/player skin was
   modified in these commits.
2. Import catalogue/session/prior factories, adapters, `createContentLoader`,
   `bindContentLoading` and `bindThumbnailFallback`. Share one requester instance
   and one loader per session so concurrency and budget cannot reset on each tile.
3. Supply existing catalogue root `[data-game-id]` buttons. Binding returns
   `playerCatalogue` (existing three-field whitelist, fixed order) and a separate
   static `playerThumbnails` map (`label`, `url` only). Use those for rendering,
   never `selectCandidate`, weights, reasons or operator telemetry. Attach each
   thumbnail fallback before assigning its static URL. Call its disposer on removal.
4. Supply `readVariant()` returning explicit `{build, locale, tier}`. There is no
   implicit browser-locale, resolution or version fallback. The integrated dwell
   minimum is **SIMULATED configuration: 150 ms**. Click is immediate known intent,
   but never skips authorization and never starts speculative work.
5. Wire the explicit opt-in to `loader.setEnabled(boolean)` and the **operator-only**
   policy control to `loader.setPolicy("FAVOURITE" | "POPULAR_UNPLAYED" | "OFF")`.
   For policy-only preparation call `loader.prepare({build, locale, tier})`.
   Hover dispatch is handled by the binding. Do not reorder/restyle/refocus tiles.
6. `onLaunch(grant)` may start NORMAL foreground loading only while
   `!grant.signal.aborted`. Observe that signal throughout the launch and fail
   closed on revocation. Use `grant.plan` exact URLs; do not reconstruct them.
   Opt-out/budget exhaustion only disable speculation, not a separately authorized
   ordinary launch. A failed preparation is not a failed game and not a success.
7. Report reference-scene input acceptance separately from provider input
   acceptance. Record a synthetic session play only on the intended explicit
   synthetic play event—not on hover, asset-body completion or first paint.
   `loader.resumeBrowsing()` ends that foreground lifecycle. Dispose the binding,
   loader/environment and thumbnail bindings when leaving the view.

Adapter contracts (no caller needs production endpoint knowledge):

```text
manifestSource.resolve({id,build,locale,tier}, {signal}) -> manifest
requestAsset(exactUrl, {signal,estimatedBytes,onBytes}) -> {completed,bodyBytes}
requestAsset.validateUrl(exactUrl) -> exactUrl (validation only)
authorization.check({purpose,signal}) -> exactly "GRANTED" or a denial state
authorization.isGranted() -> boolean; subscribe(listener) -> unsubscribe
environment.read() -> {saveData,effectiveType,visibilityState,performanceBusy}
environment.subscribe(listener) -> unsubscribe
```

**UNKNOWN / not supplied here:** real exclusion endpoint/permission, authorized
production manifest and matching credential/cache/CORS/Vary behavior, true
provider PRIMARY critical-path proof, authoritative provider input acceptance,
actual player conversions and production catalogue-wide effect. Fixtures are not
exclusion checks. Swap only approved adapters after those contracts exist;
judges' sandbox remains independent of staging.

Read-only review corrections before integration commit: explicit UI cancellation
and every replacement click now invalidate pending launch callbacks and abort the
launch signal **before** reading the new variant. Authorization adapters must
provide a live subscription/unsubscribe interface; pending/unknown/denied/error
transitions must notify. These paths have regression tests. Caller implementations
must still honor the returned launch AbortSignal; an adapter cannot revoke UI code
that ignores it. No new browser/security claim is based solely on interface shape.

## Increment 4: measured verification / final checks

Files: `tools/verify_content_core.mjs`, `package.json` (scripts only),
`evidence/derived/content-core.json`, `docs/CONTENT-CORE-MEASUREMENT.md` and this
handoff. Runner uses serial fresh Chromium contexts/processes, original fixtures,
unchanged CSP and no cache-disabling routing. Raw HARs stay ignored, in distinct
per-experiment directories; only a safe aggregate is committed.

**MEASURED final checks:**

- `./scripts/check.sh`: **193 Python tests, 152 JavaScript tests**, lint and syntax
  checks passed.
- `node tools/verify_content_core.mjs --runs 3`: passed three isolated pairs,
  twenty-title preparation/authorized-click checks, thumbnail failure isolation,
  policy DOM stability, denial, distinct-title miss, no-store and redirect controls.
- `PORT=18184 ./scripts/serve.sh`: HTTP 200 with curl; stopped owned server afterward.
- `.venv/bin/python tools/measure_har.py --help`: passed.
- `node tools/verify_content_core.mjs --help` and `git diff --check`: passed.

See the measurement document for exact byte/timing/cost results and limitations.
These checks used this host's pre-existing dependency environment, temporarily
linked into the isolated worktree. The two lead-created dependency symlinks were
removed afterward (targets untouched), leaving standard bootstrap instructions.
A clean-clone install/reviewer rehearsal is still a final merged-release gate.
No raw evidence, provider bundles, media, credentials or original user edits were
staged. No push/merge or submission was performed. No source-only integration result
should be described as a finished playable UI or a production performance proof.
