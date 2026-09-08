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

## ADR-007 — Capability absence is not a reason to do nothing

**Status:** accepted, supersedes part of ADR-003

ADR-003 says missing APIs degrade conservatively. That was implemented as a refusal,
which meant the Network Information API being **Chromium-only** silently disabled
warming on Firefox and on every browser on iOS, while appearing to work in
development.

The governor now separates two cases. A browser that has no Network Information API
degrades to a `REDUCED` speculation tier: transport hints and cheap byte warming
inside a smaller budget, never a speculative engine. An API that is *present* but
will not answer still fails closed, because present-and-broken is a more suspicious
condition than absent.

Save-Data continues to block everything, including the degraded path, because it is
a direct instruction from the player rather than an inference about their link.

**Why:** conservatism should bound the *cost* of being wrong, not disable the
feature for a large share of real players. A refusal that only ever fires on
non-Chromium browsers is not a safety property, it is an outage.

## ADR-008 — Graduated speculation, not all-or-nothing

**Status:** accepted

Speculation climbs a ladder whose rungs cost progressively more and are earned by
progressively stronger evidence of intent: a transport hint on first sight, the
blocking byte profile at ~200 ms of dwell, a speculative engine at ~600 ms or on a
touch-down. The decision is a pure function (`prototype/src/speculation.js`); the
page executes the actions it returns.

Authorization gates every rung, not only the reveal, and withdrawing it aborts work
already in flight. Speculative bytes are charged to a ledger for what is actually
spent, once per (title, rung), and refunded on teardown.

**Why:** the previous design had a free rung and a 52 MB rung with nothing between
them, so a glance either bought nothing or bought an engine. It also made the byte
budget decorative, since the governor approved 2.8 MB and the engine then spent 52.

## ADR-009 — Touch is a first-class intent source

**Status:** accepted

A touch screen fires neither `mouseenter` nor focus. Intent on touch comes from a
tile resting near the centre of a settled viewport (a guess, governed like hover)
and from `pointerdown` (not a guess — the tap has begun — so it goes straight to
the top rung).

**Why:** FEG telemetry puts ~72% of launches on a mobile client. A hover-only
design gives the majority of real players no speculation at all, by construction.
