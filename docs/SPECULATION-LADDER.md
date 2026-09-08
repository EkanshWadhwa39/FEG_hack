# The speculation ladder — what was broken, and what replaced it

## The report

"Warm loading and hover-based preloading seem to be not working at all."

That was accurate. Five separate defects produced it, and only one of them was
visible as a failure — the other four made the feature silently do nothing while
every unit test passed.

---

## The five defects

### 1. Hover-triggered warming was never wired to anything

`prototype/sandbox.html` had a `setInterval` that read dwell and called
`preinit.prepare`. It never called `warmAssets`. Byte warming ran **only** when a
human clicked a "Warm now" button. So hovering a tile either did nothing, or —
past 600 ms — jumped straight to spending a whole engine. All-or-nothing, with
nothing in between.

On the player surface (`prototype/player.html`) it was worse: `mouseenter` called
`reportIntent`, which pushed a game id into an array named `intentLog` that
nothing ever read. Hovering a tile there was, literally, a no-op.

**MEASURED, before the fix:** hovering a sandbox tile for 400 ms produced zero
speculative requests.

### 2. The governor refused to run on any non-Chromium browser

`assessPrefetch` blocked with `CONNECTION_UNKNOWN` whenever `saveData` or
`effectiveType` was missing. The Network Information API that supplies both is
**Chromium-only** — Firefox and every browser on iOS do not implement it. So the
feature worked in the browser it was developed in and was disabled everywhere
else, which is exactly the shape of a bug that survives a full test suite.

The sandbox had an "Ignore governor" checkbox that masked this during demos.

### 3. The byte budget was decorative

The governor was asked to approve `manifest.warmBytes` — 2.8 MB. The engine rung
then fetched the entire 52 MB package. `bytesUsed` was hard-coded to `0`, so
nothing ever accumulated and no budget could ever be reached. A "per-session data
budget" that cannot be exhausted is not a budget.

### 4. The governor could refuse new work but not stop work in flight

`warmAssets` accepts an `AbortController` signal, and has tests covering
uncooperative in-flight requests. **No caller ever passed one.** A page that was
backgrounded, or an authorization that was withdrawn, declined to start the *next*
asset and let the current 2.8 MB finish.

### 5. `--profile all` warmed nothing at all

`tools/manifest_builder.py` emitted 54 non-critical PRIMARY assets (21.7 MB) under
the `all` profile. `warmAssets` validates a plan **atomically** and rejects
non-critical PRIMARY, so the whole plan threw and *zero* assets were warmed. The
profile that asked for the most warming performed the least.

### Also: touch had no intent signal whatsoever

Dwell was wired to `mouseenter`/`mouseleave` and keyboard focus. **A touch screen
fires neither.** FEG's own telemetry puts ~72% of launches on a mobile client. On
a phone, every launch took the cold path by construction.

---

## What replaced it

`prototype/src/speculation.js` — one graduated ladder. Speculation gets more
expensive only as the evidence of intent gets stronger.

| Rung | Trigger | Cost | Wasted if wrong |
|---|---|---|---|
| `CONNECT` | first sight of a tile | DNS + TCP + TLS, no bytes | nothing |
| `WARM` | ~200 ms dwell | blocking profile, 2.8 MB, hedged over 3 titles | 2.8 MB |
| `PREINIT` | ~600 ms dwell, or a touch-down | a live engine, ~52 MB | 52 MB + GPU |

The ladder is a pure function: it reads a snapshot and returns actions. The page
performs them. Every threshold and every refusal is testable without a browser
(29 tests in `prototype/tests/speculation.test.mjs`).

### Properties it enforces

- **Authorisation gates every rung, not only the reveal.** Warming a title for a
  self-excluded player is speculative work on a launch that must never happen.
  Withdrawing authorisation mid-flight aborts warming and tears down any engine.
- **The engine rung requires the `FULL` governor tier.** A browser we cannot
  interrogate, or a 3g link, gets bytes and never an engine.
- **Bytes are charged for what is actually spent** through a ledger that charges
  once per (title, rung) and refunds on teardown — because the ladder is
  re-evaluated five times a second and a naive counter exhausts the budget in
  under a second without a single extra byte moving.
- **Nothing is player-visible.** `playerVisible: false` is part of the returned
  contract, and a browser test asserts the drawer's rendered contents are
  byte-identical before and after the ladder climbs.

### The governor now has tiers

`SpeculationTier` is `NONE` / `REDUCED` / `FULL`.

