# Final product plan — sandbox-only evaluation

## 1. Decision and status

**Latest team brief:** judges will run and evaluate our sandbox. Staging is not a testing dependency or evaluation environment. This supersedes the earlier plan to wait for staging before demonstrating an end-to-end causal result.

**This document is the delivery plan, not a claim that the redesigned product already exists.** The current page remains the simulated governor dashboard. The existing real cache requester, warmer, manifest resolver, sandbox authorization boundary, HAR tool and local cache-reuse evidence are reusable foundations.

**Product proposition:** prepare one likely next title while the user is browsing, then demonstrate a faster intended launch, bounded speculative cost and safe fallback in a reproducible sandbox.

The sandbox can produce **MEASURED local causal evidence**. It cannot establish FEG production compatibility, actual revenue growth, or cross-provider coverage. A future real-site rollout retains its own authorization, privacy, manifest, CORS/cache and input-readiness validation gates; those are not hackathon evaluation prerequisites.

### What stays non-negotiable

Web/mobile web only; existing browser HTTP cache; no service worker/custom cache; no provider-code modification; no speculative SECONDARY; exact URL/locale/tier; maximum two speculative requests; authorization fails closed; neutral player UI; no raw data or credentials in the repository; no `interactive` claim without a validated input-accepted event.

Synthetic authorization is a labelled integration fixture, not a fake reality check or an assertion of real register compliance.

## 2. What changed

| Earlier direction | Revised evaluated product |
|---|---|
| Small controls dashboard, future staging integration | Complete sandbox lobby, launch journey and evidence console |
| Fixed synthetic manifest | Stable virtual catalogue, exact manifests and selectable policies |
| Mechanism diagnostic disconnected from UI | Real browser requests initiated by lobby behavior |
| Staging required for next causal test | Local isolated CONTROL/TREATMENT is the judged test |
| Historical HAR opportunity dominates pitch | New sandbox experiment is the main result; history is context |
| Business growth implied from lower transfer | Explicit model connecting measured experience to conditional opportunity |
| Full provider game assumed available | Package completeness checked; labelled fallback prevents demo dead end |

### Integration blockers found in the current source review

These are STATICALLY-INFERRED code findings, not fixes already made in this planning task:

- `sandbox.js` forces `enabled: true` when it calls the governor. Propagate explicit user consent and test disablement/revocation before enabling real requests.
- `browser-requester.js` resolves after `fetch()` headers without draining the response body. Current task concurrency and success summaries therefore do not establish two simultaneous full transfers or completed cache preparation. Use bounded CORS-readable body consumption with cancellation and byte accounting; opaque responses must not be called completed warm objects without independent completion evidence.
- The requester validates HTTPS and credential-like URL fields, but does **not** implement an approved-origin allowlist or redirect boundary. Add both before mounting the archive; reject redirects or validate each allowed hop without leaking a request to an unapproved origin.
- Authorization currently accepts a supplied state; it is not an asynchronous register client, timeout handler or revocation system. Add the explicitly simulated lifecycle and gate the actual launch as well as warming.
- The governor is a pure decision function, not a persistent byte ledger or live performance observer. Reserve a bounded byte budget before concurrency starts, account for failed/aborted/unknown transfer, and do not release reservations as if partial downloads cost nothing.
- HAR aggregate analysis is not a general-purpose sanitizer for arbitrary raw HAR publication. Keep originals private and publish only reviewed redacted artifacts.

These are G0/G1 acceptance tasks, not reasons to abandon the existing modules. Add targeted regression tests before any player-like live-request wiring.

## 3. Game feasibility gate — before promising six seconds to one

The new [local game audit](SANDBOX-GAME-AUDIT.md) read the original ZIP and ran three fresh boots. The archive contains 20 unresolved relative atlas-page references. `book.png` returned 404 in all three runs. Paint and canvas appeared early, but authoritative input readiness remains UNKNOWN. Large long tasks were observed on the headless host; a separate WebGL probe reported SwiftShader software rendering.

**Decision:** do not claim the local file takes six seconds to become playable, or promise a one-second target, until that milestone exists on a complete package and representative device.

### Deliverable modes

