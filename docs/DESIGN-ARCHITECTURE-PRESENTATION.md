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

- **MEASURED locally:** a completed parent fetch of one unchanged 1,292,928-byte Empire of Gold asset was reused by a later iframe request in Chromium.
- **MEASURED locally:** 2/2 treatment iframe requests transferred zero response-body bytes from the local origin.
- Exact-URL, version-mismatch and `no-store` controls behaved as expected.
- A tested simulated prototype covers authorization order, exact variant selection, byte budgets, cancellation and maximum-two concurrency.

## Not yet validated

- Full Empire of Gold prefetch and launch.
- User-game prediction hit rate.
- Staging CORS, cache policy and exact manifest behavior.
- Prototype-caused click-to-ready or input-accepted improvement.
- Any “6 seconds to 1 second” outcome.

## Staging update

**Access is expected soon but has not yet been validated.** Staging is where the design moves from local mechanism evidence to a full-title causal test.

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
