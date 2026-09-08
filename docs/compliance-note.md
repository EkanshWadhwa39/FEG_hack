# D4 compliance note — sandbox controls and outstanding approvals

## Status and authority

This is a draft implementation-focused compliance analysis, **not legal advice, legal certification, a provider approval or a completed production compliance assessment**. Sources are the current root `CODE.md`, `Context/FINAL-PLAN.md`, root audit and integration reviewer/architecture documents. The organiser Repository Structure and Submission Guidelines DOCX remains authoritative, but was **not read in this restricted documentation pass**. The current root audit, synchronised locally as [PRE-SUBMISSION-AUDIT.md](PRE-SUBMISSION-AUDIT.md), remains the audit gate; neither its historical baseline nor the integration copy establishes final acceptance. The team must verify the organiser terms, participant terms, D4 rubric, confidentiality, access and written permissions against the intended final commit.

Judges evaluate **our local sandbox**, not staging. No actual exclusion-register integration, production authentication, wagering backend or external provider execution is configured. The supplied unchanged provider is executed locally only inside the supported confined launcher. Sandbox authorization and candidates are **SIMULATED**; actual player eligibility, real exclusion-check timing and real-world legal compliance are **UNKNOWN**.

## Requirement-to-implementation matrix

Implementation controls below are **STATICALLY-INFERRED** unless the linked handoff/report explicitly records a test. Presence in source is not operational/legal acceptance.

| Concern | Current choice | Residual obligation / limit |
|---|---|---|
| Mandatory exclusion/eligibility authorization | Fixture starts UNKNOWN; only explicit GRANTED permits preparation/launch; launch rechecks; errors/denial/unresolved outcomes fail closed | Fixture is not real authorization. Approve the actual service contract, per-session/per-launch semantics, malformed/timeout behavior and revocation before real use |
| Do not cache/race the exclusion check | Authorization is separate from static cache preparation; no real exclusion response is requested or cached | Never prewarm before a required real grant or replace it with cached eligibility |
| Consent and data cost | Speculation off by default; visible opt-in and OFF mode; conservative network/visibility checks; two-request maximum and 10 MiB visit reservation ceiling | Configured limits are SIMULATED; cancellation cannot undo bytes already sent and the budget excludes foreground provider traffic. Legal basis/consent wording require review |
| No inducement through predictions | Synthetic ranking drives cache requests only; fixed player card ordering/style/focus | No “recommended for you” claims or behavioural-targeting claim. This design alone does not establish an AI Act or gambling-law exemption |
| Truthful states | Early responses, canvas and dependency errors separated; provider input acceptance stays UNKNOWN | Never say interactive/playable based on iframe load, timer, wrapper-ready or canvas; no fabricated reality/age checkpoint |
| Provider integrity | One pinned private ZIP read in place; no provider file patch, replacement, extraction/copy into public assets or engine hook | “Unchanged” does not mean licensed, certified for this hosting context or complete. Missing late resources remain missing |
| Network confinement | Linux namespace + namespace-local deny-default egress firewall; only approved loopback ports; non-root execution and independent checks | CSP alone is insufficient. No tunnel, public host, ordinary browser, external endpoint or guard bypass. Administrator/tool-code compromise is out of scope |
| Data minimisation | Synthetic catalogue/session inputs; no production login, real customer profile or player-level dataset needed | In-memory synthetic metadata is not anonymisation of real data. Do not import customer/player identifiers or exclusion payloads into logs |
| Confidential evidence | Raw body-omitted HARs stay private; narrowly whitelisted redacted exports and aggregate counters | HAR body omission is not redaction. Review every exported artifact and disclosure permission; current documentation pass is not a repository/history secret scan |
| Web-only scope | HTML/CSS/ES modules, normal browser HTTP cache; no service worker/custom cache/native SDK | No native/WebView, mobile-provider, cross-provider or production cache claim |
| Accessibility | Keyboard intent, semantic controls, dialog exit/focus return and status handling in source | Human screen-reader/reduced-motion/visual acceptance remains pending; provider accessibility is not certified by wrapper tests |
| Production effectiveness | Local early-asset comparison only | Actual device tier, authoritative input readiness, real safety/commercial outcomes and request/cache/CORS policy need separate approved validation |

## Privacy, ePrivacy and responsible-gambling considerations

Real player data can be personal data even when pseudonymised. No player-level CSV, hash, token, cookie, credential-bearing launch URL or exclusion payload belongs in reviewer-visible output. Do not deanonymise, join to identify individuals, or upload raw datasets/HARs to public tools. The current demo needs only synthetic session state, local public-style asset requests and a privately approved provider archive. A future real adapter requires data-controller/processor, purpose, lawful-basis, minimisation, retention and access review as applicable.

