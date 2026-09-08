# Reviewer guide — isolated Vault + unchanged Empire

**Status:** working-tree checks and automated isolated headed QA **MEASURED PASS**. The ten-pair experiment is running; final proof/performance and human graphical/screen-reader acceptance remain **UNKNOWN/pending**. Read [EMPIRE-MEASUREMENT.md](EMPIRE-MEASUREMENT.md) for actual scope and retained failures, and [submission status](EMPIRE-SUBMISSION-STATUS.md) before treating this as a frozen package.

## 1. Choose the correct mode

| Need | Use | Do not infer |
|---|---|---|
| Inspect Vault launching the unchanged supplied provider | `npm run demo:empire -- --zip …` on an approved Linux graphical desktop | A visible canvas or early resource batch is not accepted gameplay input |
| Reproduce isolated early-resource proof headlessly | `npm run verify:empire -- --zip …` | A PASS does not prove positive timing improvement, gameplay readiness or production behavior |
| Explore the original non-wagering reference scene without a provider archive | `npm run demo` | Vault Match is not Empire, a repair for it or substitute evidence |
| Review code without archive/namespace permission | Read source and the reports; run approved synthetic unit checks | Unit checks do not execute/validate this provider's end-to-end browser path |

Judges test **this sandbox**, not staging. Do not connect to production or external provider endpoints, even if sandbox dependencies are missing. Do not use older direct Python sandbox/server instructions for this private provider release.

## 2. Preconditions — stop if any required condition is absent

- Private repository access and private ZIP delivery must be authorised. Team/reviewer access, licence and redistribution permission are not established by this guide.
- Non-root Linux account; Bash, Git, Node/npm (Node 22 LTS recommended), Python 3.10+ with `venv`, ShellCheck for full checks, and Chromium runtime libraries.
- Executables `sudo`, `unshare`, `ip`, `iptables`, `ip6tables`, `runuser`, `node` and `python3`; functioning network namespaces, procfs and namespace-local firewall support. `unshare`/`runuser` normally come from util-linux and `ip` from iproute2.
- Administrator-approved **`sudo -n`** execution of the launcher's namespace setup. `sudo -v` may establish a permitted timestamp; a restrictive sudo policy or disabled namespaces still blocks execution. This guide does not ask reviewers to change sudoers or bypass their organisation's controls.
- `demo:empire` additionally needs a real accessible local graphical display. `DISPLAY`/`WAYLAND_DISPLAY` may be removed by sudo policy or refer to an inaccessible socket. An authorised administrator must resolve display access without relaxing network confinement. A virtual-display smoke check is not human visual acceptance.
- Archive and checkout readable by the invoking non-root user; no external URL, symlink substitution or unreviewed ZIP.

The namespace has only loopback; firewall rules allow the approved local IPv4 TCP ports and replies, with IPv6 denied. Browser and server are started **together within it** as the original non-root user. Host network interfaces/firewall are not intentionally modified by these namespace-local rules. This is network confinement, not a general-purpose VM or defense against malicious administrators.

## 3. Install before isolation

From the authorised integration checkout:

```bash
./scripts/bootstrap.sh
npx playwright install chromium
./scripts/check.sh
.venv/bin/python tools/measure_har.py --help
```

If Chromium needs OS libraries, ask the administrator to install Playwright's documented dependencies (`npx playwright install-deps chromium`). These setup commands install dependencies and may need internet access; they are **not provider execution**. No `.env`, production credentials or API keys are required. `bootstrap.sh` accepts `PYTHON_BIN` to select its virtual-environment interpreter; the Empire runner itself invokes `python3` from PATH, which must also be suitable.

A fresh clean-clone run for the intended final commit is still required. The [measurement report](EMPIRE-MEASUREMENT.md) records **MEASURED 458 Python + 584 JavaScript tests passed on this working tree**, not a frozen commit. Automated isolated headed QA passed under a virtual display; this does not establish human visual acceptance.

## 4. Provision the exact private ZIP

