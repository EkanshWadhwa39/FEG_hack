# D4 — Compliance and Safety Note

**FEG Hackathon Challenge 3 — Game Load Time**
Solution: browser-native cache warming for the PSK casino lobby.

## Design Philosophy

Compliance and player safety are not afterthoughts in this solution — they are structural.
The governor/warmer architecture enforces conservative, fail-closed behaviour at every layer.
No game code is modified. No service worker is deployed. No custom cache is introduced.

## EU Regulatory Compliance

### GDPR (Reg. (EU) 2016/679)

This solution **does not process personal data**. No PII, player identifiers, session tokens,
hashes, or player records are read, stored, transmitted, or logged at any point. The 20
lobby slots are synthetic catalogue entries for demonstration only.

Privacy-by-design (Art. 25) is inherent: the architecture was built from the start to avoid
touching player data. All prefetch requests use `credentials: "omit"` — cookies, tokens,
and session headers are never sent. Data minimisation is total: we fetch only static game
assets (JS, CSS, images, fonts), never player-linked resources.

### ePrivacy (Directive 2002/58/EC)

Cache warming uses the browser's standard HTTP cache via `fetch()` with default cache
policy. No cookies are set, read, or transmitted. No local/session storage is written.
No tracking pixels, fingerprinting, or analytics are deployed. No marketing content,
push notifications, or unsolicited communication is sent. No ePrivacy consent mechanism
is required because no terminal-equipment storage beyond standard HTTP caching occurs.

### AMLD / KYC (AMLD 2015/849, AMLR 2024/1624)

This solution does not handle onboarding, identity verification, payment, or any financial
transaction. It operates entirely within the lobby browsing phase — before any regulated
activity begins. No KYC integration is needed or attempted.

### eIDAS 2.0 (Reg. 910/2014, 2024/1183)

This solution does not perform age or identity verification. The exclusion-register gate
(see below) is designed as a blocking check point where identity/age verification —
including future EUDI Wallet attribute-based proofs — can be integrated without
architectural changes.

### EU AI Act (Reg. (EU) 2024/1689)

No AI or ML model runs at any point. All behaviour is deterministic and rule-based:
the governor applies fixed policy checks, the manifest resolves a static asset list,
and the warmer dispatches fetches in priority order. No recommendations, profiling,
risk scoring, or personalisation exists. No dark patterns or manipulative UX is employed.

AI tools (Claude, cptr) assisted with development planning, code audit, and documentation.
No AI model is embedded in the runtime. This disclosure is made in accordance with
hackathon guidelines.

### Accessibility (EAA — Directive 2019/882, WCAG 2.1 AA)

The lobby UI provides: sufficient colour contrast between text and background, keyboard-navigable
game cards, readable font sizes, and visible focus indicators. The prefetch toggle is a standard
checkbox with a visible label. Progress and status indicators use text alongside colour (not
colour alone). A full WCAG 2.1 AA audit is listed as a production integration step.

## Responsible Gambling & Player Protection

| Principle | How our solution complies |
|---|---|
| **No dark patterns** | No manipulative UX. Progress bars reflect real fetch completion (ADR-005). No fake urgency, no forced continuity, no disguised engagement mechanics. The prefetch toggle is honest and visible. |
| **No inducements to vulnerable/self-excluded** | No bonus offers, marketing content, or engagement nudges. The solution prefetches static game assets — it does not promote, recommend, or incentivise play. |
| **18+ verification respected** | The exclusion-register gate (`sandbox.js`) is a blocking, fail-closed check designed to run before any warming begins. It does not bypass or weaken any existing age-gate. |
| **Exclusion-register pattern** | Designed as a register-check, not a UI checkbox — warming is blocked until a positive clearance result is returned. Denial, error, timeout, or unknown response all halt the flow. |

## Croatia (PSK) National Layer

| Area | Compliance posture |
|---|---|
| **Data protection (AZOP)** | No personal data processed — see GDPR section above |
| **Act on Games of Chance** | Exclusion-register gate is designed as a blocking register-check before play/warming, matching the Croatian requirement for a check against the register of excluded players |
| **AML / KYC** | Not applicable — no financial transactions or onboarding |
| **DSA (Reg. 2022/2065)** | Not applicable — no user-generated content, no marketplace, no recommender |

## Safety Mechanisms (designed in, not bolted on)

| Mechanism | What it does |
|---|---|
| **Fail-closed governor** | Unknown browser API or unexpected state → prefetch skipped entirely |
| **Save-Data respected** | Slow or metered connections block all speculative transfer |
| **Budget cap** | Configurable byte limit prevents unbounded data cost |
| **Max 2 concurrent requests** | Conservative cap avoids overwhelming the network or CDN |
| **`credentials: "omit"`** | Every prefetch request omits cookies, tokens, and session headers |
| **Abort on hover-leave** | In-flight warming cancels immediately when the player moves away |
| **Cancel on launch** | All background warming stops the moment a game loads |
| **Exclusion-register gate** | Blocking and fail-closed — designed for production integration |

## Data Rule Compliance

No real player or customer data, no real identity documents, and no live production data
feeds or APIs are used. The game bundle is provided hackathon sample content served
unmodified. All 20 lobby catalogue entries are synthetic. This is fully compliant with
the hackathon data rule.

## Production Integration Steps

| Step | Status |
|---|---|
| Connect exclusion-register API to the existing blocking gate | Integration point ready |
| Validate CDN cache-control headers for target game bundles | Requires staging access |
| Confirm locale/tier resolution against live catalogue | Requires catalogue API |
| Full WCAG 2.1 AA accessibility audit | Scaffold in place |
| ePrivacy assessment for HTTP-cache warming in target jurisdictions | Legal review needed |
| Origin allowlist for game iframe navigation | Configuration step |

Each item is an integration step against existing architecture — not a missing feature or
blocking defect. The design anticipates these requirements; the seams are already in the code.

---

*This note is an awareness summary for a hackathon proof-of-concept, not legal advice.
Any solution progressing beyond the hackathon requires review by FEG Legal & Compliance
before processing real data or going live.*
