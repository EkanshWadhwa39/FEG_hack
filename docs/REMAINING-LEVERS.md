# Remaining levers — everything not yet built

Companion to `docs/OPTIMISATION-INVENTORY.md`, which records what *is* built and
what was measured. This file is the other half: every optimisation we can name
that is not in the code yet, with an honest verdict on each.

Labels: **MEASURED** (we ran it), **STATIC** (verified by inspecting the package
or the spec), **ESTIMATED** (industry-typical, unverified here), **UNKNOWN**.

Ranked within each section by value per unit of effort.

---

> **Status update.** D1–D7 are now **built and wired**, along with a new lever
> not in the original list: poster discipline (320×320 WebP at ~7.6 KB, intrinsic
> dimensions so the grid cannot shift, first rail eager and the rest lazy). See
> `docs/SPECULATION-LADDER.md` for how, and the per-item notes below for what
> each one actually became. Still unbuilt in section D: D8, D9, D10, D11, D12.
> Sections E and F remain other people's to do.

## D. In our layer — web only, no certified code change

### D1. Warm the last-played title at lobby load, before any intent — **BUILT**

`recents[0]` was **MEASURED at 30.4% hit@1** on 3,337 real launch sequences
(`docs/PREFETCH-POLICY.md`). That beats waiting for a hover, because it needs no
hover: the cost is 2.8 MB spent once at lobby paint, and one launch in three lands
on it. Today the ladder only starts when a tile is looked at, so a player who
opens the lobby and taps their usual game immediately gets nothing.

**As built:** `selectLobbyLoadWarmSet` in `prototype/src/warm-memory.js`, called once
the manifests arrive. Recents first, favourites as the fallback for a player with no
session history, capped at two titles, and it returns `rung: "WARM"` — it structurally
cannot reach the engine rung, because 30% is not a defensible hit rate for 52 MB.

### D2. Remember what is already cached, across sessions — **BUILT**

**57.5% of repeat launches are already cached** (provider CDN `max-age` ≈ 19
years). Warming those is pure waste, and worse, it consumes the session byte
budget that a *cold* title needed.

Store `{titleId, bundleVersion, warmedAt}` in `localStorage`, skip any title whose
recorded version matches, and spend the budget on something else. There is no
reliable API to ask the browser "is this URL in your cache", so a local record is
the only available proxy — it can be wrong after an eviction, and being wrong
costs one redundant warm, which is the cheap direction to be wrong in.

**As built:** `createWarmMemory` in `prototype/src/warm-memory.js`. Keyed by
`gameId@bundleVersion`, 6-hour TTL, 120-entry cap, and every storage path wrapped so
that private browsing, disabled storage and quota errors degrade to "we know nothing"
rather than to "it's warm".

### D3. Keep the last engine alive after the player exits a game — **BUILT**

Repeat launches dominate. When a player returns to the lobby, the game iframe is
destroyed today. Holding it hidden for a bounded window (30–60 s, and released on
memory pressure) makes re-entry a reveal rather than a rebuild — the same 73 ms
path the ladder already produces, with no prediction required at all.

Compliance note: the retained instance must stay muted, non-wagering, and must not
count as play. The exclusion check still gates re-reveal.

**As built:** `preinit.retain()` hides the revealed frame instead of destroying it,
and the lobby releases it after 45 s or as soon as intent moves elsewhere. Re-entry is
**MEASURED at 0 ms** in the sandbox. `src` is never touched, because re-navigating
would reload the frame and throw away exactly what is being kept.

### D4. Preconnect every likely game origin at lobby paint — **BUILT (single origin)**

**Top 5 providers = 69.8% of stake, top 10 = 90.9%** (MEASURED). That is five
origins covering two-thirds of launches. A production `session/create` was measured
at 1,849 ms of which **1,046 ms was TCP connect** and only 303 ms was server wait.

The ladder's free rung already preconnects, but only once a tile has been seen.
Emitting five `<link rel="preconnect">` at lobby paint costs five sockets the
browser will very likely open anyway.