Both Empire commands require `--zip`. The runner/server hard-code this reviewed SHA-256:

```text
f0b4947f9d703af9c99419418293ac518189afe3c8dabfc9781f9558a9dacdba
```

For example, a reviewer may compare `sha256sum '/private/path/empireofgold.zip'` privately before launching. Do not paste private paths or archive contents into public logs/issues. The digest is a release identity, not a licence. ZIP filename is not the pin. The archive is read in place, not extracted or patched. There is no automatic download and no supported caller override to run a different provider build. On mismatch, stop and obtain the correct authorised release; do not change the pin.

The fixed mapping inside the namespace is lobby `127.0.0.1:8100` and twenty instance origins `127.0.0.1:8101`–`:8120`. Host-browser access, public links, tunnels, reverse proxies, port remapping and `localhost` substitutions are unsupported. Do not run `tools/empire_catalogue_server.py` directly on the host. Do not use its synthetic-test constructor escape for provider resources.

## 5. Launch the graphical review

```bash
sudo -v  # only when authorised; this does not grant missing privileges
npm run demo:empire -- --zip '/private/path/empireofgold.zip'
```

`demo:empire` invokes `bash scripts/verify_empire_isolated.sh --interactive`. It launches its own headed Playwright Chromium and the local server. **Use that browser only.** Close its browser or interrupt the launcher to stop the session. No ordinary-browser or externally hosted Empire review path is supported. If there is no display, use the headless verifier instead; do not run an unconfined browser.

### Automated headed reviewer QA (optional, not a benchmark)

On a machine with an approved accessible display:

```bash
npm run verify:empire -- --zip '/private/path/empireofgold.zip' \
  --interactive-smoke --output evidence/derived/empire-headed-reviewer-qa.json
```

Despite its historical flag name, this now runs five reviewer-QA scenarios. For a headless Linux host with Xvfb/xauth installed, prefix that command with `xvfb-run -a`. The browser and server still run together inside the namespace; display access must survive local sudo policy. Do not change privilege/firewall rules merely to make this check run. The report labels capability/offline interventions SIMULATED, records source hashes, and leaves human/physical-device/provider acceptance UNKNOWN. Screenshots are private generated lobby/failure UI only. Run serially, never beside a benchmark.

### Walkthrough and expected contracts

Source contracts are **STATICALLY-INFERRED** except where the [measurement report](EMPIRE-MEASUREMENT.md) records an automated **MEASURED** check. Human review remains pending.

1. **Initial state:** twenty fixed cards; all **SIMULATED identities of the same Empire build**. Authorization UNKNOWN; speculative requests off. Covers/names do not imply distinct provider games.
2. **Fail closed first:** choose Denied, then Error, and try a card. No provider iframe should appear. A real exclusion check has not occurred in any state.
3. **Grant sandbox fixture:** select Granted. With speculation off, authorised selection can launch normally within the isolated browser. Grant does not signify real-user eligibility.
4. **Opt in:** enable “Allow speculative asset requests.” Use “Top three + hover / keyboard focus” and the synthetic popularity policy. Observe reservation/consumed-body counts and trace. Counts are preparation accounting, not cache hits.
5. **Intent:** dwell over or keyboard-focus another card. **SIMULATED configured dwell: 220 ms.** Policy changes should leave card order, style and focus unchanged. Favourites may have no candidates: no provider accepted-input hook exists, so launches do not automatically record plays.
6. **Launch:** select a card. Speculation stops/drains and authorization is checked again before provider attachment. The wrapper loads the unchanged document using English configuration; it does not force or prove actual provider texture tier.
7. **Read states literally:** wrapper handshake, provider `src` assignment, canvas presence, eight early responses and dependency failures are distinct. None is a gameplay-ready signal. Provider accepted input and actual tier remain UNKNOWN.
8. **Revoke:** use “Revoke sandbox access.” The active frame/dialog should be removed. Returning to the lobby must not require continuing gameplay. Bytes already transferred cannot be withdrawn.
9. **Explore costs:** choosing an unprepared identity may miss despite costs for alternatives. Incomplete preparation, missing network capability or exhausted budget should not be relabelled as a successful warm.
10. **Review accessibility:** Tab/Shift+Tab, visible focus, activation, dialog exit/focus return, status announcements, reduced motion and readable mobile layout. Record what was actually observed; source tests or a virtual display do not establish full assistive-technology acceptance.

