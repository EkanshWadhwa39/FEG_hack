# Architecture — Vault + unchanged Empire integration

## Scope and evidence vocabulary

This is a **web-only local sandbox** for FEG Challenge 3. Judging targets the sandbox, not staging. It tests whether governed lobby requests can prepare exact resources for the selected unchanged provider iframe through the browser's own HTTP cache. It is not a native SDK, service worker, custom cache, provider rewrite or production deployment.

Unless explicitly attributed to a report, implementation statements below are **STATICALLY-INFERRED from source inspection**, not browser acceptance. Catalogue/policy/authorization/limit fixtures are **SIMULATED**. Runtime observations become **MEASURED** only for the named run. **FEG-PROVIDED** denotes supplied requirements/resources, not our own experiment. Missing provider input/tier, current integrated performance and real-world effects remain **UNKNOWN**. Scoped completed checks, retained failures and in-progress experiment status are recorded in [EMPIRE-MEASUREMENT.md](EMPIRE-MEASUREMENT.md).

## Data and control flow

```text
Authorised reviewer + privately provisioned, pinned ZIP (read-only)
   |
   +-- npm run demo:empire  --> headed Chromium + server
   +-- npm run verify:empire --> serial headless Chromium/server arms
                 |
      sudo/unshare: new Linux network namespace
      IPv4 OUTPUT deny except approved loopback TCP + replies; IPv6 deny
      drop execution back to invoking non-root user; proxy env removed
                 |
      lobby 127.0.0.1:8100 (Vault operator controls + fixed catalogue)
                 |
      SIMULATED authorization grant + explicit opt-in + supported variant
                 |
      candidate policy -> top-three / hover / keyboard-focus scheduler
                 |
      manifest / governor / bounded requester
      exact URL, credentials omitted, readable CORS, redirect rejection
                 |
      ordinary browser HTTP cache (reuse NOT assumed)
                 |
      user selection -> cancel/drain speculation -> recheck fixture
                 |
      observing wrapper on selected origin 8101..8120
                 |
      unchanged provider document /?language=en, same origin as wrapper
                 |
      early-resource observations / canvas / failures (NOT accepted input)
```

A separate `npm run demo` path serves the original Vault Match reference scene on localhost. It has synthetic generated content and its own input milestone; it never supplies evidence of Empire gameplay.

## Component boundaries

| Component | Responsibility | Deliberate boundary |
|---|---|---|
| `prototype/empire-demo.html`, `src/empire-demo.js` | Fixed-order catalogue, operator controls, lifecycle, launch/revocation, result labels | Does not change provider code or display predictor recommendations |
| `src/empire-catalogue.js` | Validate exact release/build, identity, English/`1x` manifest, stage/size/digest metadata | Desktop support gate is not proof of provider-selected tier |
| `candidate-policy.js`, `content-demo-policy.js`, `content-demo-scheduler.js`, `catalogue-bindings.js` | Synthetic candidate order and top-three/intent scheduling | No policy-driven player card order/style/focus changes |
| `content-loader.js`, `manifest.js`, `warmer.js`, `governor.js` | Authorization, exact target resolution, budget, foreground admission, cancellation and bounded work | No speculative SECONDARY; unsupported safety conditions block speculation |
| `bounded-browser-requester.js` | Exact URL/origin allowlist, `credentials: omit`, `cache: default`, `redirect: error`, full-body consumption with timeout/cancellation | Response completion is not cache-residency proof; maximum two active speculative requests includes draining |
| `content-adapters.js` | In-memory authorization fixture and live browser capability readings | No real identity, exclusion register, session API or production credentials |
| `empire-player.js`, `empire-milestone.js` | Separate same-origin wrapper observation; validate launch/source/origin/message scope and bounded fields | No provider request monkey-patching, synthetic gameplay input or invented readiness |
| `tools/empire_catalogue_server.py` | Read private ZIP in place; exact allowlisted serving; release/confinement checks; aggregate counters | No extraction/copy/patch, no proxy, no public service or raw request logs |
| `scripts/verify_empire_isolated.sh`, `tools/verify_empire.mjs` | Network isolation, launch lifecycle, serial experiment and diagnostics | Do not run the provider directly on the host or in an ordinary browser |
| `empire_measurement.mjs`, `empire_launch_checks.mjs`, `redact_empire_har.mjs` | Proof criteria, process-attestation checks and limited evidence export | Unit tests are not end-to-end kernel/browser acceptance; raw HARs remain private |

