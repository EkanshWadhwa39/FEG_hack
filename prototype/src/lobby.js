/**
 * The sandbox lobby: a PSK-shaped game grid wired to the speculation ladder.
 *
 * Everything visible here is a stand-in built from FEG-supplied bytes. What is
 * real is the machinery underneath: resting on a tile climbs a graduated
 * ladder, and clicking a tile that has reached the top rung reveals an engine
 * that was already built.
 *
 * Levers wired in this file, beyond the ladder itself:
 *
 *   1. **Preconnect at first paint** — the game origin's DNS, TCP and TLS are
 *      resolved before any tile is touched. A production `session/create` was
 *      measured at 1,849 ms of which 1,046 ms was connection setup.
 *   2. **Warm the continue-playing rail at load** — the player's own last-played
 *      title is MEASURED at 30.4% hit@1, and unlike dwell it needs no
 *      interaction, so a player who opens the lobby and immediately taps their
 *      usual game still gets a warm launch.
 *   3. **Cross-session warm memory** — 57.5% of repeat launches were MEASURED as
 *      already cached. Re-warming them wastes the budget a cold title needed.
 *   4. **Pointer-trajectory prediction** — the free rung fires against the tile
 *      the cursor is travelling toward, buying back the 200-400 ms traversal.
 *   5. **Device-aware governance** — a constrained phone gets bytes, never a
 *      speculative engine, however good its link is.
 *   6. **Engine retention on exit** — returning to the lobby hides the engine
 *      rather than destroying it, so re-entry is a reveal.
 *   7. **Poster discipline** — small square WebP with intrinsic dimensions, the
 *      first rail eager and high priority, the rest lazy. A lobby that shifts
 *      or stalls under its own thumbnails has lost before a game is chosen.
 */

import { buildCatalogue, buildRails, RAIL_TITLES } from "./catalogue.js";
import { createDwellTracker } from "./dwell.js";
import { attachTileIntent, createViewportDwell } from "./intent-sources.js";
import {
  SpeculationTier,
  applyDeviceConstraint,
  assessDeviceForEngine,
  assessPrefetch,
  readConnectionCapability,
} from "./governor.js";
import {
  Rung,
  SpeculationAction,
  createByteLedger,
  planSpeculation,
} from "./speculation.js";
import { applyPosterFallback } from "./poster-fallback.js";
import { createTrajectoryTracker } from "./trajectory.js";
import { createWarmMemory, selectLobbyLoadWarmSet } from "./warm-memory.js";
import { warmAssets } from "./warmer.js";
import { createBrowserConnectionPrewarmer } from "./connection-prewarm.js";
import { Authorization, createPreinitManager } from "./preinit.js";

/** How long a departed engine is held before its memory is reclaimed. */
export const ENGINE_RETENTION_MS = 45_000;

/** Ladder re-evaluation period. Dwell decays, so this cannot be event-driven. */
const TICK_MS = 200;

/** How long to wait for any manifest before saying the provider is not there. */
const PROVIDER_TIMEOUT_MS = 4_000;

