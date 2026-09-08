# Empire of Gold bundle: safe development inputs

## Handling decision

The FEG-provided `empireofgold (1).zip` and any extracted game files remain private,
ignored reference material. Do not copy them into `prototype/`, commit them, or publish
them. They contain third-party provider code and media and are not required at runtime
by the lobby prototype.

Only derived, non-sensitive descriptions and manifests may be committed. A deployable
manifest must be generated from observed staging requests, not guessed from archive
paths.

## What the bundle establishes

The following findings are **STATICALLY-INFERRED** from the supplied Empire of Gold
bundle and are scoped to that title and supplied build only:

- The browser entry chain uses an HTML entry point and hashed ES-module bundles.
- The engine loads assets in the order `PRELOADER`, `COMMON`, `SPLASH`, `PRIMARY`,
  then `SECONDARY`.
- Asset selection varies by locale and resolution tier (`@0.5x` or `@1x`).
- Static game resources use ordinary browser HTTP loading; no service worker was found.
- Some asset requests include version query strings. Those strings are part of the exact
  browser cache key and must be preserved byte-for-byte.
- Spine resources can consist of descriptors, atlases, and multiple texture pages; a
  logical asset name is not necessarily one HTTP request.
- The supplied archive is incomplete for standalone production-equivalent launch: a
  referenced external module is absent and API-backed launch behavior is environment
  dependent.

These findings help define what to measure. They do **not** prove parent-to-iframe cache
reuse, production cacheability, CORS permission, or launch interactivity.

## Inputs needed for implementation

### Available now

- **STATICALLY-INFERRED:** stage order and prohibited `SECONDARY` boundary.
- **STATICALLY-INFERRED:** locale and resolution-tier dimensions.
- **STATICALLY-INFERRED:** candidate bootstrap resources and multipart asset behavior.
- **MEASURED:** aggregate cold/repeat HAR differences documented in
  `docs/EVIDENCE-STATUS.md`.
- A tested manifest resolver that requires exact locale, exact tier, exact URL strings,
  and an explicit critical flag for proactively requested `PRIMARY` entries.
- A tested request governor and simulated warming flow with concurrency capped at two.

### Must come from controlled staging capture

1. Exact production request URLs, including origin, path, case, and query strings.
2. Exact browser, title build/version, locale, and resolution tier.
3. Response cache headers and browser cache classifications for candidate resources.
4. CORS/credential behavior for requests initiated by the parent lobby.
5. The requests actually used before the agreed launch milestone.
6. A proven critical subset of `PRIMARY`; do not infer this solely from archive size.
7. An authoritative game/provider signal that input is accepted before reporting
   `interactive`.
8. Clean control/treatment HARs from isolated profiles or contexts, with at least one
   repeat of each arm.

## Manifest promotion gate

A candidate resource can enter the staging manifest only when all of these are true:

- Its exact URL was observed in the target staging launch.
- Locale and resolution tier were resolved before speculative requesting.
- It belongs to `PRELOADER`, `COMMON`, `SPLASH`, or a measured critical `PRIMARY`
  subset.
- It contains no player identifier, token, credential, or session-specific value.
- Its response is eligible for browser HTTP-cache reuse under the tested request mode.
- The exclusion-register authorization has succeeded before warming begins.

`SECONDARY` is never proactively warmed. Query strings are never stripped, reordered,
or normalized in browser code.

## Safe repository layout

```text
FEG Innovation Hackathon 2026/empireofgold (1).zip  # private, ignored source input
evidence/private/                                   # private captures/intermediate work
evidence/derived/                                   # generated redacted summaries only
Context/empireofgold-bundle-analysis.md              # committed static-analysis appendix
docs/BUNDLE-DEVELOPMENT-INPUTS.md                    # this safe implementation handoff
prototype/src/manifest.js                            # generic exact-manifest resolver
```

Do not create a public `empireofgold/` asset tree. For local forensic work, read directly
from the ignored archive or extract only into an ignored/private temporary directory.

## Next development sequence

1. Obtain approved staging access and record browser/title/build/locale/tier.
2. Capture a clean control launch after exclusion authorization.
3. Derive a redacted candidate manifest from requests before the defined milestone.
4. Validate CORS, cache headers, and exact parent-to-iframe reuse one request at a time.
5. Add only the proven bounded manifest to a staging adapter.
6. Capture isolated control/treatment pairs and analyze them with
   `tools/measure_har.py`.
7. Publish only redacted aggregate evidence and the non-sensitive manifest fields
   approved for the demo.