`prototype/` fills the organiser's source-code directory role. Python tests are in `tests/`; JavaScript tests in `prototype/tests/`. The integration retains the shared safety core and distinct existing team/reference surfaces; this package does not authorise replacing Hansika's sandbox/player/visualizer or merging other branches.

## Stable synthetic deployment identities

**SIMULATED configuration:** lobby port `8100`; `title-01` through `title-20` map to distinct origins `http://127.0.0.1:8101` through `:8120`. They all read **one supplied Empire of Gold build**, not twenty distinct titles/providers. Display names and generated covers are synthetic and are not production asset identifiers.

The launcher/server pin the private release SHA-256 documented in the [reviewer guide](EMPIRE-REVIEWER-GUIDE.md). Build metadata derives from that digest. URLs are the unchanged consumption paths on stable sandbox origins; browser code neither invents version queries nor strips/reorders existing query strings. Supplied query-bearing foreground paths remain query-bearing requests. The archive is read in place and changes are rejected. Never replace a release under a live browser cache or remap ports for a benchmark; a new release needs an explicitly reviewed identity strategy and fresh profiles.

### Exact proactive subset

**STATICALLY-INFERRED from the reviewed manifest; sizes are decoded body bytes, not measured wire savings:**

| Stage | Resource relative to the selected instance origin | Bytes |
|---|---|---:|
| PRELOADER | `assets/locale/en/gameContent.json` | 3,997 |
| PRELOADER | `assets/locale/en/commonContent.json` | 14,865 |
| PRELOADER | `assets/fonts/en/Mulish.ttf` | 210,380 |
| PRELOADER | `assets/images/@1x/brandLogo.png` | 10,611 |
| COMMON (partial) | `assets/fonts/en/NewRocker-Regular.ttf` | 168,128 |
| COMMON (partial) | `assets/fonts/en/Oswald-Bold.ttf` | 87,600 |
| COMMON (partial) | `assets/images/@1x/controlPanelPrimaryAssets.json` | 1,633 |
| COMMON (partial) | `assets/images/@1x/controlPanelPrimaryAssets.webp` | 26,726 |
| **Total** | **Eight real resources per synthetic identity** | **523,940** |

Only the English desktop `1x` subset is declared. Locale is passed to the original launch document; the provider still chooses its actual device tier. Actual tier remains UNKNOWN until observed. Mobile/unverified-device speculation and the desktop early-batch milestone are disabled; ordinary authorized launch remains available **inside the same isolated launcher**, not via a separate host browser.

SPLASH, PRIMARY, SECONDARY and bootstrap code are not proactively fetched by this subset. The unchanged provider can fetch additional assets during foreground launch. Historical package audit identifies unresolved atlas pages and a missing late `book.png`; missing late content is not proof either of playable or unplayable base gameplay. No resources are repaired or substituted.

## Safety and lifecycle