- No Network Information API (Firefox, iOS): `REDUCED`, capped at an 8 MiB
  budget. Cheap byte warming, never an engine. This is what "degrade
  conservatively" should have meant — the previous behaviour was not conservatism,
  it was an outage.
- `3g`: `REDUCED`. A slow link is where moving bytes off the click path helps
  *most*; what it cannot afford is waste. Metered intent is still carried by
  Save-Data, which blocks everything.
- `2g` / `slow-2g` / unrecognised: `NONE`.
- Save-Data outranks all of it, including the degraded path.

### Touch has real intent signals

`prototype/src/intent-sources.js` adds two, and they differ in kind:

- **Viewport dwell.** A tile resting near the centre of a *settled* viewport is
  the touch equivalent of a pointer resting on a tile. It is a guess, so it feeds
  the same decaying dwell score under the same governor. Scrolling stops crediting
  immediately, so a fast flick through forty tiles credits none of them.
- **Touch-down commit.** `pointerdown` fires 80–300 ms before `click`. This is not
  a prediction — the finger is already on the tile — so it has no false-positive
  cost and goes straight to the top rung. A small head start, but free and
  certain, and it is the only speculation available to a player who taps the first
  thing they see.

A mouse press is deliberately *not* a commit: hover dwell already covered it.

### Weak signals can never buy an engine

Three signals feed the ladder, and they are not interchangeable:

| Signal | Strength | Highest rung |
|---|---|---|
| Pointer or finger resting on a tile *right now* | evidence | `PREINIT` |
| A touch-down (`pointerdown`) | evidence — the tap has begun | `PREINIT` |
| Accumulated dwell from earlier in the session | history | `WARM` |
| A tile centred in a settled viewport | guess | `WARM` |
| A predicted pointer destination | guess | `CONNECT` |

Two of these were learned the hard way while wiring the lobby:

- **A pointer crossing a rail deposits a little dwell on every tile it passes.**
  A few sweeps were enough for a tile nobody ever stopped on to out-rank
  everything and buy itself an engine. The engine rung now reads `currentMs` —
  *uninterrupted, present-moment* dwell, which is zero the instant the pointer
  leaves — while bytes still read accumulated `score`.
- **A settled viewport is not attention.** A desktop lobby left untouched kept
  crediting whichever tile sat in the middle of the screen, forever, and
  eventually bought it an engine. Viewport dwell is now enabled only where hover
  genuinely does not exist (`(hover: none) and (pointer: coarse)`), bounded to
  2.5 s per tile, and kept in a separate tracker whose entries are merged in at a
  strength that stops at the byte rung.

---

## The lobby it runs in

The sandbox surface is now a PSK-shaped lobby rather than a row of buttons
labelled `Game 1`..`Game 6`, because the levers below only make sense against a
real browse pattern: rails of square posters that a player scans, scrolls, and
rests on.

What was copied and what was not:

| | |
|---|---|
| Colour tokens, tile geometry, hover behaviour | Read from `casino.psk.hr`'s own stylesheet: `.psk.dark` background `#0e0e11`, surface `#22222b`, brand `#1752bf`; `.game-tile` `aspect-ratio: 1/1`, max-width 160→224 px across the same four breakpoints; `border-radius: .5rem`; hover `scale(1.1)` over 0.3 s |
| Rail headings and chips | The production ones — `PSK Favoriti`, `Nove igre`, plus `JACKPOT` / `NOVE` / `EKSKLUZIVNO` / `IGRA DANA` |
| Titles and providers | The real names listed publicly on that lobby, reproduced as labels |
| **Poster artwork** | **Generated from the FEG-provided package itself** — a graded crop of its splash background with one of its own symbol sprites, lifted through the package's own atlas descriptors (`tools/poster_builder.py`). 320×320 WebP, ~7.6 KB each. No PSK or third-party artwork is copied, hotlinked, or shipped |
| **Every tile's game** | **The same provided package**, under its own URL namespace (`/g1`, `/g2`, …), so each has separate browser cache entries and warming one never warms another |

### The rails are not a recommender

`CODE.md` forbids surfacing predictor output to the player. Every rail is built
from something the player did (`Nastavi igrati` — this session's launches;
`PSK Favoriti`) or from a fixed order identical for everyone (`Nove igre`,
`Popularno`). There is no similarity model, no cross-player inference, and
`buildRails` returns `algorithmic: false` as part of its contract. A browser test
asserts the rendered titles, providers, chips and order are byte-identical before
and after the ladder climbs.

The per-tile `CONN` / `BYTES` / `ENGINE` badge is **operator instrumentation**
behind a toggle, not a player-facing element — a "ready" badge would surface
exactly the speculation this architecture promises to keep invisible.

