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
