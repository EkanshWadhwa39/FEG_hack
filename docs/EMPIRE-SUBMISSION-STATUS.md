# Empire integration — submission status and remaining blockers

**NOT FROZEN / NOT SUBMISSION-READY.** This is a documentation snapshot, not acceptance, merge/push permission or permission to distribute restricted resources.

## Authority, identity and evidence labels

The current root-workspace audit, synchronised into this checkout as [PRE-SUBMISSION-AUDIT.md](PRE-SUBMISSION-AUDIT.md), remains the audit gate. Apply it to the **intended final commit**. Its `7fe320d` baseline is historical, not final evidence; neither that baseline nor the integration's audit copy clears today's blockers. The organiser Repository Structure and Submission Guidelines DOCX remains authoritative and must be checked by the lead; no DOCX/archive/raw-resource read was performed in this pass. The synchronised checklist is delivered locally; recheck it against the authoritative organiser terms at freeze.

**STATICALLY-INFERRED identity from the task briefing:** separate `integration/empire-catalogue`, dirty base `fc058cd66960c45c31fdb113a9d3c75c106147c1`. This identifies the reported base, not the benchmark's exact source or a frozen submission. Main, Hansika, Parth and content-core branches are outside this documentation task. No explicit merge/push authorization or frozen commit exists in the supplied context.

| Team assignment (STATICALLY-INFERRED from supplied brief and FINAL-PLAN) | Member |
|---|---|
| A | Ekansh |
| B | Hansika |
| C | Parth |
| D | Shaurya |

Actual team name, formally designated Team Lead, repository ownership/control, designated reviewer accounts and tested access are **UNKNOWN**. Workstream A is not proof of formal lead designation.

Classification contract: **MEASURED** requires an attributed observation; **FEG-PROVIDED** identifies supplied context/resources; **STATICALLY-INFERRED** identifies source/document inspection; **SIMULATED** identifies fixtures/configuration; **UNKNOWN** means unresolved or unverified. Workflow descriptions below are from the supplied briefing/documents, not independently rerun acceptance.

## What exists, and what it does not prove

| Item | Current status / boundary |
|---|---|
| Integration README, reviewer guide and architecture | STATICALLY-INFERRED: drafts/instructions exist. Final consistency, executable reviewer acceptance and organiser-rubric acceptance remain UNKNOWN |
| Impact, compliance, dependencies and this status note | STATICALLY-INFERRED: documentation drafts supplied/revised in this pass, not missing-file blockers anymore. Content approval, rights clearance and final-commit acceptance remain UNKNOWN |
| Automated headed QA | MEASURED **as reported in the task briefing**, not independently rerun: five scenarios passed under Xvfb. Not human visual or screen-reader acceptance |
| Expanded unit suite | MEASURED by the integration lead: 458 Python + 584 JavaScript passed, including lint/syntax/shell checks; see the measurement report. This is a working-tree run, not final-commit/clean-clone acceptance |
| Serial browser benchmark | SIMULATED experimental design: ten counterbalanced CONTROL/TREATMENT pairs. Reported in progress; completion, qualifying counts, results and verdict UNKNOWN |
| Measurement report | Lead-owned [EMPIRE-MEASUREMENT.md](EMPIRE-MEASUREMENT.md) exists with completed checks, retained failures and in-progress benchmark status; final benchmark verdict remains UNKNOWN |
| Provider state | UNKNOWN actual provider-selected tier and authoritative accepted input. Early-resource completion, canvas and wrapper states are not interactive/gameplay-ready |
| Sandbox scope | SIMULATED candidates, catalogue identities and authorization; one FEG-PROVIDED build. Not a real exclusion decision, distinct provider integrations or real-user accuracy |

No historical HAR, parent-to-iframe diagnostic, Vault Match benchmark or prior suite result is substituted for this integration's performance. No speedup, total-byte saving, conversion or revenue result is asserted.

## Blocking outstanding work

These rows record outstanding **decisions/evidence**, not unchecked copies of already-created files. Closure must be supported against the final source; no row is accepted by this draft. The root audit permits documented Team Lead dispositions where applicable, but cannot waive organiser rules, confidentiality or resource rights.