## MEASURED result

Sandbox, the FEG-provided Empire of Gold package served unmodified from a separate
origin, 40 ms per-request latency, headless Chromium, loopback, median of 3 runs.
Milestone is **first `<canvas>` in `#gameStage`** — the engine is rendering. It is
**not** playable and not interactive: the package's backend is unreachable in the
sandbox, so no input-accepted signal exists and none is claimed.

| Arm | Launch-phase bytes | click → canvas | click → assets quiet |
|---|---:|---:|---:|
| `cold` — speculation disabled | 52,220,191 | 542 ms | 4,848 ms |
| `warm` — ladder capped at bytes | 49,845,707 (−4.5%) | 450 ms (−17.0%) | 4,767 ms |
| `preinit` — full ladder | **0** (−100%) | **124 ms (−77.1%)** | no further network |

Reproduce with:

```bash
.venv/bin/python tools/sandbox_server.py --bundle /path/to/empireofgold --latency-ms 40
node tools/sandbox_measure.mjs --runs 3 --lobby http://127.0.0.1:8090
```

Both non-cold arms are driven through the page's own intent path — a real hover on
a real tile. The "Warm now" button is gone. A number produced by a control the
product does not have is not evidence about the product.

### What the three arms mean

The `warm` arm exists to keep the two mechanisms from being reported as one lump.
Byte warming of the blocking profile is worth ~15% on time to first canvas — real,
and it is all that is available on the `REDUCED` tier. The remaining 71 points come
from the engine rung, and they come from *moving* work rather than removing it:
the 52 MB and the ~4.9 s of decode still happen, just during browse instead of
after the click.

### Levers wired beyond the ladder

The ladder answers "what should we speculate on when the player shows intent".
These answer "what can we do when they have not shown any yet", and they are the
ones that matter for a player who opens the lobby and taps their usual game
without pausing on it.

| Lever | What it does | Evidence |
|---|---|---|
| **Preconnect at first paint** | Resolves the game origin's DNS, TCP and TLS before any tile is touched | A production `session/create` measured at 1,849 ms, of which **1,046 ms was connection setup** and only 303 ms was server wait |
| **Warm the continue-playing rail at load** | Warms the player's own last-played (then favourite) titles at lobby paint, bytes only | Last-played is **MEASURED at 30.4% hit@1** on 3,337 real launch sequences — 2.7× a collaborative model, 5.5× global popularity |
| **Cross-session warm memory** | Remembers what was warmed, so a returning player's budget goes to cold titles | **57.5% of repeat launches were MEASURED as already cached** (CDN `max-age` ≈ 19 years) |
| **Pointer-trajectory prediction** | Fires the free rung against the tile the cursor is travelling toward | Ray/box intersection over a 220 ms horizon, refusing slow or turbulent movement. Buys back the 200–400 ms traversal |
| **Device-aware governance** | A constrained phone gets bytes, never a speculative engine | `deviceMemory < 4 GB`, or discharging below 20%, downgrades `FULL` → `REDUCED` |
| **Engine retention on exit** | Leaving a game hides its engine for 45 s instead of destroying it | Re-entry becomes the same reveal: **MEASURED at 0 ms** in the sandbox |
| **Poster discipline** | 320×320 WebP with intrinsic dimensions, first rail eager and high priority, rest lazy | 7.6 KB per poster against 675 KB for the raw splash. A 60-tile lobby is 0.45 MB rather than 40 MB |

Two of these are safety rather than speed. `deviceMemory` and the Battery Status
API are **absent** on much of the audience (Chromium-only and iOS/Firefox
respectively), so absence is treated as *no evidence of a constrained device* —
never as a veto. That is the same rule the connection tier follows, and for the
same reason: a check that only ever fires on one browser family is not a safety
property.

Cross-session warm memory is a *guess* and is calibrated to be wrong in the cheap
direction. There is no browser API that answers "is this URL in your HTTP cache",
so the record is local, expires in 6 hours (far short of the CDN's `max-age`,
because eviction is invisible to us), is keyed by bundle version, and degrades to
"we know nothing" on any storage failure. Being wrong costs one redundant warm.
Being wrong the other way costs a slow launch.

### Scope, stated plainly

One browser, one title, one provider, loopback, headless, three runs. The engine
rung's 73 ms is click-to-canvas-revealed, not click-to-playable. Production and
staging cache policy, CORS, partition behaviour and exclusion-register latency all
remain `UNKNOWN`. See `CODE.md`.
