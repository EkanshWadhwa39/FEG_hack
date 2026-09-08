# Optimisation inventory — every lever we found

Goal: minimum time to a fully rendered, ready-to-play game.

Each item is labelled **MEASURED** (we ran it), **STATIC** (verified by inspecting the package),
or **ESTIMATED** (industry-typical, not verified here). Estimates are never added into headline
totals.

**The hard boundary first.** With a *perfect* cache — 140 of 143 assets served from cache, 3 from
network totalling 2,584 bytes — Empire of Gold still takes **6,226 ms** to finish reading its
assets, and 687 ms to first canvas (**MEASURED**). No caching or prefetching strategy can go below
that, because there is no network left to remove. Everything in Section A is bounded by that floor;
everything in Section B is about lowering the floor itself.

---

## A. What we can do from outside the package

These are ours. Nothing here modifies certified code.

| # | Optimisation | Status | Effect |
|---|---|---|---|
| A1 | **Warm during browse, not at click** | built | Moves fetching off the critical path entirely. The budget is browsing time, not click-to-launch |
| A2 | **Blocking-profile warming** (16 files, 2.8 MB, 4% of package) | **MEASURED** | **26.2% faster to first render** at 40 ms RTT |
| A3 | **preconnect / dns-prefetch on drawer open** | built | Production `session/create` measured at 1,850 ms of which **1,046 ms is TCP connect and only 303 ms is server wait**. 86% of that call is connection setup |
| A4 | **Skip titles already played this session** | **MEASURED** | **57.5%** of repeat launches are already cached (`max-age` ≈ 19 years). Warming them is pure waste. Free win, just don't do the work |
| A5 | **Never warm the mp3 set** | **STATIC** | Chromium fetches only the 51 `.ogg` files, never the 51 `.mp3`. Warming mp3 would waste **12 MB** every time |
| A6 | **Never warm both resolution branches** | **STATIC** | Resolving the tier before warming avoids **31 MB** of pointless transfer |
| A7 | **Dwell as the primary predictor** | built | History-based prediction is capped at **13.4% hit@1 / 28% hit@5**. Dwell is direct intent and the only signal with a path above that ceiling |
| A8 | **Fix the 404 probe** | **MEASURED** | `gamecontainer-eu.psk.hr/GameView/Egaming` returns 404 on every production launch, costing a measured **712 ms**. Free |
| A9 | **Progressive tile rendering** | built | Does not reduce load time; removes the blank-rectangle wait. Perceived, not real |
| A10 | **Exact manifest generated from the package** | built | Warming exact versioned URLs, no normalisation, so every warm request is a real cache key |
| A11 | **Governor declines when warming is not worth it** | built | Save-Data, metered link, hidden page, budget exhausted. Declining is a correct outcome |

**Ceiling of Section A:** with everything warm, ~6.2 s for this title. A2–A8 get you to that floor
faster and more cheaply; they cannot beat it.

---

## B. Package-side findings — where the real time is

These require the provider to change the package. We cannot do them, and we must not claim we can.
They are worth far more than everything in Section A combined, and handing FEG this list is a
result in itself.

### B1. The `@0.5x` resolution tier is not a low-resolution tier — **STATIC, verified**

**22 of 23 texture pairs are byte-identical between `@1x` and `@0.5x`.**

```
@1x    31,373,895 bytes
@0.5x  31,372,489 bytes      difference: 1,406 bytes
```

| Asset | @1x | @0.5x | ratio |
|---|---:|---:|---:|
| king_character.png | 4,751,493 | 4,750,087 | 0.99 |
| BG_king_2.png | 3,508,090 | 3,508,090 | **1.00** |
| bigwins.png | 3,128,206 | 3,128,206 | **1.00** |
| king_character_2.png | 2,484,770 | 2,484,770 | **1.00** |

A mobile device that correctly selects `@0.5x` still downloads and decodes **full-resolution
textures**. A genuine half-resolution tier is a quarter of the pixels and would plausibly be
~8 MB rather than 31 MB.

**This single fix is worth roughly 23 MB on mobile — several times more than every caching
optimisation we built.** It is also the cheapest possible change for the provider: re-export the
existing art at the resolution the folder name already claims.

### B2. 25.5 MB of the package is redundant bytes — **STATIC, measured by content hash**

68 duplicate content groups across 136 files. Beyond the resolution tiers, `images/@1x` and
`images/@0.5x` also carry identical `brandLogo.png`, `loader_anim.gif`,
`controlPanelAssets.json`, and `controlPanelPrimaryAssets.json`.

