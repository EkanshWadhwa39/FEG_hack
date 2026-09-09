# Dependencies and assistance — BETA packaging snapshot

**Status: disclosure inventory, not licence clearance or submission approval.**
Selected source: `979aceb`; browser paths use the packaged `src/` layout.
Read with [README](../README.md), [architecture](architecture.md),
[impact](impact-case.md), and [compliance](compliance-note.md).

Versions/licences below are **STATICALLY-INFERRED** from source manifests,
installed package metadata/LICENSE files, and local distribution notices.
Toolchain observations and package validation are **MEASURED** as noted below.
The packaging check installs declared dependencies and runs the existing suite;
it is not a vulnerability scan or full transitive licence/permission audit.
**UNKNOWN** means not independently confirmed; availability is not permission.

## Runtime and developer tooling

The team-authored lobby uses vanilla HTML/CSS/ES modules and browser APIs.
It has no declared npm production dependency, framework/build pipeline, model
service, or application database. Playwright and Python packages below are tools,
not third-party services processing player data in the lobby.
The supplied game has its own embedded dependencies; that is a separate boundary.

| Component | Declared / observed version | Role and licence evidence |
|---|---|---|
| Node.js | Checked with 22.23.2; default host 18.19.1; not repository-pinned | JS tests/static server/tool scripts. Local distribution identifies Node core as Expat/MIT, with separate bundled-component notices. |
| npm | Host 9.2.0; not repository-pinned | Package installation/scripts; installed metadata: Artistic-2.0. |
| Playwright | `^1.63.0` in `package.json`; lockfile and installed 1.63.0 | Browser automation. Apache-2.0 in package metadata and LICENSE. Development dependency. |
| playwright-core | Exact 1.63.0 lockfile/installed | Playwright transitive dependency. Apache-2.0 metadata and LICENSE. |
| Browser binaries | Playwright Chromium 153.0.8010.12, revision 1243 | **MEASURED:** launched for the existing supporting-player tests. Browser distribution's full licence/notice set: **UNKNOWN** in this review; not covered simply by Playwright's licence. |
| CPython | Host 3.12.3; not repository-pinned | Local sandbox server, measurement/redaction, Python tests. Local notices include PSF/Python licences and incorporated-component terms. |
| ShellCheck | Host 0.9.0; not repository-pinned | Required by `scripts/check.sh`; local notices: GPL-3.0-or-later. Standalone developer tool, not linked into the browser. |
| pip | Installed venv 26.2.1; bootstrap upgrades without an exact pin | Python package installer; metadata: MIT. |

**Compatibility requirement:** Playwright declares **Node >=20**. Packaging checks
used isolated Node **22.23.2**, not the incompatible default host Node **18.19.1**;
reviewers should use the Node 22 toolchain documented in [README](../README.md).
Node 18 compatibility is not claimed. Package pins are not proof of safety;
security/update review remains open and packaging changes no dependency versions.

## Python direct pins

`requirements-dev.txt` pins all five direct packages below. These are not required
to load an already-served browser UI, although Python serves the supplied-bundle
sandbox and runs validation utilities. Analytics libraries being installed does
not mean the beta trains a model or reads supplied datasets at runtime.

| Package | Exact pin and installed version | Purpose | Locally declared licence |
|---|---|---|---|
| duckdb | 1.5.5 | Offline analytical querying capability | MIT classifier |
| openpyxl | 3.1.5 | Offline spreadsheet handling capability | MIT |
| polars | 1.44.1 | Offline/lazy analytical processing capability | MIT text/classifier |
| pytest | 9.1.1 | Python tests | MIT |
| ruff | 0.15.8 | Python lint | MIT |

Material installed Python transitive packages are listed separately because they
are **not individually pinned** in the requirements file. Their installed state
is not a promise that a new resolver run will select identical versions.

| Package | Installed version | Locally declared licence |
|---|---|---|
| polars-runtime-32 | 1.44.1 | MIT |
| et_xmlfile | 2.0.0 | MIT |
| iniconfig | 2.3.0 | MIT |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pluggy | 1.6.0 | MIT |
| Pygments | 2.21.0 | BSD-2-Clause |