**As built:** the lobby emits `dns-prefetch` + `preconnect` for the game origin at
first paint, through the real `connection-prewarm.js` boundary. The sandbox has one
game origin; production would emit five.

Caveat: the causal milliseconds saved by hints remain **UNKNOWN** until an isolated
approved-environment comparison is run. Do not put a number on this in the pitch.

### D5. `fetchpriority="low"` on every speculative request — **BUILT**

Speculation should never compete with the lobby's own critical path, and today it
can. `fetch(url, { priority: "low" })` is one argument. Chromium supports it;
elsewhere it is ignored, which is the safe direction.

**As built:** every speculative `fetch` carries `priority: "low"`; posters below the
first rail carry `fetchpriority="low"` and `loading="lazy"`. **STATIC** benefit, not
measured.

### D6. Governed on connection, not on the device — **BUILT**

The engine rung costs ~52 MB of RAM and a GPU texture set. It is currently gated
only on link quality. A mid-range phone on good wifi is exactly the device where a
speculative engine can make the lobby itself worse.

Add to the `FULL` tier test: `navigator.deviceMemory` (≥ 4 GB), and refuse the
engine rung when `navigator.getBattery()` reports discharging below ~20%. Both APIs
are absent on some browsers — absence must degrade to `REDUCED`, following the same
rule the connection capability now uses.

**As built:** `assessDeviceForEngine` + `applyDeviceConstraint` in `governor.js`. A
device constraint can only ever *lower* the tier, never raise one or overturn a
refusal. This is a *safety* lever, not a speed one, and it is what makes the engine
rung defensible on mobile at all.

### D7. Pointer-trajectory prediction — **BUILT**

Start the ladder for the tile the cursor is *heading toward*, before it arrives.
Buys 100–300 ms of head start on desktop. Well-understood technique; the risk is
false positives, which at the `CONNECT` and `WARM` rungs cost almost nothing.

**As built:** `prototype/src/trajectory.js`. Ray/box intersection over a 220 ms
horizon, refusing movement that is too slow (browsing, not travelling), too turbulent
(circling or hesitating), or aimed at a tile the pointer is already inside. The
prediction reaches the **free rung only** — a wrong guess opens a socket the browser
would very likely have opened anyway. **ESTIMATED** benefit; the mechanism is tested,
the milliseconds saved are not.

### D8. Scroll-velocity gating for the touch path — still unbuilt

`createViewportDwell` currently credits any settled viewport. Adding velocity means
a slow, deliberate scroll credits sooner and a flick never credits at all. Refines
D-tier touch intent rather than adding a new signal.

### D9. Paint the warmed splash immediately in the transition screen — still unbuilt

The blocking profile includes the splash art. Once warmed it can be painted in our
own transition screen at effectively zero cost, which puts a branded, correct
first screen up **well under 500 ms** while the engine finishes behind it.

This is a **perceived** improvement and must be labelled as one. It is not
readiness, and the transition screen must still refuse to clear until an
authoritative input-accepted signal arrives. Done carelessly this becomes the exact
thing `CODE.md` forbids — a fake checkpoint filling loading time — so the screen
must show real state (RG figures, a truthful "opening" status) and never imply the
game is ready.

### D10. `requestIdleCallback` warming of favourites

Spend genuine idle time, inside the budget, on the player's own favourites. Lower
value than D1 (favourites are a weaker signal than last-played) but strictly free
in wall-clock terms.

### D11. Speculation Rules API (`prerender`) — **conditional, probably not applicable**

If a launch were a top-level navigation, `<script type="speculationrules">` with
`prerender` would let the browser build the entire next document, which is a
stronger version of what our engine rung does by hand. Our topology is a
cross-origin **iframe** inside the lobby, and prerender does not apply to iframes.

Worth revisiting only if PSK's real launch flow turns out to be a navigation. Ask.

### D12. Warm during the exclusion-register check — **REJECTED by our own rules**