The configured proactive subset is **STATICALLY-INFERRED: eight real PRELOADER / partial COMMON resources, 523,940 decoded bytes per identity**. No proactive SPLASH/PRIMARY/SECONDARY. The reservation budget is **SIMULATED configuration: 10 MiB per visit**, cancelled attempts included; foreground provider traffic and other page resources are outside it. Maximum speculative concurrency is two through full-body consumption/draining.

The UI's English desktop `1x` manifest is statically selected. On mobile/unverified devices, preparation and its desktop milestone are disabled; normal authorised launch remains available in the isolated environment, with readiness UNKNOWN. Missing late dependencies, including `book.png`, are not patched. Their base-game effect is UNKNOWN; do not claim either a working game or guaranteed unplayability from that missing file alone.

## 6. Reproduce the headless experiment

Only the lead/reviewer designated to own the browser should run this. **Never run Empire/reference/cache verifiers concurrently.** Close the graphical review first.

```bash
sudo -v
npm run verify:empire -- --zip '/private/path/empireofgold.zip'
```

Current source defaults (**SIMULATED experimental configuration**, not measured results):

| Parameter | Default / meaning |
|---|---|
| `--runs` | `10`; accepts `1`–`20` pairs |
| `--dwell-ms` | `3000`; fixed browsing interval in both arms, accepts `0`–`15000` |
| `--horizon-ms` | `30000`; fixed post-click observation horizon, accepts `5000`–`30000` |
| `--output` | `evidence/derived/empire-provider-measurement.json`; use a local `.json` output path |
| Diagnostics | Included by default; `--no-diagnostics` prevents full required acceptance |
| Rendering | Headless Chromium; SwiftShader explicitly requested; not representative production GPU hardware |
| Cache / network | Cache enabled; unthrottled loopback; no preconnect, interception or control-only slowdown |

A short run uses `--runs 1`; it is not equivalent to the default coverage. `npm run verify:empire -- --help` displays options, but the shell wrapper still requires its non-root Linux tool prerequisites before handling help.

The runner counterbalances CONTROL/TREATMENT order across pairs and starts a fresh browser and server for each arm. Both receive the same browsing interval and simulated authorization; only treatment enables preparation. **Do not wait for warm completion only in treatment**, reuse a profile, reload to manufacture “cold,” disable cache in DevTools, rewrite URLs or route requests with Playwright.

Required diagnostics: wrong-title cold miss, server-side `no-store`, keyboard-focus intent, fail-closed states and live revocation. Do not use a `no-store` or routed diagnostic as a normal cache benchmark. Every attempted pair, including failures/out-of-tolerance observations, must remain in the report.

### What the verifier measures

- **Milestone:** app launch-handler click epoch to all eight exact provider-document CDP `Network.loadingFinished` events within the fixed window. The input is a **SIMULATED DOM button click**, identical across arms, not accepted provider input.
- **Cache proof:** all exact resources prepared before click, matching provider-document completion/cache attribution, corroborating selected early-body server deltas, clean control and negative controls. Timing gain need not be positive to prove cache reuse.
- **Bytes:** server socket-accepted response-body bytes, **not packet-level wire bytes or total page transfer**. They exclude headers and lobby/wrapper/cover resources; provider traffic outside the early batch can still contribute to broader counters.
- **Important field caveat:** `launch` and `selectedLaunch` are **pre-dispatch-snapshot-to-sample** deltas, not exactly click-separated bytes. The snapshot/click gap and independent sample timing/overruns must be reported. Do not simplify these to exact click-to-launch network savings.
- **Costs:** report preparation, selected/unselected preparation, observation-period provider bytes, total observed session body cost, cancellations/failures and unused-within-this-selection bytes. Unselected preparation is not necessarily wasted forever.
- **Statistics:** median/range and paired differences only for proof-qualified timing-valid pairs, alongside all attempted/excluded counts. Negative differences are regressions, not errors to discard. Browser version, release digest, device scope, source identity, run count and conditions must accompany every result.

