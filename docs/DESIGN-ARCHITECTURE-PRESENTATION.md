# FEG Challenge 3
## Predict the Next Game. Prepare It Before the Click.

**Round 1 — Product, Design & Architecture Direction**  
**Scope:** PSK web and mobile web

> Use the player’s lobby time to safely prepare the likely next game, then launch the normal provider game unchanged.

**Current status:** browser mechanism validated locally; full-title staging validation is next.

---

# 1. The problem
## Game loading starts when player patience is lowest

Today, most game bootstrap work starts **after** the player chooses a title. Network transfer, startup scripts and visual assets then compete on the launch path.

- **MEASURED from FEG-provided PSK data:** players average 2.43 games per session and 16.14 sessions over the analysed period.
- **MEASURED from FEG-provided data:** five providers represent 69.8% of stake, creating a focused integration opportunity.
- A slow or blank transition appears at the moment of highest player intent.
- We cannot solve this by bypassing authorization or rewriting certified game code.

### The question

**Can the lobby anticipate one likely next game and move safe download work before selection?**

---

# 2. What the existing HARs tell us
## Warm browser state materially changes the network journey

For the same exact final 16-request asset batch:

| Measurement | Cold capture | Repeat/warm capture |
|---|---:|---:|
| Full HAR span | **76.358 s** | **16.253 s** |
| Exact 16-request milestone | **35.568 s** | **6.714 s** |
| Selected-batch wire bytes | **716,931** | **0** |
| Selected-batch cache markers | No positive marker | All 16 marked disk cache |
| Full-capture transfer | **~16.6 MB** | **~12 KB** |

The full HAR span was **78.7% shorter**. The selected asset milestone completed **81.1% earlier**, or approximately **5.3×**, in the repeat capture.

### Why there are two timings

- **Full HAR span** includes every recorded request, including sparse later fetch/ping traffic.
- **Exact asset milestone** stops when the same exact 16 game-asset requests have completed.
- Both are capture-relative network measurements—not click-to-interactive.
- This is a historical cold/repeat comparison, not a result caused by our prototype.
- Claims such as “6 seconds to 1 second” remain **unvalidated**.

---

# 3. Our product direction
## Prefetch the user’s likely next game—not the whole catalogue

### Candidate selection

The lobby chooses **one bounded candidate** from approved signals such as:

- sustained hover, focus or game-details dwell;
- recently played title;
- an existing favourite;
- an existing platform recommendation output.

The selection policy affects speculative requests only. It does **not** change lobby ordering, styling, recommendations or player focus.

### Safe preparation

For that candidate, the lobby resolves the exact title build, locale and device tier, then prepares only:

`PRELOADER` → `COMMON` → `SPLASH` → proven critical `PRIMARY`

`SECONDARY` content remains demand-loaded.

### Launch

When the player selects the candidate, the normal provider iframe launches unchanged and may reuse the browser’s existing HTTP-cache entries.

---

# 4. The experience in one line
## Authorize → Select → Govern → Warm → Launch → Measure

```text
Mandatory authorization succeeds
              ↓
Choose one likely next game
              ↓
Check consent, connection, visibility and byte budget
              ↓
Warm a small exact set of credential-free static assets
              ↓
Player clicks; normal provider iframe launches unchanged
              ↓
Measure exact reuse and the agreed readiness milestone
```

### If anything goes wrong

Denial, timeout, unknown authorization, poor connection, Save-Data, wrong variant, budget exhaustion or request failure leads to **no warming and the normal safe path**.

The optimization may be skipped. Mandatory protection never is.

---

# 5. Why this approach
## Small integration surface; clear safety boundaries

| Decision | Why we chose it |
|---|---|
| Browser HTTP cache | It is the same standard cache the iframe can use |
| Web/mobile-web only | Matches the PSK delivery surface |
| One predicted candidate | Limits wasted data and keeps measurement clear |
| Exact versioned URLs | Browser cache reuse depends on exact identity |
| Maximum two requests at once | Avoids competing with foreground lobby activity |
| No certified game changes | Keeps provider behavior and launch authority intact |
| Normal launch fallback | Prefetch failure cannot break the player journey |

### Deliberately excluded

No native SDK, service worker, custom cache, provider-code fork, whole-catalogue prefetch or authorization bypass.

---

# 6. What is validated—and what is next
## Evidence today

**The mechanism is proven in production, not just locally.**

- **MEASURED in production** (`casino.psk.hr`, public demo play, 3 control + 3 treatment runs):
  warming the provider bundle from the lobby page cut launch-phase wire bytes from
  **11,253,576 to 35,113 — a 99.7% reduction** — and network responses from 112 to 14.
- **MEASURED in production:** the container shell warmed to **0 bytes transferred** across 3
  treatment runs, against ~92.5 KB cold, with identical decoded bytes.
- **MEASURED in the sandbox**, on the FEG-provided package served unmodified at ~12 Mbps,
  3 paired runs: time to engine-canvas **1,498 ms → 481 ms (67.9% faster)**, wire bytes
  **52,220,526 → 4,984,599 (90.5% less)**.
