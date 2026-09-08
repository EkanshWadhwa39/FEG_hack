# Vault + unchanged Empire of Gold — FEG Challenge 3

**Solution:** governed browser HTTP-cache preparation before title selection.
**Challenge:** FEG Hackathon 2026, Challenge 3 — Game Load Time.
**Team name, Team Lead, repository ownership and designated reviewer access: UNKNOWN — awaiting team/organiser confirmation.**

| Member | Team identifier |
|---|---|
| Ekansh | A |
| Hansika | B |
| Parth | C |
| Shaurya | D |

## Reviewer summary

Players may wait for static resources after selecting a game. Vault explores moving a bounded part of that work into authorised lobby browsing, without changing player choices or certified game files. The innovation is **cache-only prediction plus explicit cost and failure accounting**, not a new game engine or a recommendation feed.

The reproducible local mode presents **20 SIMULATED, stable catalogue identities of one unchanged supplied Empire of Gold build**, served directly from a private ZIP. The optional CDN mode presents **one** pinned synthetic identity at a digest-addressed HTTPS release. Both warm the same **eight real PRELOADER / partial COMMON resources, totalling 523,940 decoded bytes (STATICALLY-INFERRED)**. Those bytes are a manifest size, not a measured saving. No SPLASH, PRIMARY or SECONDARY resources are proactively warmed by this integration.

**Current acceptance:** Earlier working-tree checks and automated headed reviewer QA passed under the former Linux-isolated runner. The retained ten-pair report completed all pairs but has overall verdict **FAIL** because its five required diagnostics ended in errors. It predates the direct-host change and must not be represented as validation of this version. Human visual/screen-reader acceptance and provider gameplay readiness remain **UNKNOWN**. See the [Empire measurement report](docs/EMPIRE-MEASUREMENT.md). This is **not submission approval**.

Judges evaluate **our sandbox only**. Staging is not a judging dependency. Neither local cache reuse nor tests establish production behaviour. `CODE.md` and `Context/FINAL-PLAN.md` have been reconciled with the updated root-workspace brief. Older evidence/analysis documents remain historical; do not treat their staging/native proposals or historical reports as this integration's implementation or result.

## Two distinct entry points

| Command | Purpose | Boundary |
|---|---|---|
| `npm run demo:empire -- --zip /private/path/empireofgold.zip` | Graphical Vault + unchanged Empire launcher | macOS or Linux; approved private archive and local graphical display required |
| `npm run verify:empire -- --zip /private/path/empireofgold.zip` | Headless, serial CONTROL/TREATMENT verification | macOS or Linux; no graphical display required |
| `npm run test:empire:visual -- --zip /private/path/empireofgold.zip --runs 5` | Direct unchanged-ZIP Play-button visibility timing | Human-marked fresh graphical runs; no Vault/prefetch; not an input-ready result |
| [CDN deployment runbook](docs/EMPIRE-CDN-DEPLOYMENT.md) | Package and verify the optional one-title HTTPS experiment | Separate origins and fresh browser profiles; not production or staging proof |
| `npm run demo` | Separate original **Vault Match** reference scene | No provider archive; normal localhost browser; **not an Empire substitute, provider-readiness result or Empire benchmark** |

The supported launchers now use ordinary host networking and bind the local server to `127.0.0.1`. They do not create a network namespace, change firewall rules, require `sudo`, restrict provider egress or attest process namespaces. This follows the team's confirmation that those controls are not required. The private archive is still not bundled or published.

## Requirements and setup

Use an authorised account on macOS or Linux with:

- Bash, Git, Node.js and npm. **Node.js 22 LTS is the recommended setup target**; locked Playwright requires Node >=18. A fresh Node/OS compatibility run for the intended final commit is pending.
- Python **3.10+**, `venv` and pip; ShellCheck for the full check script.
- Playwright's Chromium and its platform dependencies. No `sudo`, `unshare`, network namespace, `iptables` or Linux `/proc` support is required.
- For `demo:empire`, a usable local X11/Wayland graphical session (`DISPLAY` or `WAYLAND_DISPLAY`, plus actual display access). A display variable alone is insufficient. Human visual/accessibility acceptance is pending.
- The reviewed ZIP, privately supplied with permission, readable by that same non-root user. It is not downloaded or included in the repository.

