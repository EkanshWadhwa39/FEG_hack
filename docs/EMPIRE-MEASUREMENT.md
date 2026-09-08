# Empire integration — measurement and reviewer acceptance

**Current status: IN PROGRESS. Not a frozen or submitted result.** The ten-pair acceptance experiment is running serially; its partial aggregate must not be presented as a completed verdict. Human visual/screen-reader acceptance, authoritative provider accepted input and the actual chosen provider texture tier remain **UNKNOWN**.

## Acceptance hold — source audit findings

**Acceptance is blocked independently of the running report's computed verdict.** Read-only source audits identified four current verification gaps. These are possible false-positive verification results, not observations that the active experiment encountered them or evidence of an authorization/confinement bypass:

1. Wrong-title/no-store diagnostics do not require exact completed pre-click preparation.
2. Live revocation can occur after outer-wrapper creation but before provider activity is established.
3. Successful redacted HAR export does not establish evidence coverage: empty, wrong-title-only, preparation-only or incomplete exports can accompany an otherwise passing CDP/server proof. Add a separate runner gate requiring successful observations of all eight exact selected launch URLs within the measurement window, plus selected preparation completed before click for positive treatment. Keep the redactor's filtering semantics separate from experiment acceptance.
4. Positive treatment proof does not exclude additional pre-click provider document/bootstrap/later-resource loading. Current CDP recording ignores non-manifest requests. Require aggregate preparation requests to equal early requests and timestamped, redacted classification of all provider requests through the actual click boundary, including the pre-dispatch-snapshot gap. Reject non-eligible pre-click provider traffic; matching selected early reuse alone is insufficient.

Each repair needs regression tests and fresh isolated evidence. The second audit's delivered result was truncated after its second finding; no additional reviewer-report finding or complete audit sign-off is inferred.

The running experiment is being preserved without changing its source or running concurrent browser/tests. Retain every attempt. Even a computed PASS from this source must not be published as complete acceptance. After this run terminates, repair the diagnostics with regression tests, then collect fresh isolated evidence tied to the repaired source; do not pool different source revisions.

The automated headed QA also has narrower coverage than human acceptance: short-window capability checks, a reduced-motion preference check rather than full motion evaluation, and an offline-to-denied recovery check rather than successful online provider recovery. `providerExecuted: false` is a reported assertion, not an independently measured execution flag. Catalogue-markup equality and fixed preparation counts can produce false failures when thumbnail settlement or governor deferral differs.

## Scope and identity

- Private branch `integration/empire-catalogue`, uncommitted integration over `fc058cd66960c45c31fdb113a9d3c75c106147c1`. Main/team/content-core branches are not merged or overwritten.
- One unchanged supplied Empire archive; SHA-256 is pinned in the reviewer guide. Twenty catalogue identities, authorisation, candidate policy and demand are **SIMULATED**, not twenty distinct games or a real exclusion-register check.
- Browser **MEASURED:** Playwright 1.55.1 / Chromium 140.0.7339.186 on this Linux x86-64 host. The isolated launcher currently resolves Node 18.19.1; this is a tested runtime observation, not a recommendation to deploy an unsupported Node release. Reviewer setup recommends Node 22 LTS; its clean-clone validation is pending.
- Network is confined to approved loopback origins; no external provider calls, request interception, service worker, custom response cache, provider edits or artificial control-only latency.
- Manifest **STATICALLY-INFERRED:** eight PRELOADER / partial COMMON assets, 523,940 decoded bytes per identity. No proactive SPLASH/PRIMARY/SECONDARY. Desktop English `1x` subset only; this is not authoritative provider-tier observation.

## Fresh completed checks

These are **MEASURED working-tree observations**, not final-commit reproduction:

| Check | Result / boundary |
|---|---|
| `./scripts/check.sh` | 458 Python + 584 JavaScript tests passed; Python lint, JavaScript syntax (84 files), shell lint passed |
| `.venv/bin/python tools/measure_har.py --help` | Passed without HAR input |
| `PORT=8188 BIND=127.0.0.1 ./scripts/serve.sh` and bounded GET `/index.html` | Passed; server stopped; no browser/provider execution |
| Isolated headed `--interactive-smoke`, via Xvfb | PASS; five reviewer-QA scenarios below; not human visual acceptance |

Local generated reports: `evidence/derived/empire-headed-reviewer-qa-final.json` (run `empire-1788885659890`) and `evidence/private/empire-check-final.log`. Raw/generated artifacts remain ignored, not silently bundled in Git. A reviewer needs approved access or must regenerate them.

Headed QA checked:

1. Initial UNKNOWN/off state; UNKNOWN/DENIED/ERROR prevent provider requests and mounting; keyboard activation restores focus. Policy changes preserve catalogue markup/focus. Real top-three preparation completes 24 bodies (1,571,820 bytes); focus on a fourth identity brings the count to 32; reload resets consent/authorization.
2. Mobile emulation at 390×844 and reduced-motion preference: no desktop preparation, no horizontal overflow. Not physical-device validation.
3. **SIMULATED** missing network capability prevents speculation.
4. **SIMULATED** Save-Data prevents speculation.
5. **SIMULATED** offline wrapper timeout removes the iframe; Escape restores card focus; a subsequent denied launch stays closed.

Provider code was not executed in this QA suite. Private screenshots show lobby and failure UI only; automated screenshots do not establish human design or screen-reader approval. The actual provider is executed separately, confined, in the paired experiment.

## Running acceptance experiment — results pending

```bash
npm run verify:empire -- --zip '/private/path/empireofgold.zip' \
  --output evidence/derived/empire-ten-pair-acceptance.json
```

**SIMULATED experimental configuration:** ten serial counterbalanced pairs; fresh browser/server per arm; identical 3,000 ms browsing interval; fixed 30,000 ms post-click observation horizon; unthrottled loopback; SwiftShader requested. Tolerances are fixed in the source/report, not adjusted after results. Required wrong-title, no-store, keyboard-focus, fail-closed and revocation diagnostics follow the pairs. No other browser experiment runs concurrently.

Run ID `empire-1788885685401`. The aggregate includes source/dependency digests and runtime identity. All attempts, incomplete observations and regressions must remain. Final acceptance, timing estimates, negative-control verdicts and cost totals: **UNKNOWN until this run finishes and is reviewed**.

Measured milestone is the app launch-handler epoch to the completion of all eight exact provider-document CDP network requests. It is not gameplay readiness. `launch` / `selectedLaunch` counters span the **pre-dispatch snapshot to the independent sample**, not an exact click cut. Report that gap and sampling tolerances. Server body counters are socket-accepted response-body bytes, not wire bytes or total browser bandwidth. Preparation of unselected titles must be included in cost reporting.

## Retained calibration failures — not acceptance evidence

These generated reports remain intact. They are different source revisions/conditions and must not be pooled into the new experiment:

- `empire-preflight.json`: failed/incomplete early observation.
- `empire-resume-calibration.json`: incomplete early batches.
- `empire-resume-calibration-30s.json`: an older complete pair, without the current required acceptance verdict/diagnostics. Not final proof.
- `empire-final-calibration.json`, `empire-final-calibration-2.json`: both arms failed during guarded startup; no positive provider result.
- `empire-final-calibration-3.json`: CONTROL reached the early milestone; TREATMENT also observed early completion and zero selected early server bytes, but HAR export failed. Required proof **FAIL**. Do not salvage this into a passing report by editing the artifact.
- The first headed command without a graphical display refused startup as designed. Subsequent Xvfb runs passed; Xvfb does not provide human acceptance.

The guarded-startup repair handles empty procfs namespace links like inaccessible links and requires a readable distinct ancestor plus every existing confinement check. It does not disable namespace verification.

### Reviewed HAR exporter quirk

The last failed calibration exposed a Playwright 1.55.1 exporter calculation: `_transferSize=0` with positive reported `headersSize` produces `bodySize=-headersSize`; its compression calculation also uses that invalid negative size. The redactor now recognises only this exact reviewed exporter/pattern:

- Standard HAR `bodySize` becomes **UNKNOWN (`-1`)**, never fabricated zero.
- Original negative body size is preserved as numeric `_empireExporterBodySize`.
- Matching exporter compression is preserved as `_empireExporterCompression`, not represented as valid standard compression.
- `_transferSize` remains the original reviewed numeric observation. Neither it nor the correction infers cache reuse.
- Unreviewed exporters, arithmetic near misses and malformed input still fail closed. No raw HAR is modified. Output is newly created with restricted permissions; exact allowed early URLs and whitelisted fields only.

The export summary counts affected entries. Cache attribution still requires independent exact provider-document CDP evidence, preparation-before-click and server/body corroboration. Restricted HAR exports contain only the early subset, not the complete launch; redaction is not redistribution permission.

## Remaining gates

Finish and review the full experiment; reconcile any audit findings without mixing source revisions; obtain human graphical/accessibility review in an approved environment. Then complete reviewer-access, private-archive delivery, licensing/AI-use, secret/history, clean-clone and final-commit gates in `PRE-SUBMISSION-AUDIT.md`. Do not equate a cache-proof PASS, if obtained, with submission approval or production behaviour.