### B3. Both audio codecs ship, only one is ever fetched — **STATIC**

| | Size | Files |
|---|---:|---:|
| mp3 | 12 MB | 51 |
| ogg | 16 MB | 51 |

Chromium fetches **ogg only**. The mp3 set is 12 MB of dead weight in the package. Also note the
browser is fetching the *larger* of the two encodings — serving mp3 where supported would cut
~4 MB from the actual transfer.

### B4. Audio is fetched eagerly, before the game is ready — **MEASURED**

The 51 ogg files start at 2,369 ms and finish at 7,076 ms, during initial load. Background music
is not required to render a first screen or accept a first spin. Deferring audio until after first
interaction would remove **~16 MB** from the path to ready. We cannot defer it: the certified code
requests it.

### B5. PNG dominates the package — **STATIC size, ESTIMATED saving**

| Format | Files | Size |
|---|---:|---:|
| **png** | 92 | **50.8 MB** |
| webp | 15 | 3.4 MB |
| jpg | 9 | 0.8 MB |

The package already uses WebP for 15 assets, so the pipeline supports it. Converting the remaining
PNG atlases typically saves 25–35% — on 50.8 MB that is roughly **13–18 MB**. **This is an
estimate.** No encoder was available on the test machine, so we did not verify it and it is not
counted anywhere as a measured result.

### B6. Development artefacts ship to production — **STATIC**

```
assets/panel/cheat.json
assets/panel/devUtils/cheatTool.css
assets/panel/devUtils/cheatTool.ts
assets/panel/devUtils/devUtilities.ts
assets/panel/ts/GameRulesPanel.ts      (10 KB)
assets/panel/ts/HistoryPanel.ts        (26 KB)
assets/panel/ts/SlotRuleLoader.ts      (22 KB)
assets/panel/ts/zoomDisable.ts         ( 6 KB)
```

76 KB of TypeScript **source** plus a cheat tool and its config. Small in bytes, but this is
uncompiled source and a cheat utility shipped in a certified gambling package. Worth raising for
reasons beyond load time.

### B7. Fonts are unsubsetted — **STATIC**

931 KB across four TTFs, largest `Roboto.ttf` at 476 KB, all under `fonts/en/`. Subsetting to the
glyphs actually used typically removes most of that. These are on the **blocking** path, so the
saving lands where it matters most.

### B8. No parallel shader compilation

`KHR_parallel_shader_compile` is not used. Shader compilation is a real, serialised cold-start cost
inside the engine. Recorded in `CODE.md`; not something we can change.

### B9. One asset is missing from the package — **MEASURED**

`assets/spines/@1x/book.png` returns 404 on every load. 141 of 142 requests succeed.

---

## C. Already handled, or genuinely impossible

Ruled out so nobody spends time re-testing them:

| Idea | Verdict |
|---|---|
| Transfer compression | **Already done.** Production serves `content-encoding: br` and `gzip`; the package ships `.br`/`.gz` for HTML and all four JS bundles |
| Aggressive CDN caching | **Already done.** Provider CDN sends `max-age=608892916`, roughly 19 years, with `ACAO: *` |
| Edge/geographic CDN | Outside our control, and the measurable part — connection setup — is addressed by A3 |
| Better prediction model | Capped at ~13.4% hit@1 from history. See A7; dwell is the only way up |
| Warming everything | 68% faster to first render but 36 MB per launch at a 13.4% hit rate. Indefensible |
| Service worker interception | Excluded by our own architecture constraints, and it would alter certified code's request behaviour |
| Beating 6.2 s by caching | Impossible. That is the warm floor with zero network |

---

## What would actually reach the 500 ms target

Honestly, in order of impact:

1. **Find out what gates "playable."** We measure to *all assets read*. The spin control may
   activate far earlier. If it gates on a subset, warm-cache ready could be 1–2 s rather than 6.2 s.
   **This is the single highest-value unknown and only FEG can answer it.**
2. **A real `@0.5x` tier** (B1) — ~23 MB off mobile, provider-side, cheap to do.
3. **Defer audio past first interaction** (B4) — ~16 MB off the ready path.
4. **Ship one audio codec** (B3) — 12 MB out of the package.
5. **WebP for the remaining atlases** (B5) — estimated 13–18 MB, unverified.
6. Everything in Section A, which makes the remaining bytes free but cannot remove decode and GPU
   upload.

