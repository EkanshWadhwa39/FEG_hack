# Sandbox — cold vs warm launch of the provided game package

This is the D1 deliverable: the FEG-provided game package, served **unmodified**, launched from a
lobby on a **separate origin**, with cache warming performed by the prototype's own warmer before
the iframe is created.

## Run it

### First time — get the package out of the supplied archive

The game package ships inside `assets.zip` as `assets/empireofgold.zip`. It stays
**outside the repository**: it is a provider bundle and is never committed.

```bash
# One-off setup.
./scripts/bootstrap.sh

# Extract the package somewhere outside the repo. ~/evidence/private is gitignored.
.venv/bin/python - <<'EOF'
import shutil, tempfile, zipfile
from pathlib import Path

target = Path.home() / "evidence/private/bundles"
target.mkdir(parents=True, exist_ok=True)
if (target / "empireofgold").exists():
    raise SystemExit(f"{target / 'empireofgold'} already exists; using it as-is")

with tempfile.TemporaryDirectory() as scratch:
    inner_zip = Path(scratch) / "empireofgold.zip"
    with zipfile.ZipFile("assets.zip") as archive, \
         archive.open("assets/empireofgold.zip") as inner, \
         open(inner_zip, "wb") as handle:
        shutil.copyfileobj(inner, handle)
    with zipfile.ZipFile(inner_zip) as archive:
        archive.extractall(target)
print(target / "empireofgold")
EOF
```

That prints the `--bundle` path to use below.

**Check it before starting the server.** The directory must contain `index.html`
and an `assets/` folder, and **must not** contain a nested `empireofgold/`.
Extracting on top of an existing copy produces exactly that, and the manifest
then counts the package twice — the giveaway is the server reporting ~130 MB and
~31 warm files instead of ~65 MB and 16.

```bash
ls ~/evidence/private/bundles/empireofgold      # assets  index.html  index.html.br ...
du -sh ~/evidence/private/bundles/empireofgold  # ~98M
```

### If the lobby looks wrong

The lobby tells you which of the two things went wrong, on the page itself:

The page diagnoses itself. The banner shows the URL it is actually open at and
picks its explanation from that, so it can never send you chasing the wrong
problem.

| What you see | What it means |
|---|---|
| A red **"The lobby did not start"** box naming a `file://` URL | JavaScript never ran: ES modules are blocked on `file://`. Verified in stock Firefox and Chromium. Serve it over HTTP and **type** the `http://127.0.0.1:8090/…` URL — opening the file from the editor or file manager lands you straight back here |
| A red box naming an `http://` URL | Served correctly, but the module failed to load or threw. The browser console has the real error |
| A red **"The lobby failed to start"** box | The module loaded and threw; the message shown is the actual exception |
| A yellow **"No game package is being served"** box | The lobby is fine; nothing is answering on the game origin. Start `sandbox_server.py`, or check the `?game=` parameter |
| Tiles show flat coloured emblems rather than game art | You are serving `prototype/` some other way (`scripts/serve.sh`, `python -m http.server`), so `/posters/*.webp` 404 and the built-in fallback posters are drawn instead. Everything still works — the artwork just comes from the package only when `sandbox_server.py` serves it |

### Every time — start the sandbox

```bash
.venv/bin/python tools/sandbox_server.py \
  --bundle ~/evidence/private/bundles/empireofgold \
  --latency-ms 40

#   lobby  http://127.0.0.1:8090/sandbox.html   <- open this
#   game   http://127.0.0.1:8091/
```

Startup takes a few seconds: it generates 24 lobby posters from the package's own
artwork before it starts listening. It prints the two URLs when it is ready.

`--latency-ms 40` matters. On unthrottled loopback there is no round trip to
remove, so warming looks far less effective than it is. Add
`--throttle-kbps 12000` for a link closer to real mobile.

Useful flags:

| Flag | Default | What it does |
|---|---|---|
| `--bundle` | *required* | Path to the extracted package |
| `--latency-ms` | `0` | Per-request delay standing in for RTT. Use `40` |
| `--throttle-kbps` | `0` | Bandwidth cap on the game origin. Use `12000` for ~12 Mbps |
| `--games` | `24` | How many lobby tiles to generate |
| `--profile` | `blocking` | How much to warm: `blocking` / `critical` / `all` |
| `--host` | `127.0.0.1` | `0.0.0.0` to open the demo from a phone on the same wifi |
| `--lobby-port` / `--game-port` | `8090` / `8091` | Run a second sandbox alongside one already up |

To run a second instance beside one already going:

```bash
.venv/bin/python tools/sandbox_server.py \
  --bundle ~/evidence/private/bundles/empireofgold \
  --latency-ms 40 --lobby-port 9090 --game-port 9091
```

Open the `:9090` URL it prints. The lobby reads the game origin from the URL, so
pass it explicitly when the ports are not the defaults:
`http://127.0.0.1:9090/sandbox.html?game=http://127.0.0.1:9091`.

Stop it with Ctrl+C. If a port is already held, the server prints the exact
command to free it.

### Measure it

```bash
node tools/sandbox_measure.mjs --runs 3
```

Three arms — `cold`, `warm`, `preinit` — driven through the page's own hover
path. Details in *Automated measurement* below.

## How to test it

### 1. Automated suite — nothing to set up

```bash
./scripts/check.sh          # 260 JS + 75 Python tests, ruff, shellcheck
```

Covers the dwell tracker, prefetch policy, pre-init manager, progressive rendering, manifest
generation, contrast, and the browser accessibility suite. The Playwright browser tests skip
cleanly if Chromium is not installed (`npx playwright install chromium` enables them).

### 2. Manual demo — this is what you show a judge

```bash
.venv/bin/python tools/sandbox_server.py \
  --bundle ~/evidence/private/bundles/empireofgold \
  --profile blocking --throttle-kbps 12000 --latency-ms 40
```

It prints the two URLs. Open **http://127.0.0.1:8090/sandbox.html**.

The throttle and latency matter: on unthrottled loopback there is no network cost to remove, so
warming looks far less effective than it is. 12 Mbps with 40 ms RTT is closer to a real link.

**The comparison to demonstrate, in this order:**

The lobby is laid out like the production one: rails of square posters with real titles, providers
and chips. Each tile launches the **same provided package served under its own URL namespace**
(`/g1`, `/g2`, …), so every tile has separate browser cache entries. Warming one does not warm the
others — without that, the whole demo would be a trick.

Pass `--games 24` (the default) to control how many tiles the lobby generates.

| Step | What to do | What to point at |
|---|---|---|
| 1 | Load the page | A lobby: rails of square posters with titles, providers and chips. Two tiles already carry a `BYTES` badge — the continue-playing rail was warmed at load, before anyone touched anything |
| 2 | Sweep the cursor across a rail without stopping | Tiles pick up `CONN` as the pointer heads toward them, and `BYTES` as it crosses. **No tile gets an engine**: crossing is travel, not intent |
| 3 | Rest on one tile for ~1 s | Its badge goes `BYTES` → `ENGINE`. **Rung reached** climbs to `PREINIT`; the game is loading in a hidden frame while you talk |
| 4 | Now click a tile you did *not* rest on | Cold baseline. Status says `cold launch` |
| 5 | Click **Reset**, rest on a tile until its badge reads `ENGINE` | Watch **Speculative budget** climb, then watch it refund the moment you move to another tile |
| 6 | Click that tile | **Single-digit ms.** Status says `revealed a pre-initialised engine` |
| 7 | Click **← Natrag u lobi**, then click the same tile again | **0 ms again.** The engine was retained, not destroyed |

Steps 4 and 6 are the whole pitch, and they happen **in the same page, seconds apart, on identical
packages**. A judge can pick which tile to rest on and which to click.

On a phone (or a touch-emulating browser), step 2 has no equivalent — there is no hover. Scroll and
let a tile settle in the middle of the screen and it earns `BYTES`; a touch-down earns the engine
rung outright, because at that point the tap has already begun.

Then show it failing safely:

| Step | What to do | What to point at |
|---|---|---|
| 8 | Tick **Simulate exclusion-register denial** mid-warm | Rung drops to `NONE (AUTHORIZATION)`, in-flight warming aborts, the budget is refunded, any engine is torn down |
| 9 | Tick **Disable speculation** and launch again | The honest control arm, in the same page |

Also worth showing:

- **Rung reached** is the live state of the speculation ladder: `CONNECT` (a transport hint, free),
  `WARM` (the 16-file blocking manifest, 2.8 MB), `PREINIT` (a whole engine, ~52 MB). Each rung is
  earned by stronger intent. See `docs/SPECULATION-LADDER.md`.
- **Tier** is what the governor will permit on this device. `FULL` allows the engine rung; `REDUCED`
  allows bytes only, and is what a browser with no Network Information API (Firefox, anything on
  iOS) or a 3g link gets. The demo-only override forces `FULL` and never ships.
- **Speculative budget** is charged for what is actually spent — the engine rung is billed the whole
  package, not the warm profile — and refunded when intent is withdrawn.
- `?maxrung=WARM` caps the ladder at byte warming, which is how the measurement harness isolates the
  bytes from the engine.
- Every tile is the real package, served under its own URL namespace (`/g1`, `/g2`, …). The tile
  *titles*, providers and chips are labels taken from the public production lobby; the bytes behind
  each are the provided bundle, cached separately.
- **Posters are generated from the package itself** at server start (`tools/poster_builder.py`) — a
  graded crop of its splash background with one of its own symbol sprites. 24 posters cost 182 KB in
  total. No PSK or third-party artwork is shipped, copied or hotlinked.
- The per-tile `CONN` / `BYTES` / `ENGINE` badge is **operator instrumentation** behind a toggle. It
  is not a player-facing element: a "ready" badge would surface the predictor, which is the one thing
  this architecture promises never to do.

**Expect the game to render but not spin.** It has no backend. Say so before anyone clicks.

### 3. Automated measurement

```bash
node tools/sandbox_measure.mjs --runs 3         # three arms, drives the real page
node tools/sandbox_measure.mjs --arms cold,preinit --runs 3
node tools/prod_provider_probe.mjs --runs 1     # live production, needs network
```

Three arms, so the two mechanisms are never reported as one lump:

- `cold` — speculation disabled. The honest baseline.
- `warm` — the ladder capped at byte warming, so the difference is attributable to bytes alone.
- `preinit` — the full ladder, including the engine rung.

Every arm is driven through the page's own intent path: a real hover on a real tile, not a
test-only button. `sandbox_measure` reports launch-phase bytes, time to engine-canvas, and time to
assets-quiet. Raise `SANDBOX_SETTLE_MS` if the warmed manifest looks short under heavy throttling.

Measured on this machine (40 ms per-request latency, no bandwidth throttle, headless Chromium,
median of 3), **with the atlas-page shim active**, so the game runs to completion rather than
stalling on its preloader:

| Arm | Launch-phase bytes | click → canvas | click → assets quiet |
|---|---:|---:|---:|
| cold | 52,102,952 | 616 ms | 7,106 ms |
| warm | 50,497,086 | 403 ms | 5,248 ms |
| preinit | **0** | **205 ms** | no further network |

Every arm now transfers slightly more and settles later than it did before the shim, because the
game gets **further**: it reaches its intro and reel screens instead of dying at the first rejected
asset bundle. Roughly 164–172 responses per cold launch, against 138–143 before. That makes the
comparison harder, not easier, and the gap holds anyway.

Nothing else on this machine may drive a browser while these run. The measurement harness and the
Playwright test suite both take Chromium, and sharing it produces failures that look like
regressions — this is the same "never run two browser experiments at once" rule as in `AGENTS.md`.

### Serving the demo to another device

```bash
.venv/bin/python tools/sandbox_server.py --bundle ... --host 0.0.0.0
```

Then open `http://<your-ip>:8090/sandbox.html` from another machine on the same network
(`hostname -I` gives the address). Only do this on trusted venue wifi: it serves the provider
bundle to anyone who can reach the port.

### If a port is in use

Almost always a sandbox from a previous run that is still going. Stop it:

