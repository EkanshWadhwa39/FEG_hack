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