1. **Unchanged provider-bundle mode:** authorised private archive mounted read-only. Show the real launch attempt and exact asset evidence. Missing assets produce a truthful recoverable failure, not a permanently hidden overlay or invented ready signal. Full playable mode is enabled only if the complete package and its required local configuration are available without provider changes or live API calls.
2. **Reference-scene mode — guaranteed judged fallback:** our own non-wagering interactive scene and loader with an authoritative, validated demo input-accepted event. It supports exact asset dependencies, decoding, cancellation and the same cache-warming path. Label it `SIMULATED reference scene`, not Empire of Gold gameplay.
3. **Optional real-asset replay:** the reference loader may request an approved subset of unchanged private bundle objects to demonstrate real payload reuse. This is a measured asset-loading harness, not execution of the complete game. Opaque script bytes fetched as data do not prove JS startup savings.

A clean clone must run reference-scene mode using generated/original fixtures without private provider data. The provider archive is supplied only through an approved access path, never embedded in Git, screenshots, a public release or a general-purpose download endpoint.

**Time-box:** if the complete bundle cannot be obtained by the first feasibility gate, continue the reference scene and asset-replay proof. Do not spend the hackathon patching certified code or pretending placeholders are original assets.

## 4. The sandbox users and screens

### A. Player lobby

- Responsive, keyboard-accessible catalogue with 20 synthetic cards.
- Fixed ordering, user-controlled favourites/recents/search, no predictor-driven styling or rankings.
- Clear sandbox label, no deposits, wagering or real accounts.
- User toggle for speculative downloads; byte budget and connection status.
- Hover/focus/drawer dwell triggers preparation only after simulated authorization succeeds.
- One active candidate; replacement cancels obsolete work and respects the session budget.
- Neutral transition: checking authorization → opening → loading approved assets → precise readiness state, or recoverable error.
- Never hold a ready game behind an artificial delay or remove a transition to fake input readiness.

### B. Operator evidence console

Separate from player ordering and focus:

- CONTROL/TREATMENT, profile, fixture/build, exact variant and run ID.
- Selected candidate, actual selection, hit/miss and lead time.
- Prefetch bytes, reused objects, launch bytes, total session bytes and unused bytes.
- Actual timing events, not a decorative/synthetic waterfall passed off as network evidence.
- Failure controls: authorization deny/error/timeout, wrong candidate, no-store, version mismatch, Save-Data, hidden page, exhausted budget, aborted request and missing bundle asset.
- Side-by-side **results replay**, generated from serial isolated runs; never two live benchmark arms competing for network/CPU.

### C. Impact console

- Measured launch savings and wasted-download cost, linked to the named experiment.
- Clearly labelled scenario inputs for eligible audience, policy hit rate and possible conversion change.
- Low/base/high or zero-benefit cases with editable assumptions.
- No unmeasured revenue counter, guaranteed uplift or claim that lower transfer means more revenue.

## 5. Twenty catalogue entries without a misleading cache trick

**Adopt the idea as a synthetic catalogue, not twenty independently implemented games.** Different display names alone do not create different HTTP cache keys.

Recommended implementation:

- Store/read the provider archive only once; no twenty ZIPs or copied source trees.
- Give each synthetic fixture a stable, distinct sandbox origin or verified asset namespace.
- Prefer virtual-origin routing for the original bundle, because absolute root-relative asset paths may escape a simple path prefix. Example lab topology: `lobby.sandbox.test` plus `g01.sandbox.test` through `g20.sandbox.test`, loopback mapped, with local HTTPS and generated private certificates.
- Resolve the HTTPS/trust/bootstrap flow in the first delivery gate. A loopback-only HTTP test adapter is an alternative only if explicitly origin-allowlisted, separately tested and impossible to use for production; the existing production-shaped HTTPS requester must not be weakened globally.
- Serve identical unmodified source bytes under different stable sandbox origins. Relative/root paths resolve in the selected title origin. Do not redirect all title assets to a common origin unless running a separately labelled shared-library case.
- Use the identical target origin/path/query in a title's CONTROL and TREATMENT. Prefetch and launch must agree byte for byte on URL identity.
- Do not append random timestamps per request, rename the target only in CONTROL, disable its cache, or rotate aliases only to make the baseline slow.
- Each arm starts clean in a fresh browser process. Fresh state—not unfair URL mutation—creates the cold baseline.
- Test that warming fixture 01 does not silently warm fixture 02. A genuine shared asset has its own declared shared key and is analysed separately.