From the reviewer-authorised checkout of the intended version:

```bash
./scripts/bootstrap.sh
npx playwright install chromium
# If Chromium reports missing Linux libraries, have the administrator install
# Playwright's documented dependencies (npx playwright install-deps chromium).
./scripts/check.sh
.venv/bin/python tools/measure_har.py --help
```

`bootstrap.sh` installs Python development packages and runs `npm ci`; ShellCheck and OS tools must already be installed. Dependency installation may need internet access; **provider execution must not**. Do not start a provider server during setup. No `.env`, credentials, API key, production login or live exclusion-register endpoint is needed.

### Private archive and configuration

`--zip` is mandatory. Use a quoted private absolute path, never a download/launch URL or credential. The runner and server pin SHA-256:

```text
f0b4947f9d703af9c99419418293ac518189afe3c8dabfc9781f9558a9dacdba
```

The pin identifies the reviewed release, **not permission to redistribute it**. A mismatch fails closed; do not change the pin or archive. Request the approved release through the organiser/team's secure channel, whose access arrangements remain UNKNOWN.

The sandbox fixes `http://127.0.0.1:8100` for the lobby and ports `8101`–`8120` for distinct local game origins. Do not remap them or change hostname/cache keys. English / `1x` is the statically reviewed desktop manifest, **not an observation of the provider's actual chosen tier**. Provider tier is UNKNOWN; mobile/unverified-device preparation and the desktop milestone are disabled conservatively.

## Run and demonstrate

```bash
npm run demo:empire -- --zip '/private/path/empireofgold.zip'
```

The launcher opens its own graphical browser and starts the localhost server. Close that browser to stop its server; Ctrl+C is also handled.

For a separate human-marked baseline with the unchanged ZIP opened directly—without Vault, its iframe wrapper or prefetch—run `npm run test:empire:visual -- --zip '/private/path/empireofgold.zip' --runs 5`. Press F8 when the provider Play button first becomes visible. Results are `HUMAN-ANNOTATED` visibility only. See [Direct unchanged-ZIP visual timing test](docs/DIRECT-ZIP-VISUAL-TEST.md).

1. Observe the fixed catalogue and **UNKNOWN** authorization with preparation off.
2. Choose **Denied** or **Error** and select a title: no provider iframe should mount.
3. Choose **Granted — allow this sandbox**. This is **SIMULATED authorization**, not an exclusion-register decision.
4. Enable speculative requests. Observe top-three preparation or use hover/keyboard-focus mode. Candidate policy affects requests only, never card order, style or focus. Limits are **SIMULATED configuration:** two concurrent speculative requests and a 10 MiB per-visit reservation budget, including cancelled attempts.
5. Select a title. The app stops/drains speculation, rechecks the fixture and launches the original provider document in an observing wrapper. Inspect early-response completion, canvas presence and dependency failures as **separate states**.
6. **Never call this gameplay-ready or interactive.** No authoritative provider accepted-input hook is established. Missing late dependencies, including `book.png`, remain unmodified; their base-game impact is UNKNOWN.
7. Revoke sandbox access to remove the active frame; return to the lobby. A different candidate or a cancelled preparation can incur cost without helping this selection.

A manual visit demonstrates controls; **reload is not a cold baseline**. Use the automated path for a fair experiment. Full steps, troubleshooting and report interpretation are in the [reviewer guide](docs/EMPIRE-REVIEWER-GUIDE.md).

## Validate without inventing results

```bash
# Headless experiment; default is 10 serial counterbalanced pairs
# plus required diagnostics, not parallel browser runs.
npm run verify:empire -- --zip '/private/path/empireofgold.zip'

# Shorter diagnostic run, not equivalent statistical coverage:
npm run verify:empire -- --zip '/private/path/empireofgold.zip' --runs 1
```

