# D4 — Compliance note

Challenge 3, Croatian brand (PSK). How this build maps to the EU regulatory baseline and the
Croatian national layer, and which design choices were made *because of* them.

Scope: a hackathon proof of concept. This is not legal advice and does not replace the
compliance review required before anything here processes real data.

---

## 1. Personalisation and the EU AI Act — the decision that shaped the product

**We do not show personalised recommendations to players. At all.**

The drawer offers exactly three views: **favourites, recents, and search**. Each is ordered by the
player's own data — when they favourited a title, when they last played it, or plain text
relevance. There is no "picked for you", no "trending", no similarity model, and no ranking
derived from other players' behaviour anywhere in the player-visible surface.

This is enforced structurally, not by policy statement
([`drawer.js`](../prototype/src/drawer.js)):

1. Rendered items are projected onto an `id`/`title`/`provider` whitelist, so an upstream score
   cannot reach the DOM even if one is introduced later.
2. Fourteen predictor field names (`score`, `rank`, `affinity`, `propensity`, `popularity`, …)
   throw a `RangeError` rather than being silently ignored.
3. A test asserts the rendered page never contains "picked for you", "recommended", "suggested",
   "top picks", or "trending".

**Prediction exists, but only to choose bytes.** The prefetch policy decides *which game files to
place in the browser cache*. Its output carries `playerVisible: false` and never orders, filters,
badges, or annotates anything the player sees.

### Why this is also the better engineering choice

We built the collaborative "players who played X then played Y" model and measured it against
3,337 real launch sequences. It **lost**, badly — 11.4% hit@1 versus 30.4% for simply warming the
title the player themselves just launched (see [`PREFETCH-POLICY.md`](PREFETCH-POLICY.md)).

So the non-profiling option won on merit before it won on compliance. We are not accepting a
weaker system to satisfy a regulator; the compliant design is the better one.

### AI Act position

| Point | Position |
|---|---|
| Is there an AI system? | The shipped policy is **rule-based** — recency ordering and a dwell timer. No model is trained, and no ML runs in the product. Reg. (EU) 2024/1689 concerns AI systems; a decaying counter is not one |
| Manipulative or exploitative practice (prohibited) | Nothing in the player surface is driven by inference. Ordering is the player's own history. No urgency, scarcity, streak, or re-engagement mechanic exists |
| Exploiting vulnerability | The predictor cannot target anyone: it selects files, not people, and cannot reach the UI |
| Transparency | Not triggered, since no player-facing AI output exists |
| Timeline | The Digital Omnibus on AI (in force 27 July 2026) defers high-risk obligations by up to 16 months. We rely on none of that deferral, because we assert no high-risk classification |

The offline evaluation in `tools/predictor_eval.py` is a **research artefact**, not a shipped
component. It never runs in the player path.

---

## 2. ePrivacy — the rule most easily missed here

**Directive 2002/58/EC Art. 5(3) is the most directly applicable rule to this entire project, and
it is not GDPR.**

Prefetching writes files into the browser's HTTP cache. That is *storing information in the
terminal equipment of a subscriber or user*. Art. 5(3) permits this without consent only where it
is **strictly necessary** to provide the service the user has explicitly requested.

Warming a game the player has **not yet chosen to launch** is speculative. It is difficult to
argue that speculative storage is strictly necessary for a service the user has not requested.
We therefore treat prefetch as requiring user control rather than assuming an exemption.

Design consequences, all already built:

- A **visible, player-controlled toggle** governs prefetching. It is a first-class control, not a
  buried setting.
- A **per-session byte budget** the player can see and change.
- The governor declines automatically on `Save-Data`, on metered or slow connections, when the
  page is hidden, and when the budget is exhausted. Missing browser APIs **fail closed** — an
  unknown connection state means do not spend.
- Only static game assets are warmed. No cookie, `localStorage`, `sessionStorage`, IndexedDB
  entry, or identifier is written by this feature.
- Nothing is written before the player is in the lobby and the governor has allowed it.

The proposed ePrivacy Regulation is still not adopted; Directive 2002/58/EC as amended remains
binding, and that is what we designed against.

---

## 3. GDPR

| Area | Position |
|---|---|
| Real player data | **None used anywhere.** Every figure in the prototype is synthetic and labelled `SIMULATED` |
| Analysis data | The FEG event log and stake extracts are pseudonymised. `predictor_eval.py` reads **session and title fields only** — player identifiers are never read, joined, or emitted. Output is aggregate |
| Dwell tracking | Behavioural observation, so we state it plainly rather than claiming "no personal data". It is in-memory only, session-scoped, never persisted, never transmitted, never associated with an identifier, and used solely to choose which files to cache. It makes no decision *about a person* |
| Data minimisation, Art. 5(1)(c) | k defaults to **1**. We warm one title, not a basket, and we chose the smaller footprint on measured evidence |
| Privacy by design, Art. 25 | The predictor cannot reach the UI by construction, not by review. See §1 |
| Special categories | None processed |
| Erasure | Cached assets are static game files; clearing site data removes them. No profile is built, so there is no profile to erase |

