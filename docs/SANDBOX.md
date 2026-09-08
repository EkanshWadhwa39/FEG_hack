# Sandbox — cold vs warm launch of the provided game package

This is the D1 deliverable: the FEG-provided game package, served **unmodified**, launched from a
lobby on a **separate origin**, with cache warming performed by the prototype's own warmer before
the iframe is created.

## Run it

```bash
# The package stays outside the repository. Point at wherever you extracted it.
.venv/bin/python tools/sandbox_server.py --bundle /path/to/empireofgold

#   lobby  http://127.0.0.1:8090/sandbox.html
#   game   http://127.0.0.1:8091/

# With a realistic link, which is where warming actually shows:
.venv/bin/python tools/sandbox_server.py --bundle /path/to/empireofgold --throttle-kbps 12000

# Automated cold/warm measurement:
node tools/sandbox_measure.mjs --runs 3
```

## What the sandbox does and does not do

**Does:** serves the package byte-for-byte from disk. Nothing in the package is rewritten,
minified, re-hashed, or repackaged. Response headers imitate the production CDN observed on the
live site — `public, max-age=31536000, immutable` for versioned static assets, `ACAO: *`,
`Timing-Allow-Origin: *`, and no-store for entry documents. Query-string versioning
(`common.css?v=1788443825853`) resolves to the real file, as it does in production.

**Does not:** provide the game's backend. Two things are absent and neither can be conjured:

- `offline-data-*.js` is **not present in the provided package**. The bundle dynamically imports
  it; the file does not exist.
- The package calls `https://api.spiniq.io`, which the sandbox has no access to.

One asset is also genuinely missing from the package: `assets/spines/@1x/book.png` returns 404.
141 of 142 requests succeed.

## The milestone, stated precisely

Because there is no backend, the game **cannot reach playable** in the sandbox. We therefore
measure to a milestone we can actually observe:

> **engine-canvas-present** — the first `<canvas>` appearing inside `#gameStage`, i.e. the engine
> has started and is rendering.

This is **not** "playable" and **not** "interactive". No authoritative input-accepted signal
exists in the sandbox, so none is claimed. The transition state machine in
[`transition.js`](../prototype/src/transition.js) would refuse to clear on this signal, and that
refusal is correct.

## Results

Chromium 136, local sandbox, game origin throttled to ~12 Mbps to imitate a mobile link. Warming
is executed by [`warmer.js`](../prototype/src/warmer.js) at concurrency 2 before the iframe is
created.

3 paired runs, full 141-asset manifest discovered and warmed:

| Arm | Time to engine-canvas | Wire bytes during launch | Responses |
|---|---:|---:|---:|
| Control (cold) | 1,514 · 1,471 · 1,498 ms | 52,220,526 (all three) | 143 |
| Treatment (warmed) | 839 · 392 · 481 ms | 4,984,599 (all three) | 29 |

**Median: 1,498 ms → 481 ms to engine-canvas (67.9% faster), and 52,220,526 → 4,984,599 wire
bytes (90.5% less).** Control byte totals are identical to the byte across all three runs, which
is what a deterministic local origin should produce and a useful sanity check on the harness.

Treatment timing varies more than control (392–839 ms) because warming competes with the launch
for the same throttled link. The slowest treatment run is still 1.8× faster than the fastest
control run. Unthrottled on loopback the same
comparison is 485 ms → 339 ms, because there is no network cost to remove — which is itself the
point: the saving *is* the network.

### Two honest notes on the byte figures

1. The warmed arm's byte total is not directly comparable to the control's. With a warm cache the
   game gets **further** inside the measurement window, so it starts fetching assets the cold arm
   never reached. The treatment number is therefore inflated relative to a like-for-like load.
2. Manifest discovery under throttling can miss the tail of the asset list, under-warming the
   treatment arm. `SANDBOX_SETTLE_MS` controls the discovery window; raise it if the warmed
   manifest looks short.

The clean number here is **time to milestone**. The clean byte number is the production one in
[`PRODUCTION-CACHE-REUSE.md`](PRODUCTION-CACHE-REUSE.md).

## Relationship to the production evidence

| Question | Answered by |
|---|---|
| Does parent-origin warming survive a real cross-origin iframe? | Production probe — yes, 11.25 MB → 35 KB |
| Does it work on the package we were given, unmodified? | This sandbox — yes |
| Does it save *time*, not just bytes? | This sandbox — 1,594 ms → 364 ms at 12 Mbps |
| Does it reach playable? | **Unanswered.** No backend, in either environment |

## Limitations

- One title, one provider, one browser, two paired runs at the headline setting.
- Loopback plus artificial throttling is not a real mobile network. There is no RTT modelling, no
  packet loss, no DNS or TLS cost. Production connection setup was measured separately at 1,850 ms
  for `session/create`, 86% of it connection overhead, and none of that is present here.
- The 12 Mbps figure is a chosen value, not a measured PSK population statistic.
- Warming the full manifest speculatively is not a policy. A 77% saving on a launch that never
  happens is waste; the governor and hit-rate policy are what make it defensible.