The runner uses equal fixed browsing intervals, fresh browser/server instances per arm, ordinary cache-enabled requests, no request routing and unthrottled loopback. It checks exact provider-document early-resource completion and cache attribution, wrong-title and `no-store` negatives, keyboard intent, fail-closed states and revocation. `PASS` concerns the required early-asset proof, **not a promise of positive milliseconds saved or gameplay readiness**. Missing diagnostics make acceptance inconclusive.

**MEASURED on the current integration working tree:** 458 Python + 584 JavaScript tests passed, with lint/syntax/shell checks. Automated isolated headed QA passed five scenarios under Xvfb. See [measurement scope](docs/EMPIRE-MEASUREMENT.md). These counts are not clean-clone/final-commit reproduction, human visual acceptance or provider gameplay proof.

Raw body-omitted HARs still contain sensitive metadata: keep `evidence/private/` private. The runner writes aggregate JSON and narrowly redacted HAR exports under `evidence/derived/`; review permission and redaction before sharing. See the [measurement report](docs/EMPIRE-MEASUREMENT.md), not historical/content-demo numbers, for scoped Empire status and results.

### Separate reference fallback

If the approved archive or graphical environment is unavailable:

```bash
npm ci
npm run demo
```

Open `http://127.0.0.1:8095/` in an ordinary local browser; stop with Ctrl+C. This serves the original, non-wagering **Vault Match** memory game and generated synthetic assets. Its accepted card input belongs **only to that reference scene**. It neither launches nor repairs Empire and cannot close any Empire evidence/access blocker. `npm run verify:demo` is its separate verifier. Do not follow historical branch-clone instructions to replace this integration checkout.

## Source map and documentation

- `prototype/` is this repository's implementation/source directory (the organiser's `src/` role): vanilla HTML/CSS/ES modules and `prototype/tests/` JavaScript tests; no framework/build step.
- `prototype/empire-demo.html`, `src/empire-*.js`: Empire lobby, exact manifest adapter, wrapper observations and milestone validation.
- `prototype/src/content-loader.js`, `bounded-browser-requester.js`, policy/scheduler, manifest, warmer and governor: shared safety/loading core; metadata accounting is not a custom response cache.
- `tools/empire_catalogue_server.py`, `verify_empire.mjs` and measurement/redaction helpers: localhost private-ZIP serving and verification. The historical `verify_empire_isolated.sh` path is now only a direct-launch compatibility wrapper. `tests/` holds Python tests.
- `prototype/content-demo.html`, original reference-game modules and `tools/content_demo_server.mjs`: distinct reference flow. Existing team sandbox/player/visualizer surfaces are not replaced by this documentation.
- `docs/`: reviewer material and historical handoffs. Raw HARs, provider ZIPs/bundles, player-level data, spreadsheets, videos and credentials are **not supplied as repository runtime inputs**. Approved private ZIP provision is an explicit separate Empire prerequisite.

Read [architecture](docs/architecture.md), [impact case / D3](docs/impact-case.md), [compliance / D4](docs/compliance-note.md), [dependencies, permissions and AI disclosure](docs/dependencies.md), [reviewer guide](docs/EMPIRE-REVIEWER-GUIDE.md) and [submission status](docs/EMPIRE-SUBMISSION-STATUS.md).

## Limitations and next gates

One provider/build; synthetic demand/identities/authorization; unknown actual provider tier and gameplay readiness; localhost identity encoding and sandbox cache/CORS policy; incomplete package dependencies; no native/mobile-provider or production-effect claim. Real authorization, production request/cache policy, device/locale validation and accepted-input integration require later approved deployment work, not production probing during this hackathon.

**Material AI assistance:** coding, tests, debugging/review and documentation were materially AI-assisted, including this reviewer package via Computer (cptr). The team remains responsible for accuracy, security, originality, licences and permission to use restricted resources with AI. Written permissions and a complete assistance inventory are pending; see [dependencies](docs/dependencies.md).

External blockers include team name/lead/ownership, provider/resource and AI-use permissions, reviewer access and secure archive delivery, required demo artefacts, final measurement/visual acceptance, clean-clone checks, confidentiality/history review and submission declarations. Complete the [pre-submission audit](docs/PRE-SUBMISSION-AUDIT.md) against the intended final commit. **This package is not frozen, submitted or approved for distribution.**