**Our honest position:** 500 ms to fully-ready is not reachable for a 65 MB package by anything
outside it. Items 2–5 are package changes that together could plausibly halve the payload, and only
then does the target become arguable. A smaller title makes it far more plausible — the production
game we probed (Multiplay 81) has an ~11 MB payload, not 65 MB.

---

## Method note

The warm-floor profiling run that would have split the 6,226 ms into decode versus GPU upload
versus script execution was **killed by the operating system for memory** on the test machine. The
6,226 ms total is measured; its internal breakdown is **not**, and is not claimed anywhere above.

---

## Addendum — does implementing items 2–5 solve it?

**Short answer: no. They roughly halve to quarter the problem. They do not reach 500 ms.**

### The launch path, measured

The browser fetches 52.2 MB across 143 requests. Static composition of that path (`@1x` branch,
excluding the mp3 set the browser never requests):

| Component | Size | Share |
|---|---:|---:|
| spines `@1x` (PNG) | 29.9 MB | 56% |
| ogg audio | 15.8 MB | 29% |
| images `@1x` | 3.0 MB | 6% |
| everything else (JS, CSS, fonts, splash, JSON) | 4.8 MB | 9% |
| **total** | **53.6 MB** | |

### What each item actually removes from that path

| Item | Effect on the launch path | Note |
|---|---|---|
| **4. Ship one audio codec** | **none** | The 11.3 MB mp3 set is never fetched. This shrinks the *package*, not the load. Real benefit is storage and integrity, not speed |
| **3. Defer audio past first interaction** | **−15.8 MB** | The largest single removable block |
| **5. WebP for the PNG atlases** | **−7.5 to −10.5 MB** | ESTIMATED at 25–35% of 29.9 MB. Unverified |
| **2. A real `@0.5x` tier** | **−22.4 MB, mobile only** | Desktop `@1x` is unaffected. Quarter-pixel export takes spines from 29.9 MB to roughly 7.5 MB |

### Resulting payload

| Scenario | Launch path |
|---|---:|
| today, desktop `@1x` | 53.6 MB |
| desktop, items 3 + 5 | **~27–30 MB** |
| mobile, items 2 + 3 + 5 | **~11–13 MB** |

### Does that reach 500 ms?

The binding constraint is not bytes on the wire — a warm cache already removes those. It is the
**warm floor**: 6,226 ms measured with essentially zero network, of which 687 ms was reached at
first canvas. Treating 687 ms as fixed cost (script parse, engine init, shader compile) and the
rest as per-byte work gives roughly **110 ms per MB**:

| Scenario | Projected warm floor |
|---|---:|
| today, 52 MB | 6,226 ms *(measured)* |
| desktop, ~28 MB | **~3.7 s** *(projected)* |
| mobile, ~12 MB | **~2.0 s** *(projected)* |
| target | **0.5 s** |

**Even with every one of items 2–5 done, and a perfect cache, the best case is roughly 2 seconds
on mobile — four times over target.** Note that today's warm *first canvas* alone is 687 ms, which
already exceeds 500 ms.

⚠️ **These projections are ESTIMATES.** The affine model above is fitted to two measured points and
was never validated. The run that would have split the 6,226 ms into decode, GPU upload and script
execution was killed by the operating system for memory. Deferring audio also removes OGG *decode*,
which may be disproportionately expensive and would make the mobile figure better than projected.
Treat 2.0 s as an order of magnitude, not a number.

### What would actually reach 500 ms

Only one thing: **the game becoming playable on a small subset of its assets, rather than after all
143 are resident.** That is progressive or streaming asset loading inside the engine — a provider
architecture change, not an asset-size change. No amount of shrinking a package that must be fully
loaded before it is ready will get a 50 MB game to 500 ms.

Two honest routes to a defensible claim:

1. **Establish that "playable" gates on a subset.** We measure to *all assets read* because we have
   no backend. If the spin control activates after, say, 8 MB, the real warm number today may
   already be 1–2 s, and items 2–5 could plausibly bring it near target. **Only FEG can tell us
   this, and it costs nothing to ask.**
2. **Scope the claim to the right metric.** 500 ms to a *rendered, branded, interactive-looking
   screen* is reachable now and gets more reachable with items 2–5. 500 ms to *all assets resident*
   is not reachable for this class of title. These are different promises and should not be
   conflated in the pitch.

---

## Addendum 2 — can we improve the 6.2 s with what is in our hands?

