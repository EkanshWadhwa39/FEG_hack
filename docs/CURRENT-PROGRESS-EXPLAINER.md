# Current progress explainer

## One-sentence description

We have built a **web-only, staging-ready prototype and evidence toolkit** for selecting a likely next game and safely preparing a small set of its static assets before launch, so the unchanged game iframe may reuse the browser's existing HTTP cache.

The full product has not yet been connected to staging or a real prediction source.

## 1. What is visible on the website

The current website is an **instrumented simulation dashboard**, not a playable casino lobby.

It demonstrates the decision process that would happen before prefetching.

### Visible controls

- Enable or disable prefetching.
- Choose a per-session byte budget: 1 MiB, 3 MiB or 5 MiB.
- Run a simulated warming operation.
- View the current India Standard Time.

### Visible decisions

The page displays:

- governor decision: `ELIGIBLE` or `BLOCKED`;
- selected locale and resolution, currently `hr-HR` and `1x` in the fixture;
- planned speculative transfer size;
- selected asset stages;
- warming lifecycle: not run, running, complete, blocked or failed.

### Assets represented in the demo

The synthetic manifest contains:

- PRELOADER;
- COMMON;
- SPLASH;
- critical PRIMARY;
- non-critical PRIMARY;
- SECONDARY.

The resolver allows only PRELOADER, COMMON, SPLASH and explicitly critical PRIMARY assets. It excludes non-critical PRIMARY and all SECONDARY assets.

### Useful website demonstration

With the default 3 MiB budget, the synthetic plan is eligible. Changing the budget to 1 MiB blocks warming because the planned transfer exceeds the budget. Disabling prefetch also blocks the operation.

This demonstrates that speculative downloading is governed rather than unconditional.

### Important limitation

The website currently injects a **simulated requester**. Clicking the button runs local asynchronous tasks, but it does not call `fetch()` or download provider assets.

The correct explanation is:

> This page demonstrates the policy, asset-selection and safety lifecycle. The real staging request adapter is intentionally not enabled until exact staging manifests and response policies are validated.

## 2. What exists underneath the website

Although the visible page is simulated, separate tested modules implement the intended orchestration boundaries.

### Exact manifest resolver

The resolver:

- requires an exact locale;
- requires an exact resolution tier;
- preserves complete URLs and version query strings;
- does not merge different variants;
- rejects malformed asset metadata;
- excludes SECONDARY resources;
- excludes non-critical PRIMARY assets.

Browser cache reuse depends on requesting the exact same URL that the iframe will later request.

### Resource governor

The governor evaluates:

- whether prefetching is enabled;
- Save-Data status;
- connection capability;
- page visibility;
- current byte consumption;
- per-session byte budget;
- planned asset size.

It degrades conservatively if browser information is missing or unknown.

### Bounded warmer

The warming engine:

- accepts only approved stages;
- limits concurrency to two;
- supports cancellation;
- prevents new work after cancellation;
- records failures without exposing asset details;
- does not claim that request completion proves cache admission.

### Real browser requester

A separate real request adapter exists. It:

- accepts HTTPS only;
- uses `credentials: "omit"`;
- rejects embedded usernames and passwords;
- rejects credential-like query parameters;
- uses the standard browser HTTP cache;
- supports controlled CORS and no-CORS behavior;
- never adds Authorization headers or cookies.

This requester exists, but it is not connected to the current visible simulation.

### Authorization sandbox

A tested authorization boundary ensures:

- authorization completes before manifest warming;
- denial, timeout and malformed responses fail closed;
- CONTROL sends no speculative requests;
- TREATMENT warms only after authorization and governor approval.

The visible page does not yet have a real exclusion-register integration. That requires staging.

### Connection preparation

There is also a governed connection-preparation module for anonymous DNS and preconnect hints. It has not produced a measured launch improvement, so its effect remains unknown.

## 3. The likely-next-game product direction

