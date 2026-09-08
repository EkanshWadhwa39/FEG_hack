# Production parent-to-iframe cache reuse — MEASURED

**Status: the core architectural assumption is confirmed in production.**

Date: 8 September 2026. Target: `casino.psk.hr` public demo play. Browser: Chromium
136.0.7103.25 (Playwright 1.52.0), Linux, fresh browser process per arm.

## Result

The prototype's own [`warmer.js`](../prototype/src/warmer.js), executed inside the top-level
production lobby page, created cache entries that the **cross-origin game container iframe**
then reused with zero network transfer.

| Arm | Runs | Assets in frame | Total transferSize | Total decodedBodySize |
|---|---:|---:|---:|---:|
| Control (no warming) | 3 | 9 | 92,506 / 92,526 / 92,445 bytes | 241,898 |
| Treatment (warmed by `warmer.js`) | 3 | 9 | **0 / 0 / 0 bytes** | 241,898 |

Decoded size is identical across all six runs. The frame received the complete objects; it
simply did not touch the network to get them.

Reproduce:

```bash
node tools/prod_cache_probe.mjs --runs 2      # add --verbose for per-asset rows
```

## Why this matters

`CODE.md` named this as the assumption to verify before anything else was built, and
[`GATE-1-DESIGN-REVIEW.md`](GATE-1-DESIGN-REVIEW.md) carried a pre-agreed kill criterion: if
parent-to-iframe reuse failed against the real origin, we would not build a governor on top of
it. **That criterion is now retired.** The mechanism works in the real topology.

Previously the strongest evidence was a local fixture server
([`LOCAL-CACHE-REUSE.md`](LOCAL-CACHE-REUSE.md)) with headers we controlled. This is the
production site, production headers, production frame nesting, and our shipped code.

## The topology, as actually observed

The real production structure differs from the one assumed in `CODE.md`, and the difference is
worth stating precisely:

```
casino.psk.hr                      top-level lobby (site: psk.hr)
  └── gamelauncher-uu-pop2.psk.hr  launcher redirect
        └── gamecontainer-eu.psk.hr  game container iframe  ← assets warmed here
              └── psk-hr-games-provider.v1t.eu  provider bundle (DIFFERENT SITE)
```

- The container shell we warmed is on `psk.hr`, same site as the lobby, which is why the cache
  partition is shared.
- The heavy provider bundle is served from **`v1t.eu`, a different site**. `CODE.md` assumed all
  assets were same-site. They are not.

## The provider bundle — the number that matters

The container shell above is 92 KB. The payload that actually dominates load time is the provider
game bundle on **`games-cdn-3.v1t.eu` / `psk-hr-games-provider.v1t.eu` — a different site from the
lobby**. It was unreachable on an earlier network; on T-Hub wifi it loads.

Measured with `tools/prod_provider_probe.mjs`, which reads real wire bytes from CDP
`Network.loadingFinished.encodedDataLength`. Resource Timing cannot be used here: the provider CDN
sends no `Timing-Allow-Origin`, so cross-origin entries report zeros.

| Arm | Provider responses from network | Provider bytes on the wire |
|---|---:|---:|
| Control | 112 · 112 · 112 · 112 | 11,252,536 · 11,253,203 · 7,186,900 · 11,253,576 |
| Treatment (107 URLs warmed) | 22 · 22 · 22 · **14** | 394,233 · 394,342 · 394,174 · **35,113** |

**Median reduction: 11,253,576 → 35,113 bytes, or 99.7%.** The final run warmed the full discovered
set of 107 URLs; the earlier three used a hand-collected 91 and still cut ~96.5%.

**Cross-site cache reuse works.** The expectation that Chrome's partition key would isolate a
`v1t.eu` iframe from a `psk.hr` top-level warm was wrong, and testing it rather than reasoning
about it is what found that.

Reproduce:

```bash
node tools/prod_provider_probe.mjs --runs 2
```

The tool is self-contained: the control arm discovers the exact query-free asset URLs, and the
treatment arm warms that discovered set.

## What is proven, and what is not

**Proven (MEASURED):** a parent-page `fetch(url, {mode:'no-cors', credentials:'include'})` at
concurrency 2, issued by `warmer.js` from `casino.psk.hr`, produces cache entries reused with
zero transfer by the `gamecontainer-eu.psk.hr` frame, for these 9 exact content-hashed,
query-free URLs, over 3 control and 3 treatment runs.

**Not proven (UNKNOWN):**

- **Click-to-interactive time.** Everything above measures bytes. We have not yet measured the
  launch milestone, and bytes saved is not the same as seconds saved.
- **One title.** Multiplay 81 (Multiplay81TS 1.10.51-1), one provider, demo mode.
- Other titles, providers, browsers, mobile web, and any native surface.
- Whether warming 11 MB speculatively is *acceptable* — that is what the governor, the data
  budget, and the hit-rate policy exist to answer. A 99.7% cut on a launch that never happens is
  pure waste.
- Behaviour for an authenticated (non-demo) launch.

## Incidental confirmation: the 404 probe is real

`gamecontainer-eu.psk.hr/GameView/Egaming` returned **404** on every production run. This is the
wasted round-trip `CODE.md` recorded at 712 ms, independently reproduced today on the live site.
It is a free fix and it is real.

## Compliance notes

Public demo play only. No login, no account, no credentials, no player data. The asset URLs are
public static files with no query strings or tokens. The probe emits filenames and aggregate byte
counts, never full URLs, headers, or cookies.