Preserve applicable copyright, licence, attribution and NOTICE requirements for
components actually redistributed. Standalone tool use does not automatically
relicense team code. Binary/browser/system-library notices need their own review;
this inventory is not a blanket grant of rights to FEG, T-Hub, or reviewers.

## Supplied resources and external services

| Resource | Use in this beta | Permission / licence status |
|---|---|---|
| Supplied Empire of Gold bundle | **FEG-PROVIDED** unchanged game bytes served locally behind **SIMULATED** 20 slot aliases; no new game assets or independent catalogue games | **UNKNOWN** rights to use, host, disclose, or redistribute for reviewers. Secure approved provisioning is required; do not commit the bundle. |
| Embedded game engine/vendor code, fonts, art, sound | Existing supplied bundle, including Pixi-named vendor code and manifest references to Mulish, New Rocker and Oswald | Exact versions, original notices, provider permissions and component licences **UNKNOWN**. Filenames do not prove licences. No provider code is modified by packaging. |
| Supplied CSV/XLSX datasets and historical HAR/media | Background materials only; **no actual dataset runtime dependency**, no model/training, no new analytics claimed in these documents | Use, disclosure, AI-processing and redistribution permissions **UNKNOWN**. Do not package raw data, player identifiers, HARs or media. |
| Google Fonts / Roboto | Active `src/lobby.html` preconnects to Google Fonts and requests a hosted Roboto stylesheet/font chain | External network dependency; exact delivered font version/licence and applicable hosted-service/privacy permissions **UNKNOWN** here. The UI is not fully offline. |
| PSK/FEG names and lobby styling | Existing UI/brand presentation; not a provider endorsement or game-asset licence | Brand-use permission and any external design/template provenance **UNKNOWN**. No third-party template package identified in declared dependencies; that is not a complete originality audit. |
| Third-party APIs/SDK services | No required external gameplay/auth/model API is established for our sandbox; bundle runs locally | Google Fonts is the known UI service. Complete bundle-initiated traffic inventory **UNKNOWN** without an authorised run; do not infer zero egress. |
| Team-authored source | Browser modules, local servers, evidence tools, tests, packaging/docs | Team code licence, full contribution ownership and redistribution terms **UNKNOWN**; this document does not assign a licence. |

The unsafe `game` query parameter can redirect connection hints, asset requests,
and iframe navigation beyond the intended local sandbox. It is not an approved
third-party integration. Use no credentials or production addresses and do not
run production-named probes as part of beta packaging/review preparation.
No staging service is needed for the hackathon evaluation scope.

## Models, AI assistance, and responsibility

- **No application prediction model, training pipeline, model weights, inference
  API, or player-data-driven recommendation system is in scope.** This is not a
  missing dependency to be filled in before the sandbox can be evaluated.
- **Known material assistance:** Computer/cptr supported audit, planning,
  documentation, and repository packaging/consolidation. This disclosure remains
  required even when agent instructions/skills are archived outside the package.
- **UNKNOWN:** full code-authoring tool inventory, model/service versions used
  across contributors, output attribution, and independently verified originality
  of all code/UI. Confirm these with the team before final declarations.
- Written permission for sending any restricted Hackathon Resources to third-party
  AI systems is **UNKNOWN** here. Do not infer approval from tool availability,
  private-repository status, or the existence of this disclosure.
- The team remains responsible for security, accuracy, originality, licensing,
  confidential handling and compliance with the original challenge rules.

## Before freeze

Resolve permissions and provenance; review all material notices and obligations;
confirm compatible reproducible versions and approved resource access; complete
security/history and AI approvals; then record the exact intended final commit.
The current **MEASURED** packaging suite passed 50 Python / 136 JS tests, with no
skips; see [README](../README.md) for scope. Neither metadata inspection nor those
checks establish legal clearance, active-lobby safety, vulnerability status, or
final submission readiness.