The intended full product includes a **candidate-selection layer**.

It would select one likely next game using approved signals such as:

- sustained hover or keyboard focus;
- game-details drawer dwell;
- recently played title;
- existing favourite;
- existing platform recommendation output.

The chosen candidate affects speculative asset requests only. It must not change game ordering, recommendations shown to the player, styling, focus or launch authorization.

After selecting one candidate:

1. Authorization succeeds.
2. The exact title build, locale and resolution tier are resolved.
3. The governor approves or blocks warming.
4. Safe bootstrap assets are prefetched.
5. The player selects the game.
6. The normal provider iframe launches unchanged.
7. The iframe may reuse cached assets.

### Current status of this layer

Candidate selection is currently a **design direction**, not a completed predictor. The existing website uses a fixed synthetic Empire of Gold-style manifest. It does not read player history, favourites or hover behavior to select among real games.

## 4. What the HAR measurement tool does

The privacy-safe HAR comparison tool is:

```text
tools/measure_har.py
```

It reports aggregate measurements without printing URLs, query strings, cookies, Authorization headers, player identifiers or request bodies.

### Measurement 1: full HAR span

This measures from the first recorded request until the last recorded request completes.

- Cold: **76.358 seconds**
- Repeat/warm: **16.253 seconds**
- Difference: **78.7% shorter**

This measurement includes sparse later fetch/ping activity.

### Measurement 2: exact 16-request asset milestone

This measures from capture start until the same exact 16 game-asset requests complete.

- Cold: **35.568 seconds**
- Repeat/warm: **6.714 seconds**
- Difference: **81.1% earlier**
- Ratio: approximately **5.3x**

For that selected batch:

- cold wire transfer: **716,931 bytes**;
- repeat wire transfer: **0 bytes**;
- all 16 repeat requests were marked as disk-cache hits.

Across the full capture:

- cold transfer: approximately **16.6 MB**;
- repeat transfer: approximately **12 KB**.

### What these measurements mean

They demonstrate that browser warm state can materially change network activity.

They do not prove:

- our prototype caused the difference;
- click-to-interactive improved;
- the game became playable in 6.7 seconds;
- launch was reduced from six seconds to one;
- staging or production behavior is validated.

The HARs do not contain click time or an authoritative input-accepted event.

## 5. What we proved with a real browser request

We ran a controlled local parent-to-iframe cache experiment using one unchanged **1,292,928-byte Empire of Gold static asset**.

### CONTROL

- Fresh browser process.
- No parent prefetch.
- The iframe requested the object.
- The origin served the complete object.

### TREATMENT

- Different fresh browser process.
- The parent completed a real `fetch()`.
- The iframe was created afterwards.
- The iframe requested the exact same object.

### Result

In 2/2 treatment runs:

- the iframe reused the browser HTTP cache;
- Resource Timing reported zero transfer;
- Chromium produced a cache marker;
- the local origin did not send the response body again.

Negative controls showed that changing the version query or using `Cache-Control: no-store` forced a network response, while the exact-URL treatment reused the cache.

### Evidence boundary

This proves that a parent page can fetch an exact static object and populate an HTTP-cache entry that a later iframe can reuse.

It does not prove full-game launch improvement, production cache policies, staging CORS behavior, other browsers or providers, or one-second interactivity. The local server used simulated cache and CORS headers.

## 6. What we learned from the Empire of Gold bundle

We safely analysed the hackathon-provided Empire of Gold package without committing its provider code or media.

The bundle establishes that:

- it uses an HTML entry point and ES modules;
- assets are loaded in stages;
- stage order includes PRELOADER, COMMON, SPLASH, PRIMARY and SECONDARY;
- locale and resolution tier affect selected files;
- version query strings matter;
- Spine assets may involve descriptors, atlases and multiple textures;
- no service worker was found.

### Runtime limitation