**Claim:** twenty synthetic cache-isolated catalogue entries backed by one actual provider build (or reference fixtures). **Not:** twenty provider integrations, twenty measured real titles, or catalogue-wide validation.

## 6. Selection policy and realistic misses

Implement simple explainable policies before any ML:

1. No warming — CONTROL.
2. Intent-first — sustained hover/focus/drawer dwell; initial dwell threshold is a documented SIMULATED configuration, not a proven optimum.
3. Recent/favourite candidate — explicit synthetic local session state.
4. Aggregate-popularity candidate — optional, only from approved non-identifying aggregates already supported by evidence.

Policy output never changes the player UI. Real player hashes and records never enter the browser.

Record three independent outcomes: candidate matched; exact warmed objects were actually reused; agreed readiness improved. A correct title prediction alone proves neither cache reuse nor time saved.

Use fixed seeded user journeys with genuine misses and insufficient dwell time. Do not script a predictor that always knows the next click. Report policy results as MEASURED **on SIMULATED journeys**, never FEG player prediction accuracy. Hold out journeys or seeds when comparing policies; do not tune and score on the same traces.

## 7. Fair benchmark and timing contract

### CONTROL and TREATMENT

- One automation owner; experiments serial, no competing game process.
- Same browser build, title/build, variants, scene/engine mode, hardware profile, network profile, server headers, authorization outcome/latency and user journey.
- Separate fresh browser processes/profiles. Service workers blocked in both.
- Cache enabled in both, except the separately labelled no-store negative control.
- Same browsing/dwell interval and same click anchor. Treatment cannot wait for all prefetch to finish unless the identical pre-registered journey allows that time in both arms.
- Only policy-enabled speculative requests differ in the primary comparison. Connection hints are disabled in both arms; evaluate them separately rather than confounding the prefetch result.
- Profile config and test order recorded before measurement. Counterbalance CONTROL/TREATMENT order across pairs.
- Design target: at least 10 paired repetitions per primary scenario; report each run plus median, range and paired differences. Small-sample tail statistics are exploratory, not robust p95 promises.
- Exceptions and failed runs stay in the report; incomplete milestones are UNKNOWN/failure, not silently dropped.

### Network and CPU profiles

Primary headline includes **unthrottled local delivery**, even if savings are small or zero. A second declared network-constrained profile may model plausible remote delivery, applied equally to both arms. CPU-constrained tests are separate from network-constrained tests. All injected bandwidth, latency, CPU rates and timings are labelled SIMULATED settings; observations within them are MEASURED locally.

Do not insert a six-second sleep into CONTROL. Do not use a larger file, slower server, different compression or worse rendering configuration only in CONTROL. If testing compression or server delivery improvements, use a distinct factorial/before-after experiment and do not attribute those gains to prefetch.

Cache experiments must not use broad Playwright request routing, which disables HTTP caching. Enforce outbound isolation with a restrictive server policy and a verified environment-level egress boundary that preserves cache semantics. Validate that boundary before executing provider code. HAR/replay evidence must not itself fulfil cached requests.

### Named milestones

- `click → authorization complete`: SIMULATED contract latency; never cached or overlapped by warming.
- `click → exact asset set complete`: MEASURED only if every predeclared required object completes successfully in each arm.
- `click → first paint/canvas`: diagnostic only, not readiness.
- `click → authoritative input accepted`: provider-approved event, or explicitly the reference scene's own event. Validate message origin, source iframe, run ID and one-time launch identity.
- `navigation → full capture end`: diagnostic including background traffic, not launch time.
- `prefetch start → click` and total prefetch duration: show the work moved before click rather than erased.

Cross-origin Performance Timing needs the correct Timing-Allow-Origin policy. Confirm reuse with browser cache attribution plus server/origin counters; zero transfer alone is insufficient. Keep HARs private and export redacted aggregates.

