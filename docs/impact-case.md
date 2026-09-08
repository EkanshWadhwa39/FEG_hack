# D3 impact case — bounded pre-launch preparation

## Decision and problem

Vault asks a narrow, useful question: **can eligible static work be moved before selection, using ordinary browser caching, without changing user choice or bypassing authorization — and is the speculative cost worth it?** FEG Challenge 3 concerns waiting around game launch. This sandbox evaluates a local technical mechanism, not a revenue intervention or production rollout.

The current integration offers twenty **SIMULATED identities of one supplied Empire of Gold build**. Real early assets are fetched by the lobby; the selected unchanged provider document may reuse those exact responses. It is not twenty provider integrations. Predictors influence requests only; fixed visible choices and mandatory authorization remain unchanged.

**Draft; current performance and business verdict: UNKNOWN.** The task briefing reports a ten-pair serial browser benchmark in progress (SIMULATED experimental design, not ten completed pairs). Results belong exclusively in the lead-owned [EMPIRE-MEASUREMENT.md](EMPIRE-MEASUREMENT.md), which records completed checks and the in-progress benchmark. No timing gain, transfer reduction, hit rate, conversion improvement, revenue uplift, return on investment or accepted provider input is asserted here. Automated QA and unit tests do not answer those questions.

## Evidence boundary

| Input / claim | Classification and allowed use |
|---|---|
| Challenge's load-time problem and supplied Empire resource | FEG-PROVIDED context; not our causal result |
| Fixed catalogue, policy, browsing schedule, authorization and budget | SIMULATED fixtures/configuration |
| Eight PRELOADER / partial COMMON assets, 523,940 decoded bytes per identity | STATICALLY-INFERRED manifest inventory; not measured network savings |
| Actual integrated cache reuse and early-response timing | UNKNOWN pending isolated proof and the lead's report |
| Actual provider tier, gameplay input and time-to-play | UNKNOWN; early responses/canvas are weaker, separate milestones |
| Real-user conversion, profitability, provider/CDN traffic, energy and responsible-gambling outcomes | UNKNOWN; require separately approved deployment studies |
| Historical cold/repeat HARs or reference-scene benchmarks | Different experiments/milestones; not imported as Empire effects |

The scope is sandbox-only judging. No staging access or production traffic is needed to complete the hackathon experiment. Real-site proof remains necessary before any real player-facing enablement.

## What would count as useful impact?

1. Exact resources prepared by the lobby before click are reused by the unchanged provider document, corroborated by browser cache attribution and server body counters.
2. The **same preregistered early-resource milestone** is measured in both arms. Timings, including regressions and incomplete runs, are retained. It is not labelled interactive or gameplay-ready.
3. The report presents selected-launch benefit **alongside preparation and observation-period costs**, with realistic wrong-title misses and no synthetic treatment-only waiting advantage.
4. No authorization bypass, unintended visible recommendation, uncontrolled speculation or foreground regression is hidden by a favourable byte figure.
5. A technically competent, authorised reviewer can reproduce the result using the documented pinned archive and isolation path.

Technical success can be cache reuse with negligible or negative timing change. In that case the honest outcome is “mechanism works here; no demonstrated speed benefit under these conditions,” not a speedup headline.

## Cost accounting — definitions, not results

Use the same counter scope and observation boundaries in both arms. Define `P` as provider response-body bytes before the pre-dispatch snapshot; `L` as provider response-body bytes from that snapshot to the independent final sample. Then:

- `P = P_selected + P_unselected`; `L = L_selected + L_unselected`.
- `B_observed = P + L` for each arm; `incremental observed body cost = B_treatment − B_control`.
- `selected-window body reduction = L_selected,control − L_selected,treatment`; this is **not** an exact click-separated or total-byte saving.
- `paired early-milestone difference = t_control − t_treatment`; positive means earlier in treatment, negative means a regression. Report only timing-valid, proof-qualified statistics alongside all attempted/excluded pairs.

These are accounting definitions (STATICALLY-INFERRED from the documented counters), not measured values. Pre-snapshot provider traffic may be attributed to preparation only when request provenance supports it. Include partial/cancelled sends; do not equate reservation bytes, consumed-body bytes and server socket-accepted bytes or add these overlapping counters. Preparation not reused within the selected observation is unused **for that selection**, not necessarily wasted forever. Report unselected preparation separately; selected preparation may also fail to be reused. Missing reuse attribution stays UNKNOWN.

Counters exclude headers and lobby/wrapper/covers and end at a bounded sample; report the snapshot/click gap and sample overrun. Thus `B_observed` is observed provider body cost, **not total page/session wire traffic**. There is no total-byte saving claim.

## Cost model — not an experiment result

Let **S = 523,940 bytes** (STATICALLY-INFERRED decoded body size of the exact eight-resource subset). Let **k** be distinct fully prepared candidate identities. Under an **idealised SIMULATED one-selection scenario** with equal body sizes, cacheable identity delivery, complete preparation, no eviction/revalidation/duplicate attempts, one prepared title selected and all other traffic held equal:

| Quantity | Scenario formula | If k = 3 (SIMULATED illustration) |
|---|---:|---:|
| Preparation body cost | k × S | 1,571,820 bytes |
| Selected early-body work potentially moved before click | S | 523,940 bytes |
| Preparation unused within that single selection | (k − 1) × S | 1,047,880 bytes |
| Early-body session cost, control | S | 523,940 bytes |
| Early-body session cost, perfect-hit treatment | k × S | 1,571,820 bytes |
| Additional session body cost, perfect hit | (k − 1) × S | 1,047,880 bytes |
| Additional session body cost, wrong-title miss | k × S | 1,571,820 bytes |

These are arithmetic examples, **not observed prepared objects, transferred bytes or savings**. They exclude headers, HTML, bootstrap, later provider assets, covers, cancellation tails and other page traffic. Decoded-body sizes are not generally wire bytes; the current local server deliberately uses identity encoding, unlike an unknown production CDN. The example demonstrates why a selected-launch transfer reduction is not a total-bandwidth reduction.

For a planning horizon, define unknown quantities:

- **Q:** eligible selection opportunities (real traffic volume UNKNOWN).
- **h:** probability that the selected identity is among the prepared candidates (real prediction accuracy UNKNOWN).
- **r:** probability that exact completed preparation is actually reused under the deployment's browser/cache/request semantics (production reuse UNKNOWN).
- **W:** total speculative body/network cost under a clearly stated measurement definition, including unsuccessful/unselected work.
- **Δt:** paired milestone difference under identical conditions; it can be zero or negative and remains UNKNOWN for this integration until measured.

A simplified **SIMULATED planning model** is `expected early body work moved before click = Q × h × r × S`; with all other traffic held constant, incremental total body cost is approximately `W − Q × h × r × S`. This is not a production traffic forecast. Candidate hit probability and reuse probability are different; completed fetches alone establish neither. Multiple selections, eviction, cancellation and shared assets require explicit modelling rather than silently reusing the one-selection scenario.

## Economics and delivery cost

No price, traffic volume, staffing estimate or monetisation coefficient is supplied or verified. Keep each as **UNKNOWN**, not zero:

| Cost/value input | What must be obtained |
|---|---|
| Engineering and maintenance | Approved estimate for manifest release validation, provider integration, security/compliance and browser support |
| Infrastructure / egress | Applicable hosting/CDN tariffs and actual incremental transfer in the approved environment |
| User data/CPU/battery | Governed real-device measurements; localhost/SwiftShader cannot establish these |
| Reviewer operations | Private artifact distribution, suitable Linux/display environment, privileged namespace setup and repeated validation effort |
| User value | Observed reduction in relevant waiting, failure rate and accessible task completion; not inferred from bytes alone |
| Commercial effect | Approved, controlled causal evidence; no conversion/revenue claim from synthetic journeys |
| Responsible-gambling cost/risk | Independent review of limit adherence, unintended faster wagering, misleading states or increased time-on-device |

A future decision model can use `net value = validated user/operational benefit − incremental egress − engineering/maintenance − safety/compliance cost`, all in an agreed time horizon and units. Until those terms are supplied, ROI/payback is **UNKNOWN**. Faster wagering or increased session duration is **not** assumed to be a desirable benefit.

## Counter-metrics and stop conditions

- Show preparation bytes, selected/unselected preparation, cancelled/reserved bytes, observed provider-session body cost, failures and wrong-title misses. “Unused in this selection” is not “wasted forever.”
- Label server counters precisely: socket-accepted body bytes, not packet-level traffic; `launch`/`selectedLaunch` span the pre-dispatch snapshot to sample, not an exact click boundary. Report sampling gaps/overruns.
- Measure foreground contention and cancellation/drain delay; small load savings do not justify blocking the selected game on speculation.
- Keep explicit opt-in, fail-closed authorization and conservative missing-capability behavior. SIMULATED configuration: maximum two speculative requests and a 10 MiB per-visit reservation budget. The budget does not cap the unchanged foreground provider's downloads.
- Retain no-store and wrong-title negative controls; fail the reuse claim if attribution does not discriminate them correctly.
- Never alter player-visible order/style/focus based on candidate rank. Never infer accepted input from a canvas, iframe load, wrapper acknowledgement or response batch.
- Stop any real-site rollout on authorization, consent, confidentiality or provider-permission gaps, even if the local cache proof passes.

## Validation and next decision

The experiment must report browser/version, one provider/archive digest, English desktop manifest scope versus actual tier uncertainty, serial pair count/order, equal browsing interval, unthrottled local environment, timing tolerances, exact milestone and all unsuccessful runs. Medians/ranges of qualified pairs must include the qualification count and cannot stand in for the complete attempted sample. No treatment-only slowdown or cherry-picking.

After the lead's report, the team can decide whether the narrow local result warrants a future approved integration. Production deployment additionally needs real authorization, manifest/locale/tier confirmation, cache/CORS/credential/partition validation, an authoritative input milestone, legal/provider permissions and user/safety outcomes. The separate original Vault Match fallback cannot satisfy those Empire gates.

This D3 document provides a cost/value framework and explicit missing inputs, **not a completed financial case or submission sign-off**. The current root-workspace audit, synchronised into this checkout as the [audit gate](PRE-SUBMISSION-AUDIT.md), controls freeze; its historical baseline is not final acceptance. The organiser DOCX remains authoritative; any further Challenge Ideas D3 rubric details must be confirmed by the team before freeze. See [compliance](compliance-note.md), [dependencies/permissions](dependencies.md) and [submission status](EMPIRE-SUBMISSION-STATUS.md).