- Authorization starts UNKNOWN and consent off. Only an explicit SIMULATED grant permits warming/launch; denial, errors, timeout/malformed adapter outcomes and unresolved targets fail closed. Authorization must never be cached or raced by a future real adapter.
- **SIMULATED configured limits:** a 10 MiB visit reservation ceiling, including cancelled attempts; at most two concurrent speculative requests; hover/keyboard dwell of 220 ms. This is not a total-provider-download or total-session-network cap.
- Hidden pages, Save-Data, slow/unknown network capability, busy foreground work, revoked authorization, disabled consent and exhausted budgets stop/block speculation. Long-task observation is optional; its absence does not prove absence of contention.
- Selection cancels/drains speculative workers before foreground admission and rechecks authorization. Revocation removes active frames and stops further eligible work; it cannot undo bytes already transferred.
- Navigation/restoration resets the fixture and consent rather than silently inheriting permission. Launch-scoped messaging rejects stale/wrong-source observations.
- No accepted provider input hook exists, so automatic provider play history is not recorded. The favourites policy may have no candidates. It must not be populated by treating load/canvas/early-batch events as play.

## Serving and confinement

The wrapper creates a fresh **network namespace, not a new filesystem/container sandbox**. Its firewall permits only IPv4 TCP to `127.0.0.1:8100`–`:8120` and corresponding established replies; IPv6 OUTPUT is dropped. It does not alter the host firewall. Server/browser run non-root. The runner checks loopback-only interfaces, an unreachable external test destination, an unapproved loopback-port negative and process confinement; the server independently validates confinement and the release before binding.

The test-only Python constructor escape is for synthetic archives, rejects the pinned provider release and is not a reviewer execution path. Confinement is not a defense against a malicious administrator or arbitrary tool-code modification. No public tunnel, ordinary browser, external provider endpoint, Playwright route interception or host-server shortcut is supported.

Sandbox response policy is explicit: identity encoding; cacheable successful static responses use `public, max-age=3600`; HTML/wrapper/config/statistics/error responses are `no-store`; controlled `no-store` diagnostics are separate from normal runs. CORS and Timing-Allow-Origin permit the exact lobby origin. CSP and response-header sandboxing are defense in depth, not complete network confinement. Provider compatibility requires inline/eval script allowances in its restricted origin; the lobby has a stricter policy. These are local hosting decisions, not discovered production headers or proof of production permission/cache reuse.

## Observation, accounting and proof

The UI wrapper reads the original document's Resource Timing and reports exact response completion, canvas presence and dependency failures separately. Wrapper readiness means its handshake is ready; provider-mounted means `src` assignment; neither means loaded, playable or input-accepted. The wrapper has a bounded observation window and may miss timely observations when the renderer is busy.

The automated verifier instead uses provider-document CDP `Network.loadingFinished` events, bounded by the application launch-handler click epoch and a fixed observation window. A scripted DOM `button.click()` triggers that handler in both arms; it is not a human gameplay action. The runner records clocks, overrun and browsing tolerances; ambiguous/incomplete batches stay UNKNOWN.

Server counters measure **socket-accepted body bytes, excluding HTTP headers**, not peer-consumed bytes or packet-level traffic. They include provider responses outside the early subset but exclude lobby/wrapper/cover resources. Fields named `launch`/`selectedLaunch` use a **pre-dispatch snapshot-to-independent-sample** boundary, not an exact click-separated byte interval. See the [reviewer guide](EMPIRE-REVIEWER-GUIDE.md) and [measurement report](EMPIRE-MEASUREMENT.md) before quoting them.

A reuse claim requires exact selected resources prepared before click, provider-document cache attribution, matching response completion and corroborating absence of selected early-body server transfer, with clean control and negative controls. Positive timing improvement is not required for a cache-proof PASS; regressions must be retained. Prewarming bytes are real cost, not free savings.

## Deployment assumptions and open gates

No external runtime API, database, live player data, production login or online provider service is configured. The only proprietary runtime input is the approved private ZIP. Library/browser installation occurs before isolated execution. Human graphical acceptance, serial integrated evidence, clean-clone reproducibility and archive/access permissions remain pending. Future real-site rollout requires approved exclusion authorization, exact URLs/credentials/cache/CORS/partition behavior, observed device/locale, authoritative input acceptance and safety/business validation. Sandbox-only judging does not waive confidentiality or the organiser submission rules.