The old Savanna HAR pair remains **historical context only**: full spans 76.358/16.253 seconds; exact 16-request milestone 35.568/6.714 seconds. Neither is this sandbox's baseline or click-to-interactive result.

## 8. Optimization priorities

1. **Completeness and truthful milestones:** resolve the missing asset problem or select the reference-mode milestone first.
2. **Exact early asset set:** PRELOADER, COMMON, SPLASH; add PRIMARY only after criticality is demonstrated. Resolve actual locale/tier and dependency closures, including atlas texture pages. Never warm both tiers or SECONDARY.
3. **Real lobby-triggered cache preparation:** use existing modules, maximum concurrency two, complete response bodies where observable, cancellation and fail-closed governor.
4. **Foreground protection:** stop starting speculative requests when the selected launch begins; allow only an explicitly measured safe handoff for the same candidate. Record incomplete/raced requests rather than assuming cache admission.
5. **Connection cost:** investigate as a separately attributed experiment; loopback may offer little benefit.
6. **Delivery configuration:** investigate cache policy, compression and read-only asset serving equally across arms. Count server-side reads/decompression so they do not become hidden baseline work.
7. **CPU/decoding ceiling:** profile on representative hardware. Prefetch moves transfer; it does not inherently eliminate parsing, execution, texture decode, GPU upload, shader compilation or missing dependencies.

No provider bundle editing, image substitution, fake ready event, hidden full-game iframe pre-execution or cosmetic delay removal is an allowed prefetch optimization.

## 9. Business case: demonstrate an opportunity, not an invented uplift

The case is **less waiting for intended actions, predictable data cost, and preserved user choice**. Increased stakes, time gambling or weaker protections are not success goals.

FEG's historical 42–54% session-to-game conversion is context, not proof the remaining sessions abandoned because of loading. Stake concentration is not identical to next-title probability. Historical session-to-first-game telemetry includes browsing and cannot be substituted for click-to-ready.

### Useful formulas

Let:

- `N`: eligible-period intended launch opportunities (scenario input; FEG must confirm denominator).
- `e`: fraction with authorization, consent and device/network eligibility.
- `q`: joint probability of correct selection, sufficient lead time and usable cache reuse on the declared workload; production value UNKNOWN. Report candidate hit rate separately and do not assume these events are independent.
- `s`: measured seconds saved when preparation is useful under a named scenario.
- `m`: measured added wait otherwise, including foreground competition.
- `P`: speculative response-body bytes per eligible opportunity (wire/origin totals are separately accounted for).
- `U`: the subset of those response-body bytes demonstrably reused within a fixed observation horizon.

Then:

```text
Expected waiting seconds avoided = N × e × (q × s − (1 − q) × m)
Unused speculative body bytes    = measured prefetched body bytes − subsequently reused body bytes
Total session origin bytes       = prefetch + launch + later demand bytes
Extra transfer versus CONTROL    = treatment session bytes − control session bytes
```

Use the same response-body byte basis and declared horizon for reuse/waste, and full wire/origin ledgers for total traffic. Report aborted transfer and unknown attribution separately; a cache hit after the launch milestone does not automatically count as launch-time benefit.

A reused object often shifts transfer earlier rather than reducing whole-session traffic. Wrong predictions can increase traffic. Report both launch-path reduction and total-session cost.

**SIMULATED arithmetic example, not a forecast:** N=100,000; e=40%; q=60%; s=2 seconds; m=0 yields 13.3 hours of waiting avoided. With P=0.8 MB, full reuse on hits and no later reuse on misses, 32 GB is fetched speculatively and 12.8 GB remains unused. The 60% joint usefulness rate, zero miss penalty and distribution are assumptions here, not present results. Keep the zero-benefit/negative-net-benefit scenario visible.

For business conversion scenarios, define `Δp` explicitly as the hypothetical change in conversion probability among eligible sessions, not a measured result. `Eligible sessions × Δp` estimates extra completed intended launches only under that assumption. Default `Δp` to zero until evidence exists. Financial value per recovered session, approved infrastructure cost and engineering cost remain UNKNOWN unless supplied. Net value is conditional benefit minus implementation and extra-transfer costs; do not infer revenue from stake or multiply unrelated telemetry denominators.

