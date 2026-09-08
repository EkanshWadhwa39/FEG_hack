# Local parent-to-iframe cache-reuse evidence

## Result

**MEASURED — local, title-scoped diagnostic:** Chromium 136.0.7103.25 on Linux 7.0.0-1012-aws reused one unchanged 1,292,928-byte static asset from the FEG-provided Empire of Gold bundle between a completed parent `fetch()` and a later same-site, cross-origin iframe `fetch()`.

The experiment used Playwright 1.52.0, two fresh browser processes per condition, blocked service workers, and identical `GET`, CORS, omitted-credentials, default-cache requests to one exact versioned local URL. The local fixture server supplied **SIMULATED** cache/CORS headers (`public`, `max-age`, `immutable`, CORS allowed); they are not observations of production headers.

| Observation | Control run 1 | Control run 2 | Treatment run 1 | Treatment run 2 |
|---|---:|---:|---:|---:|
| Parent prefetch response-body bytes | 0 | 0 | 1,292,928 | 1,292,928 |
| Iframe-phase response-body bytes | 1,292,928 | 1,292,928 | 0 | 0 |
| Iframe Resource Timing `transferSize` | 1,293,228 | 1,293,228 | 0 | 0 |
| Browser cache marker on iframe request | false | false | true | true |
| Diagnostic resource duration (ms) | 20.3 | 19.8 | 4.1 | 4.8 |

All table values are **MEASURED** in this local experiment. Server bytes are response-body bytes, not HAR wire bytes. Durations are reported for completeness only; two loopback runs per condition are not a performance benchmark.

The private bundle was read directly from ignored storage and was neither extracted into the repository nor executed. The committed tool emits aggregate counters and browser cache booleans without URLs, headers, credentials, response bodies, or provider code. The full local aggregate is retained under ignored `evidence/private/` storage.

## What this proves

For this one asset, browser build, local header policy, topology, and two treatment runs:

1. each clean control iframe caused one full asset response;
2. each parent warm completed before iframe creation;
3. each treatment iframe received the full decoded object;
4. each treatment iframe caused no second origin request;
5. Resource Timing reported zero transfer; and
6. Chromium's response cache flag identified the iframe response as cached.

This closes the local browser-mechanism diagnostic. It does **not** close the production Gate 1 claim.

## What remains unknown

- Production PSK/provider CORS, CSP, CORP, COEP, cache, `Vary`, redirect, credentials, and partition behavior: **UNKNOWN**.
- Exact production manifest URL reuse: **UNKNOWN**.
- Exclusion-register latency and staging integration: **UNKNOWN**; authorization remains mandatory and fail-closed.
- Same-title launch transfer and authoritative input-accepted time caused by proactive warming: **UNKNOWN**.
- Other titles, providers, browsers, mobile web, and native behavior: **UNKNOWN** or out of scope.

## Comparison with prior manual HARs

The result is not directly comparable to the supplied historical cold/repeat HAR pair. Those captures covered a full production title and an already warm repeat state; this experiment isolates one local static object and tests whether the parent can create cache state reusable by an iframe. The measured 1,292,928-byte iframe-phase difference therefore neither reproduces nor contradicts the earlier approximately 16.6 MB versus 12 KB full-capture observation.

If staging differs, inspect exact URL identity, redirect targets, request mode and credentials, `Vary` inputs, range requests, cache/CORS/security headers, browser version, and schemeful top-level-site partitioning before drawing a conclusion.

## Reproduce

```bash
./scripts/bootstrap.sh
npx playwright install chromium
npm run experiment:cache-reuse
```

The default command uses a synthetic 1 MiB fixture and two fresh browser processes per condition. To test a private fixture, pass `--zip` and `--zip-member` directly to `tools/run_cache_reuse.mjs`; keep paths, output, and raw material in ignored private storage.

Staging is unavailable during the hackathon, so the next valid environment run is deferred while the generic sandbox-compatible integration is built and tested locally with synthetic fixtures. When staging is introduced later, run a serial control/treatment capture using the actual top-level lobby, exact credential-free staging URL, real response policy, normal iframe launch, and redacted HAR evidence. Do not enable real warming in the player flow before that gate passes.
