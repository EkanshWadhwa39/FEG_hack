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

## What is proven, and what is not

**Proven (MEASURED):** a parent-page `fetch(url, {mode:'no-cors', credentials:'include'})` at
concurrency 2, issued by `warmer.js` from `casino.psk.hr`, produces cache entries reused with
zero transfer by the `gamecontainer-eu.psk.hr` frame, for these 9 exact content-hashed,
query-free URLs, over 3 control and 3 treatment runs.

**Not proven (UNKNOWN):**

- **The provider bundle on `v1t.eu` was never reached.** During these runs the game frame's
  `api/session/create` returned a 302 and the provider assets did not load — plausibly geo
  restriction from this network. The 92 KB we warmed is the container shell, **not** the ~15–20 MB
  of game assets that dominate load time. Whether the same reuse holds across sites for `v1t.eu`
  is the next thing to test, and it is the difference between a 92 KB saving and a real one.
- Click-to-interactive time. This measures bytes, not the launch milestone.
- Other titles, providers, browsers, mobile web, and any native surface.
- Behaviour for an authenticated (non-demo) launch.

## Incidental confirmation: the 404 probe is real

`gamecontainer-eu.psk.hr/GameView/Egaming` returned **404** on every production run. This is the
wasted round-trip `CODE.md` recorded at 712 ms, independently reproduced today on the live site.
It is a free fix and it is real.

## Compliance notes

Public demo play only. No login, no account, no credentials, no player data. The asset URLs are
public static files with no query strings or tokens. The probe emits filenames and aggregate byte
counts, never full URLs, headers, or cookies.
