# Architecture decisions

## ADR-001 — Browser-native, dependency-light prototype

**Status:** accepted

Use vanilla HTML/CSS/ES modules and the browser HTTP cache. Python is used for local serving, HAR evidence, and large-data analysis. No frontend framework, backend, service worker, custom cache, or native layer.

**Why:** matches the web-only constraint, minimizes integration and build risk, and keeps the causal mechanism visible.

## ADR-002 — Evidence before feature breadth

**Status:** accepted

The first release gate is an isolated control/treatment HAR pair where treatment was warmed only by prototype code. Policy/UI breadth cannot substitute for this artifact.

## ADR-003 — Conservative governor

**Status:** accepted

Maximum speculative concurrency is two. User disablement, Save-Data, budget exhaustion, page hidden state, and foreground pressure pause or stop work. Missing APIs degrade conservatively.

## ADR-004 — Exact URLs and variants

**Status:** accepted

Resolve locale and resolution before warming and use exact versioned production URLs. Do not strip query parameters or warm both tiers.

## ADR-005 — Truthful readiness and compliance

**Status:** accepted

Exclusion authorization fails closed and is never bypassed. A game becomes `interactive` only from an authoritative signal; otherwise the demo labels the milestone precisely as simulated or weaker.

## ADR-006 — Staging unavailable during the hackathon

**Status:** accepted external constraint

The staging URL was reported unavailable due to a technical issue and will remain inaccessible throughout the hackathon. The team will not substitute production traffic, guessed URLs, embedded credentials, or a mock for staging evidence. The submitted prototype therefore remains a clearly labelled local simulation, while the local parent-to-iframe experiment remains browser-mechanism evidence only.

Build the prototype now for later sandbox testing on staging, with environment-specific URLs and integration configuration kept outside the generic core. The staging control/treatment capture, authenticated exclusion-register timing, exact deployable manifest, real CORS/cache-policy validation, and authoritative input-accepted signal remain mandatory later validation gates—not cancelled requirements. When staging is introduced, resume those gates serially under the existing evidence protocol before enabling player-facing warming.

## ADR-007 — Warm scheduling is stage-banded, not shortest-makespan

**Status:** accepted (architecture); measured effect **UNKNOWN** pending the browser A/B

Speculative warming dispatches strictly in bundle-consumption order —
PRELOADER, COMMON, SPLASH, then proven-critical PRIMARY — and orders assets
largest-first *within* each band only. Concurrency remains 2.

**Why:** the objective is not minimum makespan. A player clicks when they
click, so what matters is the unwarmed critical bytes remaining at click time,
`E[U(t_click)]`. Pulling a later band forward would shorten total warm time
while leaving the player facing more unwarmed bytes on the path the game
actually consumes first. Largest-first within a band bounds that band's tail on
a two-worker pool without reordering across bands.

A session ledger keyed on the **exact** URL suppresses repeat warms, so hovering
several titles from one provider costs one COMMON fetch rather than several. The
key is never normalized: the browser cache key is the exact URL, so a normalized
ledger key would report a hit for an object that was never warmed.

**What is not yet established:** the magnitude of any improvement. No isolated
control/treatment browser run has been made against this scheduler. The local
fixture server is loopback, so a run without CDP throttling would understate
transport effects; any resulting number is `SIMULATED-NETWORK`, never `MEASURED`
for production.

## ADR-008 — Speculative warm requests drain their response body

**Status:** accepted; cache-admission mechanism **UNKNOWN**

The credential-free requester now consumes the response body before resolving,
discarding bytes via `pipeTo` into a sink. Opaque (`no-cors`) responses are
skipped untouched. Requests additionally carry `priority: "low"` where the
platform supports it, feature-detected, degrading silently where it does not.

**Why:** a fulfilled `fetch()` whose body is never read may never be admitted to
the HTTP cache, which would mean warming silently does nothing for large assets.

**The motivating premise did not survive measurement.** `tools/probe_drain_admission.mjs`
ran drained and undrained arms, two runs each, fresh browser process per run,
identical in every respect but the drain. **MEASURED:** Chromium 136.0.7103.25
admitted and reused the response in 2/2 runs of *both* arms. The server sent the
full 1,048,576-byte body during the undrained prefetch and served zero launch-phase
bytes afterwards. Draining is therefore **not required for cache admission** in
this configuration. Scope: local fixture server, loopback, one asset, one browser
build, `public, max-age=3600, immutable`. Slow-network, large-asset, and
production-header behavior remain UNKNOWN.

**The drain is retained for a different and better reason.** `fetch()` resolves
when response headers arrive, not when the body completes. A warm worker that
awaits only `fetch()` therefore releases its slot mid-transfer, so the
concurrency-2 ceiling in ADR-003 would bound *requests in flight* rather than
*bodies in flight* and actual concurrent transfers could exceed two. Draining
holds the worker until the transfer finishes, which is what makes the ceiling
mean what ADR-003 says it means. Peak concurrent transfer count was reasoned
from documented `fetch()` semantics, not measured; that measurement is
outstanding.
