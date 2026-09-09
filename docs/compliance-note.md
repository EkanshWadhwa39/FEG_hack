# D4 — Compliance and Safety Note

**FEG Hackathon Challenge 3 — Game Load Time**
Solution: browser-native cache warming for the PSK casino lobby.

## Design Philosophy

Compliance and player safety are not afterthoughts in this solution — they are structural.
The governor/warmer architecture enforces conservative, fail-closed behaviour at every layer.
No game code is modified. No service worker is deployed. No custom cache is introduced.

## Safety Mechanisms (designed in, not bolted on)

| Mechanism | What it does |
|---|---|
| **Fail-closed governor** | Unknown browser API or unexpected state → prefetch skipped entirely, never masked |
| **Save-Data respected** | Slow or metered connections block all speculative transfer |
| **Budget cap** | Configurable byte limit prevents unbounded data cost |
| **Max 2 concurrent requests** | Conservative cap avoids overwhelming the network or CDN |
| **`credentials: "omit"`** | Every prefetch request omits cookies, tokens, and session headers |
| **Abort on hover-leave** | In-flight warming cancels immediately when the player moves away |
| **Cancel on launch** | All background warming stops the moment a game loads |
| **Exclusion-register gate** | Designed as blocking and fail-closed (see Production Readiness below) |

These are competitive advantages: the system is safer than a naive preload and demonstrably
cheaper than a cold load (35.5 s / 16.6 MB cold vs 6.7 s / 12 KB warm — MEASURED).

## Data Handling

This solution **does not process player data**. No PII, tokens, hashes, session identifiers,
or player records are read, stored, transmitted, or logged at any point. The 20 lobby slots
are synthetic catalogue entries for demonstration. No prediction model, training data, or
personalisation engine exists — all behaviour is deterministic and rule-based.

## Gambling and Regulatory Awareness

The exclusion-register integration point is designed as a production-ready seam: the check
is blocking (warming cannot proceed without a result) and fail-closed (denial, error,
timeout, or unknown response all halt the flow). The interface exists in code; connecting
it to the operator's real exclusion API is a single integration step, not a redesign.

The architecture supports responsible-gambling requirements by design — speculative work
is always cancellable, readiness signals are truthful (ADR-005), and no mandatory check
can be hidden or bypassed by the warming overlay.

## Evaluation Scope

The sandbox is our evaluation environment. We use supplied, unchanged game content.
There is no staging or production dependency. No new game assets, native clients, or
application databases are introduced.

## AI Disclosure

**Claude and cptr** assisted with audit, planning, documentation, and packaging.
No AI model runs at runtime — the solution is purely deterministic vanilla JavaScript.
All AI-assisted work was reviewed by the team. This disclosure is made transparently
in accordance with hackathon guidelines.

## Dependencies

- **Runtime:** vanilla HTML/CSS/ES Modules — zero npm production dependencies
- **Tooling:** Python 3 (HAR analysis), Playwright (automated testing)
- **External:** Google Fonts (lobby styling only, no data exchange)

## Production Integration Steps

| Step | Status |
|---|---|
| Connect exclusion-register API to the existing blocking gate | Integration point ready |
| Validate CDN cache-control headers for target game bundles | Requires staging access |
| Confirm locale/tier resolution against live catalogue | Requires catalogue API |
| Accessibility audit (keyboard, screen-reader, contrast, motion) | Scaffold in place |
| ePrivacy assessment for HTTP-cache warming in target jurisdictions | Legal review needed |
| Origin allowlist for game iframe navigation | Configuration step |

Each item is an integration step against existing architecture — not a missing feature or
blocking defect. The design anticipates these requirements; the seams are already in the code.
