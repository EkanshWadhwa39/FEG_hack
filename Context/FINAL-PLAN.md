# Final plan — sandbox-only judged product

## Current authority and changed brief

The latest team brief says judges will test **our sandbox only**, not staging. Staging is not a hackathon development, testing or acceptance dependency. This supersedes the former staging-first evaluation plan.

Read [CODE.md](../CODE.md) for hard constraints, then [the sandbox final-product plan](../docs/SANDBOX-FINAL-PRODUCT-PLAN.md) for the current implementation sequence, fair benchmark, business model and team ownership.

The organiser repository/submission DOCX remains authoritative for submission format, permissions and access. A changed runtime target does not waive its requirements.

## Mission

Build a complete web sandbox that demonstrates governed preparation of exact static resources before selection and measures whether the normal selected iframe reuses the browser HTTP cache. Show both launch-path benefit and total-session speculative cost. Keep user choice and mandatory authorization unchanged.

## Scope

- Browser/mobile web only; no native interception, service worker or custom cache.
- No modification of certified/provider code or raw resources.
- Exact locale, tier, URL and version identity; no query stripping or cache-key normalization.
- PRELOADER, COMMON, SPLASH and only a proven critical PRIMARY subset; never SECONDARY.
- Authorization allow is required before warming; denial/error/timeout/malformed states fail closed.
- Predictor output changes cache requests only, never player ordering, style or focus.
- `interactive` requires a validated input-accepted event belonging to the selected mode and launch.
- Measurements remain scoped to browser, title/build, provider/fixture, environment and run count.

## Evidence and package feasibility

| Result | Status and boundary |
|---|---|
| Historical Savanna final 16-request batch: 35.568s / 6.714s | MEASURED cold/repeat, capture-relative; not prototype causality or input readiness |
| Local parent-to-iframe reuse of one Empire of Gold object | MEASURED in Chromium 136, two runs per arm; not a full-title result |
| Fresh original-bundle audit | STATICALLY-INFERRED: 20 unresolved relative atlas pages; MEASURED: book image 404 in three boots |
| Six-second playable local baseline | UNKNOWN; no authoritative input milestone established |
| Integrated new sandbox causal result | Pending implementation and paired measurement |
| Production conversion/revenue impact | UNKNOWN; scenario model only |

See [game audit](../docs/SANDBOX-GAME-AUDIT.md), [local cache proof](../docs/LOCAL-CACHE-REUSE.md) and [HAR milestone](../docs/HAR-MILESTONE.md).

## Revised product

1. Fixed-order responsive lobby with twenty explicitly **synthetic** catalogue entries; one source build can be exposed under stable distinct sandbox origins, not repeatedly copied or randomly renamed.
2. Real lobby-triggered preparation through existing resolver, requester, governor and warmer modules.
3. Unchanged private provider-bundle mode with visible dependency failure, plus a guaranteed labelled non-wagering reference scene if the complete game package is unavailable.
4. Separate operator evidence view: candidate hits/misses, exact reuse, milestone, launch bytes, total-session bytes and unused bytes.
5. Isolated serial CONTROL/TREATMENT runner with equivalent browsing intervals, cache enabled, immutable identities and negative controls.
6. Business model connecting measured waiting/cost to explicit assumptions; no invented conversion or financial uplift.

The reference scene's accepted input is not Empire of Gold gameplay. A real-asset replay is not full-engine startup. These boundaries must remain visible in the demo and report.

## Team and sequence

| Member | Proposed ownership |
|---|---|
| A — Ekansh | Integration, policy/catalogue, business model and pitch |
| B — Hansika | Manifest, request adapter, warmer and governor |
| C — Parth | Local serving, package audit, serial experiments and evidence |
| D — Shaurya | Lobby, transitions, accessibility and demo QA |

Gate order: feasibility/milestone → one-title causal slice → catalogue/policy/UX → repeated evidence/failure QA → impact/deck → reviewer-ready freeze. No simultaneous cache experiments and no overlapping file ownership.

## What remains a future deployment gate

Before any actual FEG player-facing rollout, validate approved real URLs, request semantics, authorization and exclusion behavior, cache/CORS/partition policy, authoritative input readiness and real-user safety/business outcomes. Local sandbox tests cannot satisfy those real-environment claims. No production traffic is an acceptable shortcut.

## Submission package and honest headline

Follow [PRE-SUBMISSION-AUDIT.md](../docs/PRE-SUBMISSION-AUDIT.md): reviewer guide, architecture, impact case, compliance note, dependencies/permissions/AI disclosure, team/access, deck/video, clean-clone reproduction and frozen commit review.

> We have proved the browser mechanism locally. We are now turning it into a complete sandbox experiment: prepare a likely candidate before click, measure the actual launch benefit, and show the cost when the prediction is wrong. We do not yet claim a six-to-one-second game launch, twenty provider integrations or real revenue uplift.

## Historical Context documents

`message.txt` and the bundle analysis retain historical rationale and evidence. The native-SDK strategy remains background only; **do not revive its interception or cache-key-normalization proposal**. Earlier proposed submission-file inventories, unsupported conversion targets and staging-dependent demo instructions are not the current delivery contract.
