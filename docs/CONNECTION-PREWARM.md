# Connection prewarming status

## Measured opportunity

One supplied historical production HAR contains a `session/create` document request with these exporter timings:

| Component | Duration |
|---|---:|
| Total | 1,849.593 ms |
| DNS | 494.022 ms |
| Connect (includes SSL in HAR semantics) | 1,046.412 ms |
| SSL subset | 321.076 ms |
| Server wait | 302.772 ms |

DNS plus connect is 1,540.434 ms, or **83.3%** of total—not 86%. SSL must not be added again because it is a subset of `connect`. This is **MEASURED** for one request in one historical capture. It identifies a transport-setup opportunity; it does not measure the causal effect of browser hints.

The separate historical cold/repeat pair contains one matching session-create request per capture at 923.105 ms and 369.665 ms. Both report `dns=-1`, `connect=-1`, and `ssl=-1`, so those records used an already established connection according to HAR exporter semantics. Their difference is mostly wait time and cannot be credited to preconnect.

## Implemented boundary

`prototype/src/connection-prewarm.js` provides:

- a real browser adapter that emits anonymous `dns-prefetch` and `preconnect` link hints for the validated HTTPS endpoint origin;
- a no-I/O synthetic adapter for the local demo;
- per-origin deduplication;
- credential-like query rejection;
- an injected drawer-open policy boundary that runs through the existing fail-closed governor with zero planned asset bytes.

The adapter does not call the session endpoint, create a session, cache a response, alter launch ordering, or advance past exclusion authorization. Asset warming and connection prewarming remain separate policies.

The current drawer/live-toggle UI is owned by the parallel product-surface work and must call `prewarmConnectionOnDrawerOpen` with an independently controlled `environment.enabled` value. This commit deliberately does not edit that owner’s HTML, styles, or UI controller. Until that integration lands, the browser adapter is available but not player-flow enabled.

## Measurement status

A valid historical before/after preconnect measurement cannot be produced now:

- the historical HARs cannot be rerun or retroactively modified;
- staging is unavailable;
- production traffic is not an approved substitute;
- a loopback HTTP timing would contain neither representative DNS nor TLS setup.

Therefore connection-prewarm impact is **UNKNOWN**. No milliseconds-saved claim is made. When staging becomes available, compare isolated warm-cache arms with connection hints disabled/enabled, use the same exact asset-batch milestone plus a separately authoritative input-accepted event, and report DNS/connect/server-wait components independently.
