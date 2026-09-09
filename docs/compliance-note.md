# Compliance note — BETA packaging snapshot

**Not legal advice, certification, submission approval, or deployment approval.**
This is a disclosure and release-gate note for selected source `979aceb`, packaged
under `src/`. Source inspection establishes implementation facts, not legal
compliance. Open issues below are not waived by this document or passing tests.

Read [README](../README.md), [architecture](architecture.md),
[impact](impact-case.md), and [dependencies](dependencies.md) together.

## Authority and evaluation scope

The organiser's Repository Structure & Submission Guidelines was reviewed for
this package. It requires private team-controlled hosting, reviewer access,
reproducibility, ownership and dependency/AI disclosure, confidentiality, and a
frozen identifiable submission. It references original **Participant Terms &
Submission Guidelines** and **Challenge Ideas** documents that have not been
provided/verified in this review. Their exact obligations remain **UNKNOWN**;
the repository guide is not a substitute for obtaining them.

Evaluation is in **our own sandbox only**, with supplied unchanged game content.
There is no staging testing dependency and no approval to request production
systems. **SIMULATED:** 20 catalogue slots; **FEG-PROVIDED:** one supplied bundle.
No prediction model/training, new game assets, substitute/reference game, native
client, service worker, custom cache, or application database is in scope.
These are scope constraints, not features promised for a later hackathon build.

## Implementation versus safeguard requirements

The following source findings are **STATICALLY-INFERRED**, not legal conclusions.

| Area | Current beta and required boundary |
|---|---|
| Exclusion/authorization | Active `src/lobby.html` warms and launches without an exclusion-register gate. Separate `src/src/sandbox.js` checks do not protect this path. No real-player use is acceptable on this basis. |
| Failure handling | Abort/cancel and iframe rollback exist. A 25 s timer remains armed after heuristic readiness; “fail-closed” UI wording does not mean authorization failed closed. |
| Consent/data cost | Toggle and estimated byte cap exist; warming starts enabled. Hardcoded network/visibility and per-job concurrency are not a verified global data safeguard or legal consent mechanism. |
| Truthful readiness | Cursor, stage visibility, and partial resource-waterfall heuristics do not establish accepted input. “Interactive”, “100% cached”, and “0 wire transfer” labels are unproven. |
| Resource eligibility | Warmer excludes SECONDARY and requires PRIMARY entries to be marked critical. Exact criticality, locale/tier correctness, permission, and deployment cache policy remain unverified. |
| Personalisation/RG | Catalogue identities and state are synthetic; no model or actual player dataset drives runtime selection. This does not certify neutral presentation or responsible-gambling compliance. |
| Network boundary | `game` parameter lacks approved origin/scheme validation; Google Fonts creates external requests. Credential omission on warm fetches does not contain iframe navigation or all UI traffic. |
| Accessibility | Separate player/a11y modules and tests exist. They do not establish active-lobby keyboard, focus, screen-reader, contrast, motion, or failure-recovery compliance. |

These defects are disclosed, not fixed by packaging. Do not conduct real-player
trials or represent the active lobby as enforcing mandatory authorization checks.
An actual integration must never cache authorization, race warming past it, or
render past denial, error, timeout, malformed response, or an unknown result.

## Legal and policy assessment still required

- **Data protection:** GDPR/personal-data roles, lawful basis, minimisation,
  retention, international transfers, and incident handling need qualified review
  where applicable. Pseudonymised identifiers are not automatically anonymous.
- **Storage/access and consent:** browser HTTP-cache warming and external fonts
  require applicable ePrivacy/local-law assessment. A toggle is not by itself
  proof of valid consent or of an exemption.
- **Gambling and consumer protection:** applicable Croatian/EU requirements,
  exclusion checks, age/eligibility controls, RG notices, and non-misleading
  presentation require operator/legal confirmation. A loading overlay is not a
  reality check or permission to hide a mandatory check.
- **AI/tooling:** no runtime model is used, but development assistance still needs
  disclosure and review under the actual challenge rules. No legal exemption or
  AI-law compliance is inferred from the absence of a predictor.
- **IP and ownership:** supplied resources, brand presentation, fonts, code
  contributions, and redistribution conditions need documented permission.
  Our-code licence and supplied resource permissions remain **UNKNOWN**.

## Confidentiality and AI disclosure

No actual dataset is an application runtime dependency. Keep raw HARs, datasets,
player records/hashes, media, provider bundles, credentials, launch URLs containing
credentials, and exclusion payloads out of submitted source and presentation.
HARs must be redacted before sharing; do not display sensitive fields in telemetry.
This documentation pass did not perform a repository/history security scan.

**Known AI assistance:** Computer/cptr assisted audit, planning, documentation,
and packaging. Full code-authoring tool use and attribution have not been
independently confirmed. Team review and written approval for any use of restricted
Hackathon Resources with AI systems must be established; it is not assumed here.
Archiving AI instruction files does **not** remove mandatory AI disclosure,
provenance, history-review, or incident-response obligations.
Suspected compromise, prohibited disclosure, or unauthorised access must be
reported promptly to the organiser's designated security contact.

## Blocking release checklist — all remain open until verified

Completion of four documents is only one packaging step, not a freeze decision.

- [ ] Obtain original Participant Terms and Challenge Ideas; confirm applicable
  challenge, AI-use, IP, evaluation, and demo-deliverable requirements.
- [ ] Confirm team name, members, **Team Lead**, repository owner/controller, and
  contribution ownership. This note does not invent a lead or grant a code licence.
- [ ] Keep the repository private through judging. Grant designated T-Hub/FEG
  reviewers least-privilege read access and test it without transferring ownership.
  If unavailable, obtain an approved secure alternative before the deadline.
- [ ] Resolve supplied bundle/dataset permissions, brand/font permissions, third-
  party notices, and any reviewer redistribution/use restrictions. Establish a
  secure authorised route for the unchanged bundle; do not commit it as a shortcut.
- [ ] Review repository **and history**, attachments, and releases for secrets,
  prohibited data, sensitive endpoints, provider information, and disallowed
  disclosures. Archival/removal from the current tree is not history remediation.
- [ ] Resolve earlier token-shaped fallback and provider-bundle draft-release
  concerns without reproducing sensitive values; obtain security/owner approval
  for any required revocation, history remediation, or release removal.
- [ ] Verify written restricted-resource/AI approvals and complete team-wide AI
  and code-assistance provenance disclosure. Resolve incidents through organisers.
- [ ] Confirm README completeness and all mandatory documents against the exact
  intended final commit, including configuration and explicit known limitations.
- [ ] Clone that commit cleanly; follow README setup, checks, server and demo flow;
  verify declared dependencies and approved bundle access without hidden local
  files. Current packaging tests are not an exact final-commit clean-clone audit.
- [ ] Reconcile runtime/evidence blockers before claiming authorization, cache
  reuse, playability, bounded cost, or causal improvement. Sandbox proof must be
  scoped to the actual browser, title/build, milestone, and run count.
- [ ] Confirm required demo video/screenshots/deck and declarations under the
  original rules. Do not assume four documents alone satisfy all deliverables.
- [ ] Complete the external submission form/email with private repository link,
  final commit hash and required declarations; record an internal frozen copy.
- [ ] Obtain final authorised team/security sign-off; preserve privacy and reviewer
  access through judging. No material post-deadline changes without organiser
  permission. Mandatory organiser requirements cannot be waived internally.

**Current disposition: BETA review only.** Packaging approval does not authorize
runtime fixes, browser experiments, external production requests, commit/push,
or final submission. Internal safeguards are not legal certification.