Future FEG live experiments would be required for causal conversion, retention or revenue claims. That is a post-hackathon deployment question, not a blocker to sandbox acceptance.

Safety countermetrics: foreground delay, wasted data, failures, accessibility regressions, duration/stake-velocity increases and complaint/opt-out signals. The last real-user measures are UNKNOWN in a synthetic sandbox.

## 10. Named team ownership and delivery gates

Role mapping supplied by the team: **A — Ekansh; B — Hansika; C — Parth; D — Shaurya.** These are proposed workstream responsibilities, not assumptions about an organiser-designated legal Team Lead.

| Gate | Owner and owned workstream | Acceptance / handoff |
|---|---|---|
| G0: feasibility and contract | Ekansh integrates; Parth audits | Pick engine/reference mode; agree local origins, input milestone, private-archive access and immutable fixture identity |
| G1: one-title causal slice | Hansika: request/governor/manifest; Parth: runner/server/evidence | Same exact objects reused from lobby to iframe; independent counters; no-store/version negative controls; no full-catalogue UI yet |
| G2: sandbox experience | Shaurya: lobby/transition/accessibility; Ekansh: selection policy/catalogue | Intent candidate, real misses, fixed card order, bounded cost, cancellation, labelled 20-entry catalogue |
| G3: repeatable evaluation | Parth: serial experiments; Shaurya: failure rehearsal | Paired runs, machine-readable aggregates, truthful event timing, no-cache-contamination and deny/timeout/asset-failure recovery |
| G4: impact and pitch | Ekansh: business model/pitch; all review | Measured vs simulated separated; total cost reported; no forecast dressed as measured uplift |
| G5: reviewer-ready freeze | Ekansh coordinates; all sign off | Clean-clone start, full checks, dependency/disclosure docs, authorised reviewer access, presentation/video and audit completed |

One person owns a file at a time. Handoffs list changed files, test commands/results, remaining risks and next action. Agree ownership transfer before touching another workstream. Do not parallelize browser/cache experiments. Integration is gated by code review; polished cards do not substitute for G1.

## 11. Final judged package

Planned, not yet completed:

- One documented startup command for the sandbox and reference fixtures.
- Optional read-only provider archive mount with explicit missing-file report and restricted access.
- Responsive lobby and neutral launch flow.
- Real request-driven prefetch, explainable candidate policy and live operator telemetry.
- Reproducible serial benchmark command; clearly separated reference-scene and provider-object results.
- Redacted paired evidence and aggregate report tied to fixture/build/browser/commit.
- Business-impact calculator with zero-benefit and wasted-byte scenarios.
- `docs/architecture.md`, `docs/impact-case.md`, `docs/compliance-note.md`, `docs/dependencies.md`, complete README and AI-assistance disclosure.
- Named team, deck, short demo video and reviewer instructions.
- Completed `docs/PRE-SUBMISSION-AUDIT.md`; no raw provider resources or sensitive evidence committed.

### Short demo sequence

1. Explain that the catalogue and authorization service are sandbox fixtures.
2. Select a recorded scenario, show CONTROL and TREATMENT results from isolated runs, and identify the exact milestone.
3. Rehearse a live browsing/launch journey: candidate prepared, actual choice matched, normal launch path, measured evidence.
4. Choose another card: show a miss and the unused-byte cost rather than hiding it.
5. Deny authorization: show neither warming nor launch. Separately reduce the byte budget: show no warming but preserve the normal authorized launch.
6. Open the impact panel: explain waiting saved, assumptions, cost and why production revenue remains UNKNOWN.
7. Show the unchanged bundle mode's status separately; never relabel reference-scene readiness as Empire of Gold readiness.

### Acceptance standard

The final product succeeds when a reviewer can reproduce a bounded, safe, locally causal improvement at the predeclared milestone, see negative/miss cases and total data cost, and distinguish actual observations from simulated conditions. If local unthrottled performance is unchanged or worse, report it. The case may then be reduced transfer on constrained profiles—not an invented universal speedup.

## Next implementation action

Approve this revised direction, select the guaranteed reference mode alongside the unchanged provider mode, then implement G0/G1 before expanding the catalogue. The current planning task adds the feasibility probe and documents; it does not silently replace the existing page with a completed new product.
