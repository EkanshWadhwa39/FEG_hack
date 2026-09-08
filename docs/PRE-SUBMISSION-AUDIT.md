# Pre-submission audit gate

Audit baseline: commit `7fe320d`

Authoritative source: [`FEG Hackathon 2026 Repository Structure and Submission Guidelines.docx`](../FEG%20Hackathon%202026%20Repository%20Structure%20and%20Submission%20Guidelines.docx)

**Use this document before sharing or freezing the final submission. Do not submit until every blocking item is resolved or explicitly accepted by the Team Lead.** The organiser-provided DOCX remains authoritative if this note differs.

## Current result

At the audit baseline, the repository was **not submission-ready**:

- 3 of 14 mandatory checklist items were verified complete.
- 9 were incomplete or unsafe.
- 2 required external confirmation.

The code was reproducible in a clean clone on the tested Linux host, but the mandatory submission documents, reviewer guide, disclosure review, and final access/freeze steps were incomplete.

## Blocking work

- [ ] Create `docs/impact-case.md` with D3 impact and cost-value analysis.
- [ ] Create `docs/compliance-note.md` with D4 requirements and implementation choices.
- [ ] Create `docs/architecture.md` using only the current web-only architecture.
- [ ] Create `docs/dependencies.md` covering libraries, licences, APIs, datasets, provider resources, templates, permissions, and material AI/code assistance.
- [ ] Rewrite `README.md` as the complete reviewer guide required by the DOCX.
- [ ] Add team name, members, Team Lead, and repository ownership information.
- [ ] Add the required AI/code-assistance disclosure.
- [ ] Add or link the required demo video, screenshots, and presentation material under `demo/`.
- [ ] Confirm that the designated T-Hub/FEG reviewer has tested, least-privilege access.
- [ ] Complete the external submission form/email and required declarations.

## Security and disclosure gate

- [ ] Redact the token-shaped fallback value in `Context/empireofgold-bundle-analysis.md`; confirm whether it is inactive/non-sensitive and assess whether Git-history remediation is required.
- [ ] Review all committed provider endpoints, authentication details, bundle findings, and FEG-derived metrics for permission to disclose to reviewers.
- [ ] Confirm written permission for the private provider-bundle GitHub release or delete the draft release after approved team transfer. Never publish it or include it in the submission.
- [ ] Run a deliberate repository and history secret scan.
- [ ] Confirm that no raw HARs, player-level data, datasets, media, provider bundles, credentials, or other prohibited material are tracked or attached to the submission.
- [ ] Confirm that all third-party software, data, and resources are authorised and their licences/permissions are disclosed.

## Truthfulness and consistency gate

Review, correct, clearly mark obsolete, or remove internal documents that conflict with the current implementation and evidence:

- [ ] Do not submit native interception, service-worker, custom-cache, or cache-key-normalisation proposals as the implemented architecture.
- [ ] Never recommend stripping, reordering, or normalising version query strings.
- [ ] State the updated sandbox-only judging target. Do not imply staging testing occurred; future real-site validation is a deployment gate, not a judging dependency.
- [ ] Do not claim the local parent-to-iframe cache diagnostic proves staging or production behavior.
- [ ] Do not describe the historical cold/repeat HAR comparison as causal proof of proactive warming.
- [ ] Scope claims to the tested browser, title, provider, and run count.
- [ ] Label synthetic fixtures/authorization/journeys `SIMULATED`. Mark actual controlled sandbox measurements `MEASURED` only within their tested scope; never imply production or full-provider-game validation.
- [ ] Do not say `interactive` without an authoritative input-accepted signal.
- [ ] Label every number and state as `MEASURED`, `FEG-PROVIDED`, `STATICALLY-INFERRED`, `SIMULATED`, or `UNKNOWN`.

Files requiring particular review include:

- `CODE.md`
- `Context/message.txt`
- `Context/challenge3-strategic-analysis.md`
- `Context/empireofgold-bundle-analysis.md`
- `Context/FINAL-PLAN.md`

## README acceptance checklist

The final README must contain all of the following:

- [ ] Team name, challenge, and solution title.
- [ ] Problem statement.
- [ ] Solution overview and key innovation.
- [ ] Key features and user journey.
- [ ] Technology stack.
- [ ] System requirements, supported versions, and prerequisites such as ShellCheck.
- [ ] Installation and setup.
- [ ] Environment/configuration instructions, including an explicit statement if none are needed.
- [ ] How to run the prototype.
- [ ] How to test and validate it.
- [ ] Complete demo flow.
- [ ] Known limitations, assumptions, and future improvements.
- [ ] Links to architecture, impact case, compliance note, and dependency disclosure.
- [ ] Explanation of the `prototype/` source layout and which ignored evidence/data files are not supplied to reviewers.

## Final freeze procedure

1. [ ] Clone the intended final commit into a clean environment.
2. [ ] Follow only the README and confirm no undocumented local files are needed.
3. [ ] Run `./scripts/bootstrap.sh` and `./scripts/check.sh`.
4. [ ] Run `.venv/bin/python tools/measure_har.py --help`.
5. [ ] Run `./scripts/serve.sh` and complete the documented core demo flow.
6. [ ] Verify dependencies, configuration, licences, permissions, and disclosures.
7. [ ] Perform the final secret/prohibited-data and Git-history review.
8. [ ] Test designated reviewer access.
9. [ ] Record the exact final commit hash in the submission form/email and internally.
10. [ ] Keep an internal copy of the frozen state.
11. [ ] Do not materially modify the submission after the deadline without organiser approval.

## Already verified at the audit baseline

- [x] Repository was private.
- [x] Working source/prototype was present.
- [x] Dependency versions were pinned.
- [x] Raw `.har`, `.csv`, `.xlsx`, `.zip`, `.mp4`, and `.env` files were not found in Git history.
- [x] A clean clone bootstrapped and passed 19 Python tests, 23 JavaScript tests, lint, syntax, and shell checks on the tested Linux host.
- [x] The prototype server successfully served the page from a clean clone.

These checks must be repeated against the final frozen commit; they are not permanent guarantees.
