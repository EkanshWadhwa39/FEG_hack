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