| Gate | Outstanding requirement / closure evidence | Accountable next action |
|---|---|---|
| Serial measurement | Finish the currently owned experiment without parallel browser work. Preserve every attempted pair, failure/exclusion and required diagnostic; validate timing/proof qualification and source identity | Current benchmark owner / lead |
| Evidence report and claim scope | Publish lead-reviewed EMPIRE-MEASUREMENT with browser/build/digest, exact milestone, device/locale/tier uncertainty, conditions, counts, paired statistics and artifact provenance. Retain null/negative outcomes | Lead / evidence owner |
| Cost accounting | Report preparation, selected/unselected work, cancellations, bounded observation body costs and unused-within-selection bytes. Identify server socket-accepted bodies, excluded traffic and pre-dispatch/sample boundaries; no total-byte saving claim | Lead; use [impact case](impact-case.md) formulas |
| Suite and safety acceptance | Expanded working-tree suite/lint/syntax/shell checks passed; repeat against the intended final source and complete required live confinement/failure/revocation/cancellation diagnostics. Mocked checks or headed QA alone do not close final live-path acceptance | Integration and QA owners |
| Human review | Perform human visual, keyboard, focus/dialog, status-announcement, contrast, reduced-motion and screen-reader review on declared supported environments. Record limitations separately for wrapper/provider | QA owner / authorised human reviewer |
| Milestone/package/tier limitations | Preserve unchanged provider and explicit missing-dependency limitations. Keep provider input/tier UNKNOWN unless separately validated. Accept an explicitly scoped early-asset claim rather than invent gameplay; no provider repair | Integration/evidence owners and formal lead |
| Mandatory D3/D4/document acceptance | Review README, architecture, impact, compliance, dependencies and status against organiser requirements and actual final implementation. Complete cost/value assumptions, requirement mapping and assistance disclosure; drafts alone do not meet the gate | Formal lead once designated |
| README completeness | Verify team/challenge/title, problem, innovation, journey/features, stack, supported versions/prerequisites, install/configuration, run/test/demo, limitations, document links and `prototype/` source map/private-input exclusions. Test instructions rather than merely noting headings | Documentation/reviewer owner |
| Historical consistency | CODE/FINAL-PLAN have been reconciled with current root direction; complete review of remaining older docs, marking obsolete native/SW/custom-cache/key-normalisation/staging-first proposals. Do not import historical performance or state weaker milestones as interactive | Lead / document owners |
| Team and ownership | Confirm team name, members, formal Team Lead, repository owner and private team control through judging | Team / organiser |
| Rights and software disclosure | Complete pinned/transitive/browser/OS licence/notice inventory; establish provider, data, fonts/media/templates and derived disclosure permissions. Confirm project ownership/licensing and restricted-resource execution/reviewer transfer rights | Team / rights owner |
| AI input/output permissions | Record material tools/models/tasks, permitted inputs, historical exposure review and written permissions/processing conditions as required. Resolve suspected unauthorised disclosure with the designated security contact; do not assert approval | Team / organiser/security contact |
| Token-shaped historical value | Resolve root audit warning for `Context/empireofgold-bundle-analysis.md`: redact as required, determine sensitivity/activity and whether history remediation is needed. Do not reproduce the value | Security owner |
| Private provider release | Confirm written permission for the private provider-bundle release or arrange approved team transfer and deletion of the draft release as required by root audit. Never publish/attach the archive | Rights/security owner |
| Secrets and prohibited resources | Deliberate intended-tree **and Git-history** scan; confirm no raw HARs, player-level data, datasets, media, provider bundles, credentials or prohibited attachments. Review endpoints, authentication details, bundle findings and FEG metrics for disclosure rights | Security owner |
| Redaction and presentation | Review every derived export, screenshot, deck/video and demo narrative for identifiers, credential-bearing URLs, restricted content and evidence labels before sharing. Redacted/body-omitted is not automatically authorised | Evidence/security owners |
| Demo deliverables | Supply required authorised video, screenshots and presentation links under `demo/`; demonstrate failure recovery and honest states. Existing historical presentation is not final acceptance | Demo owner / lead |
| Reviewer source access | Confirm designated T-Hub/FEG read-level least-privilege access and actually test clone access; preserve repository privacy. Confirm approved alternative before deadline if necessary | Formal lead / organiser |
| Private runtime delivery | Establish authorised secure delivery of the pinned ZIP separately from Git, plus reviewer Linux/namespace privileges and display prerequisites. No public hosting/tunnel/ordinary-browser workaround; reference demo cannot close Empire access | Lead / reviewer administrator |
| Clean-clone reproducibility | Clone intended final commit; follow README only; bootstrap/check, HAR help and prescribed serve/demo checks. Document private prerequisites instead of committing raw inputs. Validate supported Empire flow only inside confinement | Reproduction owner |
| Freeze and submission | Obtain explicit integration/merge/push decisions; record exact final hash after review, retain internal frozen copy, complete external form/email and required declarations. No material post-deadline change without organiser approval | Formal lead / authorised repository owner |

Actual provider accepted input/tier and production outcomes may remain prominently UNKNOWN for an honestly scoped sandbox early-asset submission; they cannot be silently checked off as validated. Missing permissions, reviewer access and mandatory submission requirements cannot be solved by weakening the claim.

## Final freeze sequence — still outstanding

The designated lead must apply every blocking root-audit item to the intended final commit, not to the dirty base:

- Reconcile the final source, documentation, evidence and permissions; approve explicit dispositions and any merge/push separately.
- In a clean authorised checkout, follow only the README; run `./scripts/bootstrap.sh`, `./scripts/check.sh`, `.venv/bin/python tools/measure_har.py --help`, and the root audit's `./scripts/serve.sh`/core demo checks. The generic serve check is **not** authorisation to serve Empire directly; its end-to-end review uses only the confined launchers.
- Verify dependencies/configuration, rights/disclosures, human acceptance, final secret/prohibited-data/history review, approved archive delivery and actual reviewer access.
- Record the exact final hash in the form/email and internally, keep a frozen copy and submit required declarations. Preserve the freeze after deadline unless organisers authorise a change.

Future actual FEG rollout additionally needs real authorization/exclusion semantics, exact production URL/request/cache/CORS/partition validation, observed locale/tier, authoritative input readiness and safety/business studies. **Staging is not a sandbox judging prerequisite; production traffic is not a shortcut.**

## Documentation-pass scope

Only `impact-case.md`, `compliance-note.md`, `dependencies.md` and `EMPIRE-SUBMISSION-STATUS.md` were assigned. Sources reviewed: current root `CODE.md`, `Context/FINAL-PLAN.md`, `README.md`, `docs/PRE-SUBMISSION-AUDIT.md`; integration `README.md`, `docs/EMPIRE-REVIEWER-GUIDE.md`, `docs/architecture.md`, pre-existing impact/compliance drafts; pinned npm/Python manifests and installed package metadata. No test, browser/server, raw evidence/media/data/archive read, repository/history scan, commit, push or freeze was performed by this pass. Final authority/permissions and empirical acceptance remain with their designated owners.
