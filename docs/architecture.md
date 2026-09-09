# Architecture — BETA packaging snapshot

**Status: source review, not submission-ready or production-validated.** Baseline:
`979aceb`; packaging relocates the browser directory unchanged to `src/`, retaining
its inner `src/` and `tests/`. Paths here describe the packaged layout.
Packaging is not a runtime fix or new causal performance evidence.

See [README](../README.md), [impact](impact-case.md),
[compliance](compliance-note.md), and [dependencies](dependencies.md).

## Scope and topology

Our own sandbox is the sole hackathon evaluation environment; staging is not a
dependency. Browser/mobile-web only; no model or training, new game assets,
reference/substitute game, native app, service worker, custom cache, or application
DB. **SIMULATED:** 20 lobby identities. **FEG-PROVIDED:** one supplied unchanged
Empire of Gold bundle behind those identities, not 20 separate playable titles.

```text
Browser: src/lobby.html (inline controller, UI, manifest, direct requester)
  -> src/src/governor.js           toggle / estimated-budget admission
  -> src/src/warmer.js             stage ordering / two workers per job
  -> src/src/warm-ledger.js        completed exact-URL Set, page lifetime only
  -> fetch(..., cache: default)    browser-managed HTTP cache
  -> sandbox /game/{slot_nonce}/  aliases to one unchanged bundle
Click -> cancel speculative work -> iframe -> same slot-prefixed resource URLs
External side path: Google Fonts stylesheet and font requests from the lobby
```

All component counts and configuration values below are **STATICALLY-INFERRED**
from source unless explicitly labelled otherwise. Cache reuse remains **UNKNOWN**
until observed for exact requests; the ledger stores URL metadata, not payloads.

## Active lobby flow

1. The inline script imports only the warmer, ledger, and governor modules.
   Warming is enabled initially; `TOP_N=1` triggers the first card automatically.
   Other cards warm after 150 ms hover/focus dwell; intent cancellation uses aborts.
2. Each page creates a random session suffix. Slots use distinct URL prefixes,
   while the sandbox maps them to identical supplied bytes. This reduces reuse
   across reloads; it is not a persistent catalogue identity strategy or a
   substitute for independently isolated experimental profiles.
3. The embedded 58-entry manifest includes versioned CSS and PRELOADER, COMMON,
   SPLASH, and entries marked critical PRIMARY. SECONDARY is not admitted by the
   warmer. A `critical: true` flag is an assertion, not proof of criticality.
4. Paths are fixed to English and `@1x`; the plan/target metadata says `hr-HR`/`1x`.
   Matching those metadata strings does not establish correct device/locale
   resolution. Production URLs and response contracts cannot be inferred here.
5. The direct requester uses CORS, `credentials: omit`, `cache: default`, abort
   signals, and low request priority when supported. It checks success and drains
   bodies. A completed fetch does not prove storage, retention, or iframe reuse.
6. Body size (or an estimated fallback) feeds speculative totals; manifest
   estimates feed card progress. Completion can be declared at one entry short
   or at 95% estimated bytes. “Warm” therefore is not exact cache completeness.
7. Clicking cancels tracked background jobs, mounts an iframe for the same slot,
   and starts elapsed-time reporting, readiness polling, and a 25 s rollback timer.

## Boundaries that must not be conflated

| Source | Responsibility and limit |
|---|---|
| [Active lobby](../src/lobby.html) | Actual real-request entry point; owns direct fetching, launch heuristics, UI labels. |
| [Warmer](../src/src/warmer.js) | Validates stages/variant metadata, sorts dispatch, supports abort/ledger; maximum two workers **per invocation**, not across all cards. |
| [Ledger](../src/src/warm-ledger.js) | Page-local Set of exact completed URLs; not a cache API, database, or hit detector. |
| [Governor](../src/src/governor.js) | Pure policy rejects unknown/unsafe inputs, but lobby passes fixed permissive network/visibility values. |
| [Browser requester](../src/src/browser-requester.js) | Separate validated credential-free HTTPS requester with body drain; **not used by active lobby**. |
| [Sandbox controller](../src/src/sandbox.js) | Separate authorization-state seam; its checks do **not** gate active lobby traffic or iframe launch. |
| [Transition module](../src/src/transition.js), [player](../src/src/player.js) | Separate synthetic player/transition surface, not the active lobby's launch controller. |
| [Scaffold](../src/src/main.js) | Simulated-request UI; not an alternative supplied game or current causal proof. |
| `src/tests/`, `tests/` | JS component/UI-contract and Python utility tests; presence is not live-lobby validation. |

## Known active-path defects and measurement hazards

- **Authorization absent:** no exclusion-register gate blocks warming or iframe
  launch. A timeout rollback labelled “fail-closed” is not authorization security.
- **Heuristic readiness:** canvas cursor, visible Pixi stage nodes, and selected
  waterfall entries trigger “interactive” text without an input-accepted signal.
  Same-origin inspection may fail cross-origin; iframe load is not playability.
- **Rollback still armed:** the readiness callback does not clear the 25 s timeout
  or settle the rollback closure. A launch described as ready can later unmount.
- **Not a global governor:** concurrent jobs may exceed two total fetches. Budget
  accounting happens after bodies complete, without global in-flight reservation.
  Default “Unlimited” is a very large numeric cap, not an approved safe budget.
- **Hardcoded environment:** network/visibility are supplied as permissive constants;
  locale, tier, manifest versions, ETAs, ports, and displayed network profile are
  fixed assumptions. Environment-aware behavior must not be inferred from UI copy.
- **Unsafe `game` parameter:** its value forms fetch URLs, connection hints, and an
  iframe URL without an approved origin/scheme allowlist. Use only a trusted local
  sandbox address; `credentials: omit` on fetch does not secure iframe navigation.
- **Unproven labels:** “100% cached”, “0 wire transfer”, “Ready from cache”, and ETA
  constants are not authoritative cache/readiness measurements. See [impact](impact-case.md).

## Hosting and evidence tooling

[The sandbox server](../tools/sandbox_server.py) accepts an external bundle path,
serves lobby and game routes, aliases slot prefixes, and sets local cache/CORS
policy. These permissive local headers do not demonstrate provider deployment
policy. Reviewer supply of the unchanged bundle requires permission and a secure
provisioning route; a clean source clone alone does not contain the game.

When throttling is enabled, requests classified as prefetch receive **3.2×** the
configured base rate. Classification uses request headers, not causal intent;
this is an experimental confound, not a measured speedup.
[The benchmark](../tools/benchmark_cold_vs_warm.mjs) enforces a **36-entry** warm set,
whereas the active lobby embeds **58 entries**. It cannot establish equivalent
coverage or validate current lobby claims without reconciliation.

The separate Node static server is not equivalent to bundle-routing sandbox
hosting. Local servers are development tools, not hardened deployments.
External Google Fonts means the UI is not fully offline/self-contained.
No actual supplied dataset is required by the application runtime.

## Validation boundary

**MEASURED:** packaging checks passed 50 Python tests (including seven layout/path
checks) and 136 JS tests with zero skips, plus Ruff, JS syntax and ShellCheck. The
checked toolchain is documented in [README](../README.md). All 42 relocated browser
files were verified byte-for-byte against the selected baseline. These checks
validate the relocation and existing test coverage, not active-lobby authorization,
cache reuse, or accepted-input timing. No new performance experiment or production
request was used. Runtime defects remain open. Sandbox causal proof and final-commit
release/security gates are listed in [impact](impact-case.md) and
[compliance](compliance-note.md).