There is real dead time between the click and the authorization response. It is
tempting. `CODE.md` forbids it: warming "must never overlap or race the
authorization check". Recorded here so nobody rediscovers it and assumes it was an
oversight.

---

## E. Operator-side — PSK's own platform, no provider change

### E1. Fix the 404 probe — **MEASURED, free**

`gamecontainer-eu.psk.hr/GameView/Egaming` returns 404 on every production launch
and costs a measured **712 ms** before falling back to a generic container view.
Already in the inventory as A8; still not fixed, and it is the cheapest real
millisecond on the list.

### E2. `103 Early Hints` from the game container

The container can emit `103 Early Hints` carrying `preload` links for the game's
blocking bundles before the HTML response is ready. Standard, deployable, and it
does not touch certified code. Chromium and Safari support it.

**ESTIMATED**: worth roughly one round trip plus server think-time on the blocking
JS, which on the measured connection profile is a large fraction of a second.

### E3. HTTP/3, and check connection coalescing

143 requests is a lot of requests. Confirm the game origin is served over h2/h3
with a shared connection; on h1 with six sockets and real RTT the request count
alone is a significant serial cost. Our sandbox runs HTTP/1.1, which means our cold
baseline is, if anything, *pessimistic* — worth stating rather than quietly
benefiting from.

### E4. Serve `.br` where the client accepts it

The package ships `.br` and `.gz` for HTML and all four JS bundles. Production
already sends `content-encoding: br` (verified). Confirm the same for the staging
path when it returns.

---

## F. Provider-side — package changes we cannot make

`docs/OPTIMISATION-INVENTORY.md` section B already covers: the fake `@0.5x` tier
(~23 MB on mobile), 25.5 MB of duplicate content, both audio codecs shipping,
eager audio (~16 MB before ready), PNG-dominated atlases, dev artefacts in a
certified package, unsubsetted fonts, no parallel shader compile, and one 404.

Three that are **not** in that list and are worth more than most of it:

### F1. GPU-native texture compression (KTX2 / Basis) — **the best answer to the warm floor**

The inventory's hard boundary is 6,226 ms with a perfect cache: decode, GPU upload
and script execution, with the network already removed. Nothing in section A or D
touches it.

Texture compression does. Shipping KTX2/Basis (transcoding to ETC2, ASTC or BC7 on
the device) instead of PNG:

- removes **PNG decode entirely** — the textures are uploaded in their compressed
  form,
- cuts GPU memory roughly 4–6×,
- and shrinks the wire payload substantially on top of that.

30 MB of PNG spine atlases is the single largest block in the launch path. This is
the one provider change that attacks the floor itself rather than the bytes on the
way to it.

**ESTIMATED.** We did not measure it; no transcoder was available on the test
machine. But unlike WebP (B5), which only shrinks transfer, this removes decode and
upload work — which is where the 6.2 s actually goes.

### F2. Preload hints in the package's own `index.html`

Four content-hashed JS bundles are discovered only after the HTML parser reaches
them. `<link rel="preload" as="script">` for each, emitted by the build, starts
them one round trip earlier. A build-config change, not a code change.

### F3. Atlas consolidation

143 requests for one title. Fewer, larger atlases reduce per-request overhead,
which matters most on the high-RTT mobile links where the problem is worst.

---

## The honest bottom line, unchanged

`docs/OPTIMISATION-INVENTORY.md` concludes that 500 ms to *all assets resident* is
not reachable for a 52 MB package by anything outside it, and that stands. What
changed is that we no longer need it to be:

- **click → engine rendering: 73 ms MEASURED**, because the engine rung moves the
  work off the click path entirely rather than trying to shrink it.
- **click → all assets resident: 0 further network**, for the same reason.

The remaining honest gaps are (a) whether "playable" gates on all 143 assets or a
subset — **only FEG can answer this, and it costs nothing to ask**; (b) the ~13-30%
hit rate, which D1–D3 attack directly; and (c) that none of this is validated
against staging, which remains a blocking later gate and not a hackathon claim.
