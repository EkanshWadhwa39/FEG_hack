# Dependencies, resource rights and AI assistance — draft

**Status: STATICALLY-INFERRED inventory, not licence clearance or a complete SBOM.** Versions/licences below come only from this integration's pinned manifests and matching installed package metadata. No registry lookup, install, raw-resource inspection or licence inference from a library/font name was performed. Permission to use or disclose restricted resources and AI inputs remains **UNKNOWN**.

## Software inventory

The browser product uses vanilla HTML/CSS/ES modules and ordinary browser HTTP caching, with no framework/build step, service worker or custom response cache (STATICALLY-INFERRED from [architecture](architecture.md)). Tooling is separate from the unchanged provider code.

| Pinned package | Role | Licence declared by matching package metadata |
|---|---|---|
| `playwright@1.55.1` | Browser tooling; direct npm development dependency | `Apache-2.0` |
| `playwright-core@1.55.1` | Locked transitive browser tooling | `Apache-2.0` |
| `fsevents@2.3.2` | Locked optional macOS dependency; not needed for the documented Linux path | **UNKNOWN**: lockfile has no licence field; installed metadata unavailable |
| `duckdb==1.5.5` | Evidence-analysis tooling | MIT (metadata classifier) |
| `openpyxl==3.1.5` | Spreadsheet tooling | MIT |
| `polars==1.44.1` | Lazy data-analysis tooling | MIT (metadata classifier) |
| `pytest==9.1.1` | Python tests | MIT |
| `ruff==0.15.8` | Python lint | MIT |

**Metadata provenance (STATICALLY-INFERRED):** npm versions from `package-lock.json`, licences from matching `node_modules/{playwright,playwright-core}/package.json`. Python pins from `requirements-dev.txt`; matching `.venv/lib/python3.12/site-packages/<package>-<version>.dist-info/METADATA` supplies the licence or classifier. These local installed paths are verification sources, not files to commit. Licence declarations do not substitute for reviewing included notices, vendored components or redistribution obligations.

Python direct requirements are pinned, but this file does **not** establish a fully locked Python dependency graph. Installed transitive/bootstrap metadata was observed for `et_xmlfile`, `iniconfig`, `packaging`, `pip`, `pluggy`, `polars-runtime-32` and `Pygments`; a reproducible resolved inventory, pin coverage and notice review remain outstanding. No licence assignment is made here for unpinned transitive packages.

## Browser, host and external services

| Dependency | Scope / unresolved work |
|---|---|
| Playwright-managed Chromium and bundled components | Installed before isolation; exact experiment browser/version belongs in the lead's report. Browser/component licences and notices **UNKNOWN** in this review; do not apply Playwright's licence to the entire browser |
| Node/npm, Python/venv/pip, Bash, Git, ShellCheck | Host/setup tools. Final supported versions, distribution provenance and licence inventory require clean-clone verification |
| Linux kernel, `sudo`, util-linux (`unshare`, `runuser`), iproute2 (`ip`), `iptables`/`ip6tables`, procfs | Required for approved namespace confinement. Installed OS versions/licences not audited here; administrator permission is separate from software licensing |
| X11/Wayland display; Xvfb for reported automated QA | Graphical environment/QA tooling, not proof of human accessibility. Final environment and notices remain to be inventoried |
| Live APIs/database/authentication | None configured for the isolated sandbox according to architecture. No production login, credential, exclusion-register service or remote provider endpoint is required/authorised by these docs |

Use only the confined Empire launchers in the [reviewer guide](EMPIRE-REVIEWER-GUIDE.md). Do not install dependencies during provider execution, run an ordinary host browser/server for Empire, publish a tunnel or weaken isolation for reviewer convenience. Network confinement is not general filesystem containment or permission to execute proprietary resources.

## Resources and rights

| Input / output | Classification and rights boundary |
|---|---|
| Supplied Empire of Gold build, code, fonts, images/audio and other embedded resources | **FEG-PROVIDED** private resource. One unchanged release is pinned by digest; this establishes identity, not copyright/licence/redistribution rights. Execution, reviewer transfer, screenshots/video and derived disclosure permissions **UNKNOWN** |
| English desktop manifest and bundle-derived findings | **STATICALLY-INFERRED**, not observed provider-selected tier. Underlying-resource and derived-information disclosure permissions **UNKNOWN**; do not infer font licences from names |
| Catalogue identities, candidates, authorization, session state and configured limits | **SIMULATED**; not real player data, real eligibility or distinct licensed games. Synthetic provenance does not clear embedded provider assets |
| Original Vault Match reference game and generated covers/assets | Separate team/reference implementation described in architecture; not Empire evidence. Team ownership, originality/template provenance and any project licence grant require confirmation |
| FEG datasets, spreadsheets, event logs, historical HARs, media and archives | Not read in this pass; no raw inputs belong in the submission repository. Not required by the sandbox's synthetic candidate policy. Rights to use aggregates, disclose findings or provide inputs to AI remain **UNKNOWN** |
| Redacted HAR exports and aggregate reports | Lead-owned evidence, not automatically safe/public. Redaction and disclosure permission require review before display; body omission alone is insufficient |
| Templates, icons, fonts, deck/video and other presentation resources | Complete source/author/licence/permission inventory remains **UNKNOWN**; no assertion that all are original or approved |

Keep raw evidence, datasets, media, provider archives/bundles, credentials and player-level material out of commits and attachments. Reviewer source access does not imply entitlement to the private archive. Arrange any permitted archive delivery through an approved private channel; never include it to make a clean clone appear self-contained.

## Material AI/code assistance — affirmative, not approval

Coding, tests, debugging, security/measurement review and documentation were materially AI-assisted as disclosed by the integration README. Computer (cptr) assisted this documentation pass using the listed textual documents and software metadata; this pass did not read raw evidence, media, data or archives. The task's permitted reads do **not** establish underlying organiser permission for third-party AI processing.

**UNKNOWN:** full tools/models/contributors inventory; exact historical inputs and exposure; input-processing/retention conditions; applicable written approvals; output originality and team licensing authority. The team must record material assistance by artifact/task, verify permitted inputs against the authoritative terms, review output and resolve any suspected unauthorised disclosure through the designated security contact. Do not upload more restricted inputs to obtain that approval. No retrospective approval, wholly human-authored claim or compliance certification is made.

## Release obligations still open

- Reconcile exact pinned/resolved software and OS/browser versions; review source licences, required notices and optional/transitive dependencies. Current vulnerability/security acceptance is **UNKNOWN**; no scan was run here.
- Confirm resource ownership, permitted execution/use, reviewer distribution, derived disclosure and AI-input processing in writing; record restrictions without exposing private approvals or credentials.
- Confirm team repository ownership and intended project licensing. Team name, formal lead and reviewer access remain **UNKNOWN**.
- Review all submitted code/docs/evidence/demo assets and Git history for confidential/prohibited inputs; resolve the root audit's token-shaped value and private provider-release questions.
- Validate against the intended final commit using the current root audit, synchronised locally as the [audit gate](PRE-SUBMISSION-AUDIT.md). Its historical baseline is not final acceptance. This document does not clear that gate or replace the authoritative organiser terms.

See [compliance](compliance-note.md), [submission status](EMPIRE-SUBMISSION-STATUS.md) and the lead-owned [EMPIRE-MEASUREMENT.md](EMPIRE-MEASUREMENT.md) (benchmark in progress; completed checks and limitations recorded). No performance result is supplied by this dependency inventory.