---

## 4. Responsible gambling and player protection

| Requirement | Implementation |
|---|---|
| No dark patterns | The launch indicator is **indeterminate** — a progress bar predicting a completion time we cannot know would be a fabricated cue. Skeleton placeholders show that content is coming, **never a value**: no invented title, thumbnail, jackpot, balance, or count |
| No fabricated checkpoint | We never manufacture a fake reality check or age prompt to fill loading time |
| No inducements | No bonus, free-bet, streak, urgency, or re-engagement content exists in this surface |
| Truthful readiness | The transition may report `interactive` **only** from an authoritative input-accepted signal. `FIRST_PAINT`, `IFRAME_LOAD`, `SPLASH_VISIBLE`, and `TIMER` are rejected with an error, not ignored |
| RG state visible during transition | Session clock, signed net position, and limit headroom. Headroom is worded as *limit remaining*, never as spending capacity, which would read as an inducement. Losses show an explicit minus rather than appearing neutral |
| Counter-metrics | Stake velocity and time on device are tracked to detect whether faster launches make play more intense. They are **operator-only** and asserted absent from the player surface by test. Showing intensity metrics to a player mid-transition would be an engagement cue |
| Speed never bypasses protection | See §5 |

---

## 5. The authorization boundary — non-negotiable

The exclusion-register check is **blocking**. It is never cached, never raced, never prefetched,
and never optimistically rendered past. Error, timeout, malformed response, and denial all **fail
closed**.

Its real latency is **UNKNOWN** and we have not measured it. We refuse to model or estimate it,
because a plausible-looking number would invite designing around it. If it is slow, the transition
screen tells the truth and waits.

This is the one rule that survives demo-day time pressure unchanged.

---

## 6. Croatia national layer

| Area | Instrument | Our position |
|---|---|---|
| Gambling / RG | Act on Games of Chance + Regulation on Measures for Socially Responsible Organisation of Games of Chance (**binding**, not soft law) | Requires ID/age verification and a check against the register of excluded players **before play**. We implement this as a **register-check pattern**, not a UI checkbox, and it blocks. Regulator: Ministry of Finance |
| Data protection | Act on the Implementation of the GDPR | Supervised by AZOP. No real personal data is processed by this build |
| AML / KYC | Zakon o sprječavanju pranja novca i financiranja terorizma | Not triggered: this layer handles static game assets, not transactions or onboarding |
| DSA | Croatian implementing act for Reg. (EU) 2022/2065 | No user-generated content, marketplace, ads, or recommender system in this surface — and per §1, deliberately no recommender |

---

## 7. Accessibility — EAA / WCAG 2.1 AA

Measured and tested, not asserted. Full evidence including limitations in
[`ACCESSIBILITY.md`](ACCESSIBILITY.md).

- All text tokens meet AA on all four surfaces; worst measured 6.07:1. Control borders and the
  focus ring meet non-text contrast; worst 3.27:1. Ratios are **computed** by
  [`contrast.js`](../prototype/src/contrast.js), verified against published WCAG reference values.
- Keyboard: roving tabindex, ARIA tabs, a focus trap proven across 8 Tab and 8 Shift+Tab presses,
  `inert` background behind the modal, focus returned to the launching tile.
- Reflow at 320px and text resize to 200% verified in-browser.
- `prefers-reduced-motion` stops the launch pulse and the skeleton shimmer, and switches on the
  longer announcement window.
- **Dwell credits keyboard focus exactly like pointer hover**, so a keyboard or switch-device user
  gets the same faster launch. Treating only the mouse as intent would make the feature quietly
  worse for assistive-technology users.
- Skeleton placeholders are `aria-hidden`; the container is `aria-busy`; one announcement fires on
  settle with the real count.

**Stated limitation:** no real screen reader has driven this surface, and one browser was tested.
Announcement wording should be confirmed with NVDA or VoiceOver before this is called
AA-conformant.

---

## 8. Data rule

No real player data, no real identity documents, and no live production data feeds are used in the
build. Synthetic and provided-sample data only.

Production measurement used **public demo play** on `casino.psk.hr`: no login, no account, no
credentials, no player data. Probes emit filenames and aggregate byte counts, never URLs with
query strings, headers, or cookies. The provider bundle is held in ignored private storage and is
never committed or redistributed.

---

## 9. Honest open items

- Exclusion-register latency: **UNKNOWN**, and deliberately not estimated.
- Real-screen-reader verification: not done.
- Whether speculative prefetch clears Art. 5(3) with a toggle alone, or requires explicit prior
  consent, is a **legal question we have flagged rather than answered**. We built the stricter
  option — user control plus conservative defaults plus fail-closed — but a compliance review
  should settle it before launch.
- Cross-provider generalisation: one provider tested.