Current runner exit semantics: `0` for required proof PASS; `1` for FAIL; `2` for INCONCLUSIVE. Startup/argument/confinement errors may exit nonzero before a report exists. A successful unit suite is not any of these browser verdicts. Human visual acceptance and provider gameplay remain separate even after a PASS.

## 7. Evidence handling

- Default aggregate output: `evidence/derived/empire-provider-measurement.json`.
- Raw, body-omitted HARs: generated `evidence/private/empire-*/` directories. **Still private**: body omission does not remove headers, URLs, identifiers or other metadata.
- Restricted early-resource redacted HAR exports: generated `evidence/derived/empire-*/` directories. These are scoped exports, not complete public provider traffic. Redaction/permission review is mandatory before display or sharing.
- The runner also records source hashes/base revision and marks integration changes; that does not freeze a commit or prove later source equivalence.
- [EMPIRE-MEASUREMENT.md](EMPIRE-MEASUREMENT.md) records actual artifacts, incomplete work and limitations. Do not copy measurements from Vault Match, historical repeat HARs or another browser experiment.
- A narrowly reviewed Playwright 1.55.1 cached-response negative-body-size quirk is preserved as numeric provenance; the standard body-size field becomes UNKNOWN, not zero. See the measurement report. Neither HAR zero transfer nor this handling establishes cache attribution.

## 8. Troubleshooting without weakening the boundary

| Symptom | Safe next action |
|---|---|
| `sudo -n` failure / missing `unshare` or firewall permission | Ask the authorised administrator; use code review/reference mode if unavailable. Do not edit guards or run the full process as root |
| Missing Chromium/system libraries | Install the pinned browser/dependencies before isolation, then retry via the wrapper |
| No display / Chromium cannot open a window | Use `verify:empire`; graphical acceptance remains pending. Do not paste the URL into another browser |
| Archive missing, wrong hash, inaccessible or changed | Obtain the exact approved private input; restore access without modifying provider data or pin |
| Confinement/probe/process-attestation refusal | Stop; have the lead inspect the supported environment. Never treat refusal as an invitation to disable the check |
| Port conflict in an isolated run | Stop the owned session and investigate lifecycle; do not remap benchmark origins or kill unrelated processes |
| Preparation blocked on device/network capability | Expected conservative fallback: allow only normal authorised launch; do not fabricate a fast connection or force `1x` |
| Missing atlas/late resource / no authoritative input | Preserve the failure and UNKNOWN readiness; never patch the provider or infer gameplay from canvas |
| Inconclusive batch/timing or slower treatment | Retain it and report it; no cherry-picking, fake slowdown or selective timing window |
| Reviewer cannot receive private ZIP or use Linux isolation | Record the Empire blocker. The separate reference demo is useful but cannot satisfy it |

## 9. Separate original reference demo

```bash
npm ci
npm run demo
```

Open `http://127.0.0.1:8095/` normally. Optional `--port 8096` is supported by this **separate reference server only**, not the Empire pin/port contract. `npm run verify:demo` verifies this original reference implementation, separately and serially. Its original memory game, generated fixture identities and accepted card input are not Empire gameplay. Keep all reports and labels separate.

## 10. Before submission

Resolve [submission status](EMPIRE-SUBMISSION-STATUS.md) and the [pre-submission audit](PRE-SUBMISSION-AUDIT.md): team identity/lead/ownership, permissions (including AI/resource use), tested read-level reviewer access and archive delivery, complete actual evidence, required demo material, clean-clone reproduction, secret/prohibited-data/history review, final commit identity and organiser form/declarations. A documented or implemented plan is not a submitted product.