Speculative browser requests can consume user bandwidth/device resources and populate an HTTP cache. An explicit default-off control and conservative governor are implementation choices, **not a legal conclusion that ePrivacy consent or another legal basis is satisfied**. Production notices, consent/withdrawal semantics and jurisdiction-specific obligations need competent review. Real-world byte/energy impact is UNKNOWN.

A neutral loading status must not be presented as a mandated responsible-gambling reality check, age prompt or exclusion decision. Do not optimise around required controls or treat faster stake velocity/time-on-device as automatic success. Keep counter-metrics for delay, unused preparation, errors, accessibility and safety; any future regulated deployment must retain approved limits and other mandatory checks.

Candidate policies here are deterministic synthetic fixtures, not evidence of a deployed ML recommendation model. Cache-only use and invariant visible choices reduce one source of inducement, but no categorical AI Act/non-inducement exemption is claimed. Applicable jurisdiction, operator role and actual deployment behavior must be assessed.

## Provider and resource permissions

The supplied Empire archive is a **FEG-PROVIDED hackathon resource**, not presumed open source. Its content digest pins a release only. Permission to use, run, share with designated reviewers, redistribute fonts/media/code or disclose bundle-derived findings remains **UNKNOWN pending written confirmation**. Keep the archive out of the submission repository and public attachments; provision it through an organiser-approved private channel only after permission is established.

The twenty catalogue identities are **SIMULATED** deployments of one supplied build, not twenty licensed games. Synthetic covers/names do not change ownership of underlying provider content. Missing `book.png` and unresolved atlas references must not be repaired or replaced to manufacture gameplay. Neither a missing late asset nor a cache hit establishes base-game readiness.

[Dependencies](dependencies.md) records library licences, provider-resource limits, dataset exclusions and outstanding permission checks. No project-wide licence grant is asserted while team ownership/licensing is unconfirmed.

## Material AI assistance — affirmative disclosure

**Coding, test generation/expansion, debugging, security/measurement review and documentation were materially AI-assisted.** This reviewer package was drafted with Computer (cptr), an AI coding assistant. The team is responsible for all incorporated output: originality, security, accuracy, licence compliance and final review. Do not describe the work as wholly human-written or independently certified because tests passed.

**Restricted-resource and AI-input permissions are UNKNOWN.** No express written approval, applicable processing conditions, historical exposure review or complete tool/model inventory was verified here. The team must check the authoritative organiser terms, establish whether third-party AI processing of each input was permitted, review what was shared, record necessary approvals and address any suspected incident with the designated security contact. This documentation neither retrospectively grants consent nor claims the assistance was organiser-approved. Do not send additional confidential information, credentials, customer/player data or restricted resources to AI systems to resolve this checklist.

## Security, access and freeze obligations

1. Keep the repository private and team-controlled throughout the Judging Period; do not transfer ownership. Team name, Team Lead, ownership evidence and reviewer accounts remain UNKNOWN.
2. Grant only the designated T-Hub/FEG reviewers the required read-level access and test clone access. If unavailable, notify T-Hub before deadline for an approved secure alternative; do not replace it with a public repository or tunnel.
3. Confirm secure delivery rights for the pinned archive separately from source access. No archive access is implied by this README.
4. Perform deliberate working-tree **and Git-history** secret/prohibited-resource scans against the intended final commit. Revisit prior audit warnings about token-shaped values, provider details and private archive-release handling without reproducing sensitive strings here.
5. Review redacted evidence, derived metrics, screenshots, deck/video and all older documents for confidentiality and claim consistency before sharing.
6. Record the exact final revision, complete the organiser form/email/declarations and keep an internal frozen copy. Do not materially modify after deadline without organiser permission.
7. Report suspected leaks/unauthorised access through the designated security contact. Contact identity and incident-report route must be confirmed; none is fabricated here.

**MEASURED by the integration lead:** automated headed QA passed five scenarios under Xvfb; 458 Python and 584 JavaScript tests plus lint/syntax/shell checks passed on the working tree. Human visual/screen-reader acceptance remains **UNKNOWN**. The serial benchmark is in progress; completed checks, limitations and retained failures are in the lead-owned [measurement report](EMPIRE-MEASUREMENT.md). None of these closes permissions, final live-path acceptance or clean-clone/freeze gates. Review [submission status](EMPIRE-SUBMISSION-STATUS.md) and the current **root** audit; passing tests or completing documentation does not make submission compliant or ready.