- The warming was performed by the prototype's own `warmer.js`, not a bespoke test script.
- Cross-site reuse works. We expected Chrome's cache partition to block a `v1t.eu` iframe from a
  `psk.hr` warm. It does not. We tested it rather than assuming it.

## Not yet validated

- **Click-to-playable.** Every number above is bytes, or time to *engine start*. The provided
  package cannot reach playable in a sandbox: `offline-data-*.js` is absent from the package as
  supplied, and the game calls `api.spiniq.io`, which we do not have.
- **Prediction hit rate.** A 99.7% saving on a launch that never happens is pure waste. The
  governor and the hit-rate policy are what make the number defensible.
- **Exclusion-register latency.** Still UNKNOWN. Blocking, never cached, never raced.
- Generalisation beyond one title, one provider, one browser.
- Any native or WebView surface.

## The honest headline

> We can prove we remove the network from a game launch. We cannot yet prove how many seconds
> that is worth to a player reaching a spin button, because the package we were given has no
> backend to reach.

---

# 7. How we will prove it on staging
## Same launch; only warming changes

### CONTROL

- Fresh isolated browser state.
- Same game, browser, locale, device tier and readiness milestone.
- No prefetch before selection.

### TREATMENT

- A separate fresh isolated browser state.
- Same conditions as CONTROL.
- Authorization succeeds first.
- The prototype warms the exact approved assets before selection.

### We will report

- prediction hit or miss;
- warmed assets and speculative bytes;
- launch transfer and confirmed cache reuse;
- asset milestone and authoritative input-accepted time, if exposed;
- browser, title, provider and number of runs;
- wasted bytes, failures and fallback behavior.

**Go/no-go:** no player-facing enablement until exact reuse and an agreed launch benefit are repeatable.

---

# 8. Team split: A / B / C / D
## Four owners, one evidence path

| Member | Role | Primary ownership |
|---|---|---|
| **A** | Product & Architecture Lead | Scope, candidate policy, decisions, integration and pitch |
| **B** | Browser Systems Lead | Governor, exact asset preparation, normal iframe handoff and fallback |
| **C** | Evidence & Experiment Lead | HAR analysis, staging CONTROL/TREATMENT, cache attribution and privacy-safe results |
| **D** | Experience, Compliance & QA Lead | Player states, accessibility, failure rehearsal, claim review and demo quality |

### Working agreement

- One owner per artifact; A integrates reviewed work.
- Browser experiments run serially to avoid cache contamination.
- C owns the evidence definition; D can block misleading claims.
- Any team member can stop release for authorization, privacy or player-safety risk.

---

# 9. Delivery plan
## From validated mechanism to validated product

| Gate | Outcome | Status |
|---|---|---|
| **1 — Problem and scope** | Web-only, browser-native direction locked | Complete |
| **2 — Browser mechanism** | Parent request reused by later iframe locally | Complete, title/browser scoped |
| **3 — Safe orchestration** | Authorization, governor, exact manifest and fallback | Simulated prototype complete |
| **4 — Staging adapter** | Approved configuration and exact title manifest | Next when access arrives |
| **5 — Causal experiment** | Isolated CONTROL/TREATMENT with repeat runs | Pending staging |
| **6 — Product decision** | Benefit, hit rate and wasted-byte thresholds pass | Pending evidence |
| **7 — Demo and submission** | Truthful narrative, reviewer access and freeze audit | Final gate |

### Success is not “requests were sent”

Success means the predicted title was selected, exact warmed objects were reused, player readiness improved, and speculative cost stayed within policy.

---

# 10. Round-one decision
## Approve the direction—and validate the outcome next

### The proposition

**Select one likely next game and prepare a small, exact, authorized set of static assets before the click. Then launch the unchanged provider game normally.**

### Why proceed

- PSK usage creates repeated opportunities to prepare the next title.
- Historical HARs show the value of warm browser state.
- Local evidence confirms the core parent-to-iframe cache mechanism.
- The design is bounded, reversible and authorization-first.
- Staging access will enable the missing full-title causal proof.

### The honest commitment

We are not claiming a production improvement, an 86% prototype gain or a 6-to-1-second result today. We are asking to proceed with a design whose mechanism is locally validated and whose product impact has a clear staging test.

> **Round-one ask:** approve the browser-native prefetch direction, the A/B/C/D execution split and the staging validation gate.

---

# Evidence notes

- `MEASURED` means directly observed or calculated in the named data/capture/experiment.
- `FEG-PROVIDED` means supplied through organiser data or communication.
- `SIMULATED` means a local fixture, policy or UI used for controlled testing.
- `UNKNOWN` means approved evidence does not yet support the claim.

Sources: `CODE.md`, `Context/FINAL-PLAN.md`, `docs/EVIDENCE-STATUS.md`, `docs/HAR-MILESTONE.md`, `docs/LOCAL-CACHE-REUSE.md`, `docs/DECISIONS.md` and `docs/STAGING-SANDBOX.md`.

Raw HARs, provider assets, credentials and player-level data are excluded from this presentation.