**We cannot reduce it. We can move it entirely off the click path — and this is now MEASURED.**

Pre-creating the game frame hidden during browse takes click-to-ready from **~3.8-4.1 s to 2 ms**
in the sandbox. Details and caveats below.

The 6,226 ms is decode, GPU texture upload and script execution inside certified code, with the
network already removed. Nothing outside the package changes that work. But nothing says it has to
happen *after* the player clicks.

### The one remaining lever: speculative engine initialisation

Today we prefetch **bytes** during browse. The proposal is to prefetch **engine state**: for the
single predicted title, create the game iframe hidden and offscreen while the player is still
browsing, let it do its 6.2 s of work, and on click reveal the already-initialised instance.

```
today      [browse] ──click──> [ 6.2 s decode + GPU ] ──> ready
proposed   [browse ── 6.2 s decode + GPU in hidden iframe ──] ──click──> reveal ──> ready
```

Perceived click-to-ready approaches the cost of revealing an existing frame. The 6.2 s does not
shrink; it stops being on the player's critical path.

### MEASURED — it works, and the risk I flagged did not materialise

I expected browsers to throttle invisible frames and nullify this. **They did not.** Every hiding
strategy loaded the complete package and built its canvas:

| Frame style | Resources loaded | Decoded | Canvas built |
|---|---:|---:|---|
| visible (baseline) | 142 | 49.8 MB | yes |
| offscreen `left:-10000px` | 141 | 49.8 MB | yes |
| `visibility:hidden` | 141 | 49.8 MB | yes |
| **`display:none`** | **141** | **49.8 MB** | **yes** |

Then the payoff, two paired runs — control creates the frame at click, treatment pre-creates it
offscreen during a 25 s browse and reveals it at click:

| Arm | click → ready |
|---|---:|
| control, run 1 | 4,088 ms |
| control, run 2 | 3,794 ms |
| **treatment, both runs** | **2 ms** |

The hidden frame had already loaded all 141 resources and built its canvas before the reveal, so
revealing is free. **This is the single largest improvement available in our layer** — it takes the
entire engine-initialisation cost off the click path.

### What these numbers do and do not mean

- **"Ready" here means 141 resources loaded and a canvas present. It does not mean playable.** The
  package has no reachable backend, so an input-accepted signal does not exist and is not claimed.
- The 3.8–4.1 s control is **not** the same measurement as the 6,226 ms warm floor earlier. That
  one counted the last asset read with a primed cache; this one polls resource count and canvas
  presence. Do not mix the two figures.
- **GPU texture upload was not separately verified.** A canvas element existing is not proof that
  textures were uploaded. The 2 ms reveal is strong circumstantial evidence, but the decisive test
  is a GPU-memory comparison, which we have not run.
- Loopback, no RTT, one machine, two runs.

### It is still expensive, and that governs how it must be used

| Cost | Detail |
|---|---|
| **Waste is an engine, not bytes** | A wrong guess spins up a full game instance and holds its textures. At the measured 13.4% hit@1 on the addressable set, that is wasted roughly 87% of the time |
| Memory and GPU pressure | A second live engine on a mid-range phone could make the lobby itself worse. This must be governed more strictly than byte prefetch, not less |
| Battery and data | Real costs on mobile, and invisible to the player unless we surface them |
| Compliance | The instance must be muted, never visible, never able to wager, never counted as play. The exclusion-register check still gates the reveal and stays blocking |

### What else is in our hands, honestly

| Idea | Verdict |
|---|---|
| Prime the *decoded* image cache from the parent | Very unlikely to help. Decoded-image caches are per-renderer, and a cross-origin game frame is a separate process under site isolation |
| Get assets into memory cache rather than disk cache | **Evidence against.** The 6,226 ms measurement was a reload immediately after a priming load, so assets were as hot as they get. Disk read is not the bottleneck |
| `fetchpriority` on warm requests | Marginal. Affects how fast warming completes, not the floor |
| Reduce contention by warming during browse | **Already the design.** Warming never competes with the launch it is preparing |
| Blocking or delaying the game's audio requests | Rejected. That alters certified code's behaviour, and it is why service workers are excluded from this architecture |

### An important caveat on the 6.2 s itself

It was measured in a sandbox where `offline-data-*.js` is **absent from the package as supplied**
and `api.spiniq.io` is unreachable. Failed calls, retries or timeouts may be inflating it. The
figure is honest for our environment but **may not be the figure in a complete one**, and it should
be re-measured the moment a working backend is available.