Static analysis found that the package dynamically imports `offline-data-DTb4NQY9.js`, which is absent from the supplied ZIP and appears related to offline/API behavior. A clean standalone full-game run is therefore not yet established. Any future local compatibility shim must be isolated, explicitly labelled and excluded from an unmodified-bundle benchmark.

## 7. What the presentation contains

The Round 1 presentation contains 12 slides covering:

- problem framing;
- both HAR timing definitions;
- warm-state opportunity;
- likely-next-game selection;
- safe asset preparation;
- simple system journey;
- major design decisions;
- current validation status;
- staging CONTROL/TREATMENT plan;
- A/B/C/D team split;
- delivery gates;
- honest Round 1 approval request.

It explicitly states that staging access is expected soon but not yet validated, full-title prefetch is pending, prediction hit rate is unknown, there is no six-to-one-second result, and there is no prototype-caused 86% improvement.

## 8. What happens when staging access arrives

### Environment validation

We must establish:

- exact game launch URL;
- exact title build;
- locale and resolution tier;
- CORS behavior;
- cache headers;
- credential mode;
- redirects;
- browser cache classification;
- authoritative input-accepted signal;
- exclusion-register behavior and timing.

### Isolated experiment

#### CONTROL

- Fresh browser state.
- Authorization succeeds.
- No proactive warming.
- Launch the target title.
- Record transfer, cache classifications and milestones.

#### TREATMENT

- A separate fresh browser state.
- The same browser, title, locale, tier and milestone.
- Authorization succeeds first.
- The prototype warms only the approved exact assets.
- Launch the same title.
- Record the same metrics.

### Product metrics

We should report:

- candidate prediction hit rate;
- useful warmed bytes;
- wasted speculative bytes;
- cache reuse;
- launch transfer reduction;
- asset milestone;
- authoritative input-accepted time, if available;
- cancellation and failure rates;
- browser, title, provider and run count.

Only after this experiment can we claim performance caused by our solution.

## 9. What has not been built yet

We do not currently have:

- a realistic PSK game lobby;
- a live user-game predictor;
- real favourites/history integration;
- full Empire of Gold prefetching;
- a clean playable Empire of Gold package;
- real exclusion-register integration;
- a staging manifest;
- staging CONTROL/TREATMENT results;
- production CORS/cache-policy validation;
- authoritative input-accepted timing;
- a measured six-to-one-second improvement;
- a production-ready player-facing feature.

## 10. Verification status

The current repository verification passes:

- **22 Python tests**;
- **38 JavaScript tests**;
- Python lint;
- JavaScript syntax validation;
- Shell lint.

Tests cover exact manifest handling, safe stage filtering, authorization ordering, governor decisions, byte-budget enforcement, maximum concurrency of two, cancellation, credential rejection, browser request behavior, connection hints, simulated UI lifecycle, cache-reuse controls and HAR aggregation.

## Concise presentation script

> We are solving game-launch delay by moving a small amount of safe network work before the click. The lobby selects one likely next game using signals such as hover, recent play, favourites or an existing recommendation. After mandatory authorization, a governor checks consent, connection and byte budget. It then requests only the exact preloader, common, splash and proven critical assets. We do not create a new cache or modify the game—the normal iframe launches unchanged and may reuse the browser's HTTP cache.
>
> Our historical HARs show two measurements. The full capture changed from 76.358 to 16.253 seconds, including later background traffic. The same exact 16-request asset milestone changed from 35.568 to 6.714 seconds, with the repeat batch transferring zero wire bytes. That demonstrates the value of warm browser state, but it was not caused by our prototype.
>
> Separately, we proved the mechanism locally: after the parent fetched one exact Empire of Gold asset, Chromium reused it in a later iframe in both treatment runs. The current website demonstrates the authorization, governor, manifest and fallback lifecycle using simulated assets. When staging access arrives, we will connect the exact manifest and run isolated CONTROL and TREATMENT launches to measure the real full-title benefit. We are not yet claiming a six-to-one-second result or production readiness.
