# Content core — scoped measurement and reproducibility

## Synthetic browser-cache check

**MEASURED**, on a **SIMULATED workload**. Source core: `104e503`; runner:
`tools/verify_content_core.mjs`. Safe report: `evidence/derived/content-core.json`.
Experiment ID: `2026-09-08T10-30-03-817Z`.

Scope: headless Chromium **136.0.7103.25**, Linux host, **three isolated
CONTROL/TREATMENT pairs**, one benchmark title (`title-01`), same loopback origin
parent and iframe. Fresh browser process/context per arm; alternating arm order;
service workers blocked; no routing; browser HTTP cache enabled. No network or CPU
throttle. Fast-network governor values and authorization are explicitly synthetic
fixtures, NOT measured navigator capabilities or a real exclusion check. Browsing
window is the same **SIMULATED one second** in each arm. Only the preparation policy
differs (OFF vs POPULAR_UNPLAYED).

### What the measurements support

**MEASURED in every pair:** CONTROL makes three asset-server requests after click;
TREATMENT makes those three before click and zero at launch. Each arm consumes
114,688 decoded fixture body bytes at launch. Resource Timing launch transferSize
sums are 115,588 for CONTROL and zero for TREATMENT; treatment entries retain
positive encodedBodySize. Exact URLs are passed unchanged from the resolved plan.
Those Resource Timing sizes are NOT packet-capture wire-byte measurements.

**MEASURED cost:** treatment reserves and observes 114,688 preparation body bytes.
Total-session asset-server request count is three in BOTH arms: this moves work
before click, not an overall bandwidth saving. A wrongly predicted title would
spend speculative bytes without this matching-title launch benefit.

**MEASURED timing, milliseconds:**

| Pair | Control click → bodies complete | Treatment click → bodies complete | Control iframe body-fetch interval | Treatment iframe body-fetch interval |
|---|---:|---:|---:|---:|
| 1 | 73.5 | 62.9 | 12.1 | 7.2 |
| 2 | 75.6 | 64.3 | 14.4 | 7.5 |
| 3 | 72.8 | 64.7 | 11.9 | 7.4 |

Median click-to-bodies-complete: **73.5 ms**
CONTROL vs **64.3 ms** TREATMENT. This includes
runner polling, iframe navigation and cross-process orchestration. Tiny local
samples and shared-host effects do NOT justify a robust speedup claim. The stronger
result is observed same-key cache reuse and shifted launch transfer.

The milestone is **asset response bodies consumed**, not first paint, player input,
certified game startup or playable. No provider bundle runs in this experiment.
**UNKNOWN:** authoritative interactive time, six-second provider target, real CDN
partition/Vary/credential behavior and catalogue-wide effects. Do not present these
sub-second synthetic timings as proof of a sub-second game launch.

### Functional/negative checks

**MEASURED:** all twenty synthetic identities completed their three preparation
requests and resolved their exact authorized click plan; sixty objects and 2,293,760
body bytes were accounted for. This is NOT twenty provider games rendered/played.
Nineteen SVGs decoded and the deliberately missing twentieth used isolated text
fallback. HTTP unit tests additionally validate all twenty healthy SVG fixtures.
Policy toggles left DOM order unchanged; denial prevented the launch callback and
new asset requests. Distinct-title exact-key miss, repeated no-store transfer
(exactly two timing entries required) and redirect rejection passed.

## Existing unchanged-provider boot diagnostic (not a cache benchmark)

A separate **MEASURED diagnostic**, retained in the original working tree at
`/home/ubuntu/FEG_hack/evidence/derived/content-session-provider-boot.json`, observed
Empire of Gold / SpinIQ in three fresh Chromium boots. It used existing local ZIP
probe tooling with no-store/routing/CSP, blocked external requests, no throttle and
unmodified supplied archive bytes. That routing disables cache; NEVER compare this
against the synthetic treatment above or call it a production cold baseline.
These existing diagnostic files are not imported into this content-only branch.

**MEASURED diagnostic ranges:** canvas attachment 312.8–448.9 ms; DOMContentLoaded
321.2–459.4 ms; window load 451.3–606.1 ms. Completed encoded resource bytes were
46,750,945–52,697,593. In the first two runs, last completed resources arrived around
19.7 seconds and approximate total blocking time was 19.1–19.3 seconds. The third
run had runtime errors and an earlier final resource completion; it is not evidence
of a faster successful boot. `book.png` returned 404 in every run.

**STATICALLY-INFERRED conclusion:** early visual events do not describe the later
loading/main-thread bottleneck. Browser caching cannot eliminate provider CPU work
or repair a missing asset. **UNKNOWN:** authoritative provider input acceptance; no
click anchor or accepted-input signal was recorded. No provider patch, replacement
asset or optimistic playable label was introduced.

To repeat that separate diagnostic in the original working tree (private ZIP stays
local), use its existing tools; do not run it concurrently with cache experiments:

```bash
cd /home/ubuntu/FEG_hack
node tools/probe_local_game.mjs \
  --zip 'FEG Innovation Hackathon 2026/empireofgold (1).zip' \
  --runs 3 --observe-ms 20000
```

## Reproduce the content check from this branch

```bash
./scripts/bootstrap.sh
npx playwright install chromium
./scripts/check.sh
# Default: three serial pairs; starts/stops its own loopback fixture server.
npm run verify:content
.venv/bin/python tools/measure_har.py --help
# Optional manual serving, not UI integration:
npm run serve:content
```

The runner preserves raw HARs in a **new ignored** directory per experiment under
`evidence/private/content-core/<experiment-id>/`. Do not commit or display raw HARs.
The committed report has synthetic labels/IDs and safe aggregates only: no request
URLs, cookies, tokens, Authorization headers, player identifiers or payloads.
An earlier test-runner attempt failed because CSP rejected Playwright's string-eval
wait helper; that attempt produced no accepted report. Final runs retain CSP and
poll using direct evaluate calls; there is no unsafe-eval or cache-disabling routing.

## Remaining integration and release gates

The existing HTML/CSS/player UI is intentionally untouched. The UI owner must wire
`bindContentLoading`, explicit variant/opt-in/operator policy controls and a normal
foreground loader that honors `grant.signal`; see `CONTENT-CORE-HANDOFF.md`.
Reference-scene input readiness and provider gameplay remain separate. No real
provider initialization was optimized, and no readiness claim was manufactured.

This is an integration handoff, **not a submission/freeze approval**. Complete the
original workspace's current `docs/PRE-SUBMISSION-AUDIT.md` against the intended
final merged commit, including organizer DOCX, reviewer access, security,
documentation, evidence and clean reproducibility. The sandbox evaluation does not
depend on staging; later real FEG deployment still requires approved contracts.