```bash
pkill -f tools/sandbox_server.py
```

If something else is holding the port, find it with `ss -lptn 'sport = :8090'`
(or `lsof -i :8090`), or move the sandbox out of the way with
`--lobby-port 9090 --game-port 9091` and open the `:9090` URL it prints.

The server prints all of this when it hits the error.

## What the sandbox does and does not do

**Does:** serves the package byte-for-byte from disk. Nothing in the package is rewritten,
minified, re-hashed, or repackaged. Response headers imitate the production CDN observed on the
live site — `public, max-age=31536000, immutable` for versioned static assets, `ACAO: *`,
`Timing-Allow-Origin: *`, and no-store for entry documents. Query-string versioning
(`common.css?v=1788443825853`) resolves to the real file, as it does in production.

**Does supply 20 atlas page textures the package declares and does not contain.** This is the one
place the sandbox puts bytes on the wire that did not come off the disk, and it is disclosed here,
stamped on every such response as `X-Sandbox-Shim: synthesized-placeholder`, and printed in full at
server startup. See [`tools/spine_shim.py`](../tools/spine_shim.py).

The package is internally inconsistent. Ten Spine atlases at each resolution tier (`@0.5x` and
`@1x`) name page images that were never included in the ZIP:

```
book.png  cards.png  jp_jackpots.png  jakpots.png  jakpots_2.png … jakpots_7.png
```

PixiJS loads Spine assets as a *bundle*, and a bundle rejects as a unit. One missing page aborts
the entire load with `Error loading bundles`, the promise never settles, and the game sits on its
preloader indefinitely. The engine boots, the canvas is created, WebGL initialises — and then
nothing, because 1 texture out of 379 files is absent.

The shim reads the size the package's **own atlas** declares for each page (`size:1981,803`) and
serves a transparent PNG of exactly those dimensions. The declared size is the part that matters:
Spine addresses sub-regions by absolute pixel bounds, so a wrongly sized placeholder would shift
every frame packed on that page. A correctly sized transparent one leaves geometry untouched and
renders those regions as nothing. Total cost: 216 KB across all 20.

Nothing is written into the bundle, and no response is rewritten. No game logic, certified code,
mechanic or payout is touched — these are image bytes for image URLs, which is what a CDN would
have to serve too.

**Does not:** provide the game's backend.

- `offline-data-*.js` is **not present in the provided package**. The bundle dynamically imports
  it; the file does not exist.
- The package calls `https://api.spiniq.io`, which the sandbox has no access to.

Neither turns out to block the demo: with the atlas pages supplied, the package runs to a playable
screen and makes **zero external requests**. It carries its own demo-mode state.

## The milestone, stated precisely

With the atlas pages supplied, the unmodified package **does reach a playable screen** in the
sandbox: intro card, `Play game`, reels, balance, bet controls and a working spin button.
Verified in Chromium at 1280×720.

We nonetheless keep measuring to a narrower milestone:

> **engine-canvas-present** — the first `<canvas>` appearing inside `#gameStage`, i.e. the engine
> has started and is rendering.

This is **not** "playable" and **not** "interactive". Reaching a playable screen by eye is not the
same as an authoritative input-accepted signal, and no such signal exists in the sandbox, so none
is claimed. The transition state machine in
[`transition.js`](../prototype/src/transition.js) would refuse to clear on this signal, and that
refusal is correct.

The honest form of the claim is: *the milestone is engine-canvas-present; separately, the same
build reaches a hand-verified playable screen.* Do not merge those two sentences.

## Results

Chromium 136, local sandbox, game origin throttled to ~12 Mbps to imitate a mobile link. Warming
is executed by [`warmer.js`](../prototype/src/warmer.js) at concurrency 2 before the iframe is
created.

> **These runs predate the atlas-page shim.** They were taken while the game still aborted at the
> first rejected asset bundle, so both arms stop earlier than they now would. The comparison
> between the two arms is still like-for-like — both were cut off at the same place — but the
> absolute figures are not comparable with the unthrottled table above, and the throttled
> experiment has not been re-run since. Treat this table as a same-conditions A/B, not as a
> current absolute.

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