export function startLobby({
  gameOrigin,
  gameCount = 24,
  maxRung = null,
  document: documentImpl = globalThis.document,
} = {}) {
  const $ = (id) => documentImpl.getElementById(id);

  const catalogue = buildCatalogue({ count: gameCount, gameOrigin });
  const byId = new Map(catalogue.map((item) => [item.id, item]));

  const dwell = createDwellTracker();
  /**
   * Viewport focus gets its own tracker, kept apart from real dwell.
   *
   * "This tile is in the middle of a settled screen" is a guess about
   * attention, not a report of it — nobody touched anything. Merging it into
   * the same tracker as hover and focus would let a phone left face-up on a
   * table accumulate enough apparent intent to buy an engine for whatever
   * happens to be on screen. Kept separate, it can be merged in at a strength
   * that only ever reaches the byte rung.
   */
  const viewportIntent = createDwellTracker();
  const trajectory = createTrajectoryTracker();
  const preinit = createPreinitManager({ host: $("frame-host") });
  const prewarmConnection = createBrowserConnectionPrewarmer();
  const ledger = createByteLedger({ byteBudget: 96 * 1_048_576 });
  const warmMemory = createWarmMemory();

  const manifests = new Map();
  const connected = new Set();
  const warmed = new Set(warmMemory.snapshot().filter((id) => byId.has(id)));
  const warmInFlight = new Set();
  const warmAborts = new Map();
  const tileNodes = new Map();

  let committed = null;
  let predicted = null;
  let recents = [];
  let favourites = catalogue.slice(3, 9).map((item) => item.id);
  let lastPlan = null;
  let retentionTimer = null;
  let device = { engineAllowed: true, reason: "OK" };

  /* -------------------------- device capability ------------------------- */

  device = assessDeviceForEngine({ deviceMemory: globalThis.navigator?.deviceMemory });
  globalThis.navigator?.getBattery?.().then((battery) => {
    const reassess = () => {
      device = assessDeviceForEngine({
        deviceMemory: globalThis.navigator?.deviceMemory,
        battery: { level: battery.level, charging: battery.charging },
      });
    };
    reassess();
    battery.addEventListener?.("levelchange", reassess);
    battery.addEventListener?.("chargingchange", reassess);
  }).catch(() => { /* API absent: no evidence of a constrained device. */ });

  /* ------------------------------ rendering ----------------------------- */

  function renderTile(item, { eager, index }) {
    const button = documentImpl.createElement("button");
    button.type = "button";
    button.className = "tile";
    button.dataset.gameId = item.id;
    button.setAttribute("aria-label", `${item.title}, ${item.provider}`);

    const poster = documentImpl.createElement("img");
    poster.src = item.poster;
    poster.alt = "";
    // Intrinsic dimensions match the square layout box, so arriving posters
    // cannot shift the grid. The first rail is above the fold and competes with
    // nothing; everything below it waits until it is scrolled to.
    poster.width = 320;
    poster.height = 320;
    poster.decoding = "async";
    poster.loading = eager ? "eager" : "lazy";
    poster.fetchPriority = eager ? "high" : "low";
    // The generated posters only exist when tools/sandbox_server.py is serving
    // the lobby. Everywhere else they 404, and without this the lobby renders
    // as a grid of empty rectangles.
    applyPosterFallback(poster, index);

    const overlay = documentImpl.createElement("span");
    overlay.className = "tile-overlay";
    const title = documentImpl.createElement("span");
    title.className = "tile-title";
    title.textContent = item.title;
    const provider = documentImpl.createElement("span");
    provider.className = "tile-provider";
    provider.textContent = item.provider;
    overlay.append(title, provider);

    const labels = documentImpl.createElement("span");
    labels.className = "tile-labels";
    if (item.chip) {
      const chip = documentImpl.createElement("span");
      chip.className = "chip";
      chip.style.backgroundColor = item.chip.background;
      chip.textContent = item.chip.text;
      labels.append(chip);
    }

    // Operator instrumentation. Hidden unless the overlay is switched on: a
    // player-visible "ready" badge would surface the predictor, which is the
    // one thing this architecture promises never to do.
    const state = documentImpl.createElement("span");
    state.className = "tile-state";
    state.dataset.rung = "NONE";
    state.textContent = "";

    button.append(poster, overlay, labels, state);

    attachTileIntent({
      element: button,
      gameId: item.id,
      dwell,
      onCommit: (gameId) => { committed = gameId; tick(); },
      onRelease: (gameId) => { if (committed === gameId) committed = null; },
    });
    button.addEventListener("click", () => launch(item));

    if (!tileNodes.has(item.id)) tileNodes.set(item.id, []);
    tileNodes.get(item.id).push({ button, state });
    return button;
  }

  function renderRails() {
    const host = $("rails");
    const rails = buildRails({ catalogue, recents, favourites });
    host.replaceChildren(...rails.map((rail, railIndex) => {
      const section = documentImpl.createElement("section");
      section.className = "rail";

      const head = documentImpl.createElement("div");
      head.className = "rail-head";
      const heading = documentImpl.createElement("h2");
      heading.id = `rail-${rail.rail}`;
      // The demo runs in English. The production lobby is Croatian, and the
      // heading it actually uses is kept beside it as a small label: it is the
      // evidence that these rails are the site's own, not invented for a demo.
      heading.textContent = RAIL_TITLES[rail.rail].en;
      const original = documentImpl.createElement("span");
      original.className = "rail-en";
      original.lang = "hr";
      original.textContent = RAIL_TITLES[rail.rail].hr;
      const note = documentImpl.createElement("span");
      note.className = "rail-note";
      note.textContent = rail.personalised
        ? "your own history — not a recommendation"
        : "same order for every player";
      head.append(heading, original, note);

      const track = documentImpl.createElement("div");
      track.className = "rail-track";
      track.setAttribute("role", "list");
      track.setAttribute("aria-labelledby", heading.id);
      // The measurement harness addresses the first track by this id.
      if (railIndex === 0) track.id = "grid";
      for (const item of rail.items) {
        const li = documentImpl.createElement("div");
        li.setAttribute("role", "listitem");
        // Poster palette follows catalogue position, so a title looks the same
        // wherever it appears.
        const index = catalogue.findIndex((entry) => entry.id === item.id);
        li.append(renderTile(item, { eager: railIndex === 0, index: Math.max(0, index) }));
        track.append(li);
      }

      section.append(head, track);
      return section;
    }));
  }

  /* ------------------------------ manifests ----------------------------- */

  function loadManifests() {
    for (const item of catalogue) {
      fetch(`${item.url}warm-manifest.json`)
        .then((response) => response.json())
        .then((manifest) => {
          manifests.set(item.id, manifest);
          refreshManifestLabel();
        })
        .catch(() => { /* a title without a manifest is simply never warmed */ });
    }
    // An unreachable provider is a normal state for this page — the lobby is
    // designed to keep working without one — but it must not present as
    // "loading…" indefinitely, because the reader cannot tell that apart from a
    // slow network and will assume the demo is broken.
    globalThis.setTimeout(() => {
      if (manifests.size === 0) reportProviderUnreachable();
    }, PROVIDER_TIMEOUT_MS);
  }

  function reportProviderUnreachable() {
    $("m-manifest").textContent = "no provider reachable";
    $("m-manifest").dataset.flag = "ELEVATED";
    const notice = $("provider-warning");
    if (notice == null) return;
    notice.hidden = false;
    notice.querySelector("[data-origin]").textContent = gameOrigin || "(none configured)";
  }

  function refreshManifestLabel() {
    const any = manifests.values().next().value;
    if (any == null) return;
    const notice = $("provider-warning");
    if (notice != null) notice.hidden = true;
    $("m-manifest").dataset.flag = "NORMAL";
    $("m-manifest").textContent =
      `${manifests.size}/${gameCount} · warm ${any.warmFiles} files `
      + `${(any.warmBytes / 1048576).toFixed(1)} MB · package `
      + `${(any.totalBytes / 1048576).toFixed(0)} MB`;
  }

  /* ------------------------------- governor ----------------------------- */

  const capTier = (tier) =>
    (maxRung === "WARM" && tier === SpeculationTier.FULL ? SpeculationTier.REDUCED : tier);

  function governorNow(nextAssetBytes) {
    // The baseline arm wins over the demo override: a control that can be
    // silently switched back on is not a control.
    if ($("override").checked && !$("disable-spec").checked) {
      return Object.freeze({
        allowed: true,
        reason: "OVERRIDDEN_FOR_DEMO",
        tier: capTier(device.engineAllowed ? SpeculationTier.FULL : SpeculationTier.REDUCED),
        remainingBytes: ledger.remaining(),
        projectedBytes: null,
        deviceReason: device.reason,
      });
    }
    const decision = applyDeviceConstraint(
      assessPrefetch({
        enabled: !$("disable-spec").checked,
        ...readConnectionCapability(),
        visibilityState: documentImpl.visibilityState,
        byteBudget: ledger.byteBudget,
        bytesUsed: ledger.bytesUsed(),
        nextAssetBytes,
      }),
      device,
    );
    return decision.allowed
      ? Object.freeze({ ...decision, tier: capTier(decision.tier) })
      : decision;
  }

  const authorization = () =>
    ($("deny-auth").checked ? Authorization.DENIED : Authorization.GRANTED);

  /* -------------------------------- rungs ------------------------------- */

  function abortAllWarming(reason) {
    if (warmAborts.size === 0) return;
    for (const [gameId, controller] of warmAborts) {
      controller.abort();
      ledger.refund(gameId, Rung.WARM);
    }
    warmAborts.clear();
    $("status").textContent = `Speculative warming stopped: ${reason}.`;
  }

  async function warmBytes(gameId, estimatedBytes) {
    const item = byId.get(gameId);
    const manifest = manifests.get(gameId);
    if (!item || !manifest || warmInFlight.has(gameId) || warmed.has(gameId)) return;

    warmInFlight.add(gameId);
    const controller = new AbortController();
    warmAborts.set(gameId, controller);
    ledger.charge(gameId, Rung.WARM, estimatedBytes || manifest.warmBytes);
    const started = performance.now();
    try {
      const summary = await warmAssets({
        plan: {
          locale: "hr-HR",
          tier: "1x",
          assets: manifest.assets.map((asset) => ({
            ...asset,
            url: `${item.url}${asset.url}`,
          })),
        },
        target: { locale: "hr-HR", tier: "1x" },
        concurrency: 2,
        signal: controller.signal,
        requestAsset: (url, { signal }) => fetch(url, {
          mode: "no-cors",
          credentials: "omit",
          signal,
          // Speculation must never compete with the lobby's own critical path.
          priority: "low",
        }),
      });
      if (controller.signal.aborted) {
        ledger.refund(gameId, Rung.WARM);
        return;
      }
      warmed.add(gameId);
      warmMemory.remember(gameId, manifest.resolution ?? "");
      globalThis.__WARM_DONE__ = (globalThis.__WARM_DONE__ ?? 0) + summary.requested;
      $("status").textContent =
        `Warmed ${summary.requested}/${summary.attempted} blocking assets for `
        + `${item.title} in ${Math.round(performance.now() - started)} ms, during browse.`;
    } catch {
      ledger.refund(gameId, Rung.WARM);
    } finally {
      warmInFlight.delete(gameId);
      warmAborts.delete(gameId);
    }
  }

  function execute(action) {
    const item = byId.get(action.gameId);
    if (!item) return;
    switch (action.action) {
      case SpeculationAction.PREWARM_CONNECTION:
        connected.add(action.gameId);
        prewarmConnection(item.url).catch(() => connected.delete(action.gameId));
        break;
      case SpeculationAction.WARM_BYTES:
        warmBytes(action.gameId, action.estimatedBytes);
        break;
      case SpeculationAction.PREPARE_ENGINE:
        ledger.charge(action.gameId, Rung.PREINIT, action.estimatedBytes);
        preinit.prepare(action.gameId, item.url);
        break;
      case SpeculationAction.CANCEL_ENGINE:
        preinit.cancel();
        ledger.refund(action.gameId, Rung.PREINIT);
        break;
      default:
        break;
    }
  }

  /* -------------------------------- ticking ----------------------------- */

  function tick() {
    const candidates = dwell.snapshot();
    const anyManifest = manifests.values().next().value;
    const governor = governorNow(anyManifest?.warmBytes ?? 0);

    // Weak signals are appended below real dwell, never ranked among it, and
    // both carry `currentMs: 0` so neither can ever reach the engine rung.
    //
    //   - a predicted destination is worth exactly the free rung;
    //   - a tile centred in a settled viewport is worth bytes at most.
    //
    // Only a pointer or finger actually resting on a tile buys an engine.
    const seen = new Set(candidates.map((entry) => entry.gameId));
    const weak = [];
    for (const entry of viewportIntent.snapshot()) {
      if (seen.has(entry.gameId)) continue;
      seen.add(entry.gameId);
      weak.push({ gameId: entry.gameId, score: entry.score, currentMs: 0 });
    }
    if (predicted != null && !seen.has(predicted)) {
      weak.push({ gameId: predicted, score: 1, currentMs: 0 });
    }
    const ranked = weak.length > 0 ? [...candidates, ...weak] : candidates;

    const plan = planSpeculation({
      candidates: ranked,
      committed,
      authorization: authorization(),
      governor,
      connected: [...connected],
      warmed: [...warmed],
      preinit: preinit.getState(),
      costs: {
        warmBytes: anyManifest?.warmBytes ?? 0,
        engineBytes: anyManifest?.totalBytes ?? 0,
      },
      budget: { byteBudget: ledger.byteBudget, bytesUsed: ledger.bytesUsed() },
    });
    lastPlan = plan;

    if (plan.refusedBecause === "AUTHORIZATION" || plan.refusedBecause === "GOVERNOR") {
      abortAllWarming(plan.refusedBecause === "AUTHORIZATION"
        ? "authorization was withdrawn"
        : `the governor declined (${governor.reason})`);
    }

    if (preinit.getState().state !== "REVEALED") {
      for (const action of plan.actions) execute(action);
    }
    render(ranked, governor, plan);
  }

  function render(candidates, governor, plan) {
    const top = candidates[0] ?? null;
    $("m-dwell").textContent = committed
      ? `${committed} (touch-down)`
      : top ? `${top.gameId} (${top.score} ms)` : "none";
    $("m-predicted").textContent = predicted ?? "—";
    $("m-gov").textContent = governor.reason;
    $("m-gov").dataset.flag = governor.allowed ? "NORMAL" : "ELEVATED";
    $("m-tier").textContent = governor.deviceReason && governor.deviceReason !== "OK"
      ? `${governor.tier} (${governor.deviceReason})`
      : governor.tier;
    $("m-tier").dataset.flag =
      governor.tier === SpeculationTier.FULL ? "NORMAL"
        : governor.tier === SpeculationTier.REDUCED ? "ELEVATED" : "UNKNOWN";
    $("m-rung").textContent = plan.rung === Rung.NONE && plan.refusedBecause
      ? `NONE (${plan.refusedBecause})`
      : plan.rung;
    $("m-rung").dataset.flag =
      plan.rung === Rung.PREINIT ? "NORMAL"
        : plan.rung === Rung.NONE ? "UNKNOWN" : "ELEVATED";
    $("m-connect").textContent = String(connected.size);
    $("m-warm").textContent = warmed.size === 0 ? "none" : `${warmed.size} titles`;
    $("m-budget").textContent =
      `${(ledger.bytesUsed() / 1048576).toFixed(1)} / `
      + `${(ledger.byteBudget / 1048576).toFixed(0)} MB`;
    $("m-auth").textContent = authorization();
    $("m-auth").dataset.flag = authorization() === "GRANTED" ? "NORMAL" : "ELEVATED";

    const state = preinit.getState();
    $("m-preinit").textContent = state.gameId ? `${state.state} (${state.gameId})` : state.state;
    $("m-preinit").dataset.flag =
      state.state === "PREPARED" || state.state === "REVEALED" ? "NORMAL"
        : state.state === "PREPARING" ? "ELEVATED" : "UNKNOWN";

    renderTileStates(plan, state);
  }

  function renderTileStates(plan, preinitState) {
    for (const [gameId, nodes] of tileNodes) {
      let rung = "NONE";
      let text = "";
      if (preinitState.gameId === gameId
        && (preinitState.state === "PREPARED" || preinitState.state === "REVEALED")) {
        rung = "PREINIT"; text = "ENGINE";
      } else if (preinitState.gameId === gameId && preinitState.state === "PREPARING") {
        rung = "PREINIT"; text = "ENGINE…";
      } else if (warmed.has(gameId)) {
        rung = "WARM"; text = "BYTES";
      } else if (warmInFlight.has(gameId)) {
        rung = "WARM"; text = "BYTES…";
      } else if (connected.has(gameId)) {
        rung = "CONNECT"; text = "CONN";
      }
      for (const node of nodes) {
        if (node.state.dataset.rung !== rung) node.state.dataset.rung = rung;
        if (node.state.textContent !== text) node.state.textContent = text;
      }
    }
    void plan;
  }

  /* -------------------------------- launch ------------------------------ */

  function logRun(item, ms, path, detail) {
    const li = documentImpl.createElement("li");
    const label = documentImpl.createElement("span");
    label.textContent = `${item.title} — ${path}: ${ms} ms`;
    const note = documentImpl.createElement("span");
    note.className = "run-detail";
    note.textContent = detail;
    li.append(label, note);
    $("runs").prepend(li);
  }

  function launch(item) {
    const started = performance.now();
    // Authorization blocks. It is never raced, cached, or rendered past.
    const decision = authorization();

    if (retentionTimer != null) {
      globalThis.clearTimeout(retentionTimer);
      retentionTimer = null;
    }

    const revealed = preinit.reveal({ authorization: decision, expectGameId: item.id });
    if (revealed.revealed) {
      const ms = Math.round(performance.now() - started);
      globalThis.__LAUNCH_MS__ = ms;
      globalThis.__LAUNCH_PATH__ = "PREINIT";
      $("status").textContent =
        `${item.title}: revealed a pre-initialised engine in ${ms} ms. `
        + "It was built while you were browsing.";
      logRun(item, ms, "PRE-INITIALISED",
        "engine built during browse; reveal is a style change");
      afterLaunch(item);
      return;
    }

    if (decision !== Authorization.GRANTED) {
      globalThis.__LAUNCH_PATH__ = "BLOCKED";
      $("status").textContent =
        `${item.title}: blocked. The exclusion-register check did not grant `
        + "authorization, so nothing was started.";
      return;
    }

    // Cold path. The frame is attached immediately rather than after a wait, so
    // the player sees the game's own preloader instead of a blank panel.
    const frame = documentImpl.createElement("iframe");
    frame.id = "game";
    frame.title = `${item.title} (sandbox)`;
    frame.src = item.url;
    $("frame-host").replaceChildren(frame);
    const ms = Math.round(performance.now() - started);
    globalThis.__LAUNCH_MS__ = ms;
    globalThis.__LAUNCH_PATH__ = "COLD";
    $("status").textContent =
      `${item.title}: cold launch (${revealed.reason}). Loading — this is the baseline.`;
    logRun(item, ms, "COLD", `${revealed.reason}; the engine starts now, on the click`);
    afterLaunch(item);
  }

  function afterLaunch(item) {
    recents = [item.id, ...recents.filter((id) => id !== item.id)];
    committed = null;
    predicted = null;
    $("exit").hidden = false;
    renderRails();
  }

  /**
   * Leaving a game hides its engine instead of destroying it.
   *
   * Repeat launches dominate real behaviour, and an engine that is merely
   * hidden can be revealed again for the cost of a style change. It is still
   * expensive to hold, so retention is bounded and released early whenever
   * intent moves to a different title.
   */
  function exitToLobby() {
    const state = preinit.getState();
    $("frame-host").replaceChildren();
    $("exit").hidden = true;

    if (state.state === "REVEALED" && typeof preinit.retain === "function") {
      const retained = preinit.retain();
      if (retained.state === "PREPARED") {
        $("frame-host").append(...[]);
        $("status").textContent =
          `Left ${byId.get(state.gameId)?.title ?? state.gameId}. Its engine is held `
          + `for ${ENGINE_RETENTION_MS / 1000} s, so going back in is instant.`;
        retentionTimer = globalThis.setTimeout(() => {
          retentionTimer = null;
          if (preinit.getState().state === "PREPARED") {
            preinit.cancel();
            ledger.refund(state.gameId, Rung.PREINIT);
            $("status").textContent = "Retained engine released.";
          }
        }, ENGINE_RETENTION_MS);
        return;
      }
    }
    preinit.reset();
    $("status").textContent = "Back in the lobby.";
  }

  /* ------------------------------ lobby load ---------------------------- */

  /**
   * Speculation that needs no interaction at all.
   *
   * Runs once the manifests are known. It only ever reaches the byte rung: a
   * 30% hit rate is a fine trade for 2.8 MB and an indefensible one for an
   * engine.
   */
  function warmOnLobbyLoad() {
    const governor = governorNow(manifests.values().next().value?.warmBytes ?? 0);
    if (!governor.allowed || authorization() !== Authorization.GRANTED) return;

    const selection = selectLobbyLoadWarmSet({
      recents,
      favourites,
      alreadyWarm: [...warmed],
      limit: 2,
    });
    for (const gameId of selection.candidates) {
      const manifest = manifests.get(gameId);
      if (!manifest) continue;
      execute({
        action: SpeculationAction.PREWARM_CONNECTION,
        gameId,
      });
      warmBytes(gameId, manifest.warmBytes);
    }
    if (selection.candidates.length > 0) {
      $("status").textContent =
        `Warming ${selection.candidates.length} title(s) at lobby load `
        + `(${selection.sources.join(", ").toLowerCase()}) — no hover needed.`;
    }
  }

  /* --------------------------------- wiring ----------------------------- */

  function attachTrajectory() {
    documentImpl.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse") return;
      trajectory.sample(event.clientX, event.clientY);
      const targets = [];
      for (const [gameId, nodes] of tileNodes) {
        const box = nodes[0]?.button?.getBoundingClientRect?.();
        if (!box || box.width === 0) continue;
        targets.push({
          gameId, left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        });
      }
      predicted = trajectory.predict(targets);
    }, { passive: true });
  }

  /**
   * Viewport dwell is the substitute for hover, not a supplement to it.
   *
   * On a device that has a pointer, hover is a far better signal and this would
   * only add noise — worse than noise, in fact: a tile sitting in the middle of
   * an untouched desktop lobby would accumulate dwell forever and eventually buy
   * itself an engine that nobody asked for. So it is enabled only where hover
   * genuinely does not exist.
   */
  function attachViewportDwell() {
    const coarse = globalThis.matchMedia?.("(hover: none) and (pointer: coarse)");
    if (coarse != null && coarse.matches !== true) return null;

    const viewportDwell = createViewportDwell({
      dwell: viewportIntent,
      readVisibleTiles: () => [...tileNodes].flatMap(([gameId, nodes]) => {
        const box = nodes[0]?.button?.getBoundingClientRect?.();
        if (!box || box.height === 0) return [];
        const visible = Math.max(
          0,
          Math.min(box.bottom, globalThis.innerHeight) - Math.max(box.top, 0),
        );
        return [{
          gameId, top: box.top, bottom: box.bottom, ratio: visible / box.height,
        }];
      }),
    });
    globalThis.addEventListener("scroll", () => viewportDwell.onScroll(),
      { passive: true, capture: true });
    return viewportDwell;
  }

  /**
   * Resolve the game origin's DNS, TCP and TLS before anything is hovered.
   *
   * Free, and it is the one lever that helps the player who taps the very first
   * tile they see without pausing on it.
   */
  function preconnectAtPaint() {
    if (!gameOrigin) return;
    prewarmConnection(`${gameOrigin}/`).catch(() => {});
  }

  renderRails();
  preconnectAtPaint();
  attachTrajectory();
  attachViewportDwell();
  loadManifests();

  $("exit").addEventListener("click", exitToLobby);
  $("reset").addEventListener("click", () => {
    preinit.reset();
    $("frame-host").replaceChildren();
    $("exit").hidden = true;
    dwell.reset();
    viewportIntent.reset();
    trajectory.reset();
    warmed.clear();
    warmInFlight.clear();
    warmMemory.clear();
    committed = null;
    predicted = null;
    ledger.reset();
    $("status").textContent = "Reset. Anything already in the browser cache stays cached.";
    tick();
  });
  $("overlay").addEventListener("change", (event) => {
    documentImpl.body.dataset.overlay = event.target.checked ? "on" : "off";
  });

  documentImpl.addEventListener("visibilitychange", () => {
    if (documentImpl.visibilityState !== "visible") abortAllWarming("the page was hidden");
    tick();
  });

  // Manifests arrive asynchronously; the load-time warm waits for them rather
  // than racing them, but only once.
  let lobbyWarmDone = false;
  const lobbyWarmTimer = globalThis.setInterval(() => {
    if (lobbyWarmDone) return;
    if (manifests.size < Math.min(4, gameCount)) return;
    lobbyWarmDone = true;
    globalThis.clearInterval(lobbyWarmTimer);
    warmOnLobbyLoad();
  }, 150);

  globalThis.setInterval(tick, TICK_MS);
  tick();

  // Exposed for the measurement harness. The page itself never reads it.
  globalThis.__SPECULATION__ = () => ({
    plan: lastPlan,
    warmed: [...warmed],
    connected: [...connected],
    predicted,
    bytesUsed: ledger.bytesUsed(),
    preinit: preinit.getState(),
    device,
  });

  return Object.freeze({ tick, launch, catalogue });
}
