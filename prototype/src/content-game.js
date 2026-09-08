/** Integration handoff (same-origin iframe, one launch attempt per mount):
 * Parent listens BEFORE mounting, waits for CONTENT_READY (handshake only), then
 * sends CONTENT_LAUNCH {launchId, title:{id,title}, assets, locale, tier} only after
 * its fail-closed sandbox authorization gate. Asset shape is the existing resolved
 * manifest: {stage, url, estimatedBytes, version:"1"}; see validateLaunchPlan.
 * Parent must expose the board for input, NOT wait for INPUT_ACCEPTED behind an
 * input-blocking overlay. Validate event.origin/source and current launchId.
 * CONTENT_ASSETS_COMPLETE: bodyBytes, bodyCompleteEpochMs, durationMs (iframe body
 * batch, NOT click duration), assets[], resourceTimings[] (null if unavailable).
 * CONTENT_INPUT_ACCEPTED: once per launch, on first valid trusted card click only.
 * CONTENT_GAME_COMPLETE: once per completed round; reset increments round without
 * refetching or repeating INPUT_ACCEPTED. Epoch fields use timeOrigin + now().
 * CONTENT_ERROR codes: INVALID_LAUNCH (launchId null), CAPABILITY_UNAVAILABLE,
 * ASSET_LOAD_FAILED. CONTENT_ABORTED follows matching parent CONTENT_ABORT.
 * pagehide silently aborts; retry needs a fresh iframe. No auth, lobby scheduling,
 * provider integration or cache-evidence claims are implemented in these files.
 */
import { TOTAL_BODY_BYTES, validateLaunchPlan, hashBytes, seedFromAssetHashes,
  createTheme, createGame, selectCard, dismissMismatch, resetGame } from "./content-game-model.js";

const SYMBOL_NAMES = Object.freeze(["Beacon", "Prism", "Ripple", "Orbit", "Crescent", "Sprout", "Spark", "Portal"]);
const RT_WAIT_MS = 200;
const LOAD_TIMEOUT_MS = 15000;
const abortError = () => new DOMException("Scene stopped", "AbortError");

/** Scene-local body consumer, NOT a second speculative warmer.
 * Shared requester factories currently expose onBytes, not chunks. This approved
 * direct-fetch path uses identical cache/credential/redirect semantics so bytes
 * can actually seed gameplay. No asset buffers retained: only incremental hashes.
 * Successful decoded body total is exactly 114688; browser transport/stream
 * buffering is outside this application-owned retention bound.
 * Exported for Node-only dependency-injected tests; no browser run is needed.
 */
export async function consumeLaunchAssets(plan, { fetchImpl = globalThis.fetch, signal,
  now = () => performance.now(), timeOrigin = performance.timeOrigin,
  timeoutMs = LOAD_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== "function" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Missing bounded fetch capability");
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, timeoutMs);
  const results = new Array(3);
  const launchStartMs = now();
  let cursor = 0;
  let totalBytes = 0;
  let failure;
  async function consume(asset) {
    let reader;
    let response;
    const requestStartMs = now();
    let bytes = 0;
    let hash = 2166136261;
    try {
      if (controller.signal.aborted) throw abortError();
      response = await fetchImpl(asset.url, {
        method: "GET", credentials: "omit", referrerPolicy: "no-referrer",
        mode: "cors", cache: "default", redirect: "error", signal: controller.signal,
      });
      if (controller.signal.aborted) throw abortError();
      if (!response || response.status !== 200 || !response.ok || response.type === "opaque"
          || response.redirected || response.url !== asset.url || !response.body?.getReader) {
        throw new Error("Invalid asset response");
      }
      reader = response.body.getReader();
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > asset.estimatedBytes)) {
        throw new Error("Invalid body length");
      }
      while (true) {
        if (controller.signal.aborted) throw abortError();
        const { value, done } = await reader.read();
        if (controller.signal.aborted) throw abortError();
        if (done) break;
        if (!(value instanceof Uint8Array) || bytes + value.byteLength > asset.estimatedBytes
            || totalBytes + value.byteLength > TOTAL_BODY_BYTES) throw new Error("Body limit exceeded");
        bytes += value.byteLength;
        totalBytes += value.byteLength;
        hash = hashBytes(value, hash);
      }
      // EOF, not headers or Content-Length, defines body completion.
      if (bytes !== asset.estimatedBytes) throw new Error("Incomplete body");
      const bodyCompleteMs = now();
      return { stage: asset.stage, url: asset.url, hash, bodyBytes: bytes,
        requestStartMs, requestStartEpochMs: timeOrigin + requestStartMs,
        bodyCompleteMs, bodyCompleteEpochMs: timeOrigin + bodyCompleteMs,
        durationMs: bodyCompleteMs - requestStartMs };
    } catch (error) {
      failure ??= error;
      controller.abort();
      throw error;
    } finally {
      // Also cancel an arrived response if a sibling failed before getReader().
      try {
        if (reader) await reader.cancel();
        else await response?.body?.cancel();
      } catch { /* Already closed or aborted. */ }
      reader?.releaseLock();
    }
  }
  async function worker() {
    while (cursor < plan.assets.length && !controller.signal.aborted) {
      const index = cursor++;
      results[index] = await consume(plan.assets[index]);
    }
  }
  try {
    // Slots cover full-body consumption and cancellation, never just headers.
    await Promise.allSettled([worker(), worker()]);
    if (failure) throw failure;
    if (controller.signal.aborted) throw abortError();
    if (totalBytes !== TOTAL_BODY_BYTES || results.filter(Boolean).length !== 3) throw new Error("Incomplete launch");
    const bodyCompleteMs = Math.max(...results.map(result => result.bodyCompleteMs));
    return { results, seed: seedFromAssetHashes(results.map(result => result.hash)),
      bodyBytes: totalBytes, launchStartMs, launchStartEpochMs: timeOrigin + launchStartMs,
      bodyCompleteMs, bodyCompleteEpochMs: timeOrigin + bodyCompleteMs,
      durationMs: bodyCompleteMs - launchStartMs };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Only exact approved asset names and non-sensitive numeric RT fields leave here.
 * Missing RT is UNKNOWN, never a zero-byte cache-hit claim. No HAR/headers forwarded.
 */
async function collectResourceTimings(results, signal) {
  const started = performance.now();
  let entries = [];
  do {
    if (signal.aborted) throw abortError();
    entries = results.map(result => {
      try {
        const entry = performance.getEntriesByName(result.url, "resource")
          .filter(item => item.initiatorType === "fetch" && item.startTime >= result.requestStartMs).at(-1);
        if (!entry) return null;
        const fields = ["startTime", "duration", "fetchStart", "domainLookupStart", "domainLookupEnd",
          "connectStart", "connectEnd", "secureConnectionStart", "requestStart", "responseStart",
          "responseEnd", "transferSize", "encodedBodySize", "decodedBodySize"];
        return { label: "MEASURED", name: result.url, entryType: "resource", initiatorType: "fetch",
          timeOrigin: performance.timeOrigin, ...Object.fromEntries(fields.map(field =>
            [field, Number.isFinite(entry[field]) ? entry[field] : null])) };
      } catch { return null; }
    });
    if (entries.every(Boolean) || performance.now() - started >= RT_WAIT_MS) break;
    await pause(Math.min(20, Math.max(1, RT_WAIT_MS - (performance.now() - started))), signal);
  } while (true);
  return { entries, waitMs: performance.now() - started,
    label: entries.every(Boolean) ? "MEASURED" : "UNKNOWN" };
}

function bootScene() {
  const origin = location.origin;
  const parentWindow = window.parent;
  const ui = Object.fromEntries(["board", "waiting", "status", "controls", "continue", "reset", "pairs", "turns", "catalogue-title"]
    .map(id => [id, document.getElementById(id)]));
  let plan = null;
  let launchAttempted = false;
  let stopped = false;
  let game = null;
  let bodyCompleteEpochMs = null;
  let inputReported = false;
  let round = 1;
  let roundCompleteReported = false;
  let controller = null;
  let cardButtons = [];

  function scope() {
    return { kind: "synthetic-original-reference-scene", game: "Vault Match", provider: "none",
      fixtureLabel: "SIMULATED", titleId: plan?.title.id ?? null, build: "synthetic-v1",
      locale: plan?.locale ?? null, tier: plan?.tier ?? null, origin,
      // No provider-ready, cache-hit or production-effect inference.
      milestoneBoundary: "original-reference-scene-only" };
  }
  function post(type, payload = {}) {
    if (parentWindow === window || origin === "null") return;
    parentWindow.postMessage({ type, protocolVersion: 1, label: "MEASURED",
      launchId: plan?.launchId ?? null, scope: scope(), timeOrigin: performance.timeOrigin,
      epochMs: performance.timeOrigin + performance.now(), ...payload }, origin);
  }
  function status(message) { ui.status.textContent = message; }
  function stop(code, notify = true) {
    if (stopped) return;
    stopped = true;
    controller?.abort();
    for (const card of cardButtons) { card.disabled = true; card.setAttribute("aria-disabled", "true"); }
    ui.reset.disabled = true;
    ui.continue.disabled = true;
    status(code === "ABORTED" ? "MEASURED · Scene stopped. Return to the lobby to launch again."
      : "MEASURED · Scene could not start. Return to the lobby and retry; no readiness claim was made.");
    if (notify) post(code === "ABORTED" ? "CONTENT_ABORTED" : "CONTENT_ERROR", { code });
  }

  function svgNode(tag, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }
  function symbol(id) {
    const svg = svgNode("svg", { viewBox: "0 0 64 64", "aria-hidden": "true", focusable: "false",
      fill: "none", stroke: "currentColor", "stroke-width": 2.6,
      "stroke-linecap": "round", "stroke-linejoin": "round" });
    // Original geometric recipes, never images/atlases from a provider. The body
    // seed changes rotation, theme, center detail and the shuffled pair layout.
    const recipes = [
      ["path", { d: "M32 9 53 49H11ZM24 39h16M32 24v7" }],
      ["path", { d: "m32 8 23 24-23 24L9 32Zm0 0v48M9 32h46" }],
      ["path", { d: "M9 20q11-12 23 0t23 0M9 32q11-12 23 0t23 0M9 44q11-12 23 0t23 0" }],
      ["ellipse", { cx: 32, cy: 32, rx: 24, ry: 12, transform: "rotate(-35 32 32)" }],
      ["path", { d: "M43 10C5 5 2 56 39 54 20 44 22 21 43 10Z" }],
      ["path", { d: "M32 55V30C13 31 11 18 12 11c17 0 23 7 20 19 0-16 9-20 20-20 1 16-5 24-20 24" }],
      ["path", { d: "m32 6 7 18 19 8-19 7-7 19-7-19-19-7 19-8Z" }],
      ["path", { d: "M13 53V29a19 19 0 0 1 38 0v24H13Zm10 0V30a9 9 0 0 1 18 0v23" }],
    ];
    const [tag, attrs] = recipes[id];
    svg.append(svgNode(tag, attrs));
    if (id === 3) svg.append(svgNode("circle", { cx: 32, cy: 32, r: 6 + (game.seed % 3) }));
    svg.append(svgNode("circle", { cx: 53, cy: 10, r: 1.5 + ((game.seed >>> (id * 3)) & 3) / 3, fill: "currentColor", stroke: "none" }));
    return svg;
  }
  function paint() {
    ui.pairs.textContent = `${game.pairs} / 8`;
    ui.turns.textContent = String(game.turns);
    ui.continue.hidden = game.faceUp.length !== 2;
    cardButtons.forEach((button, index) => {
      const matched = game.matched.includes(index);
      const open = matched || game.faceUp.includes(index);
      const unavailable = stopped || matched || game.faceUp.includes(index) || game.faceUp.length === 2 || game.complete;
      button.classList.toggle("is-open", open && !matched);
      button.classList.toggle("is-matched", matched);
      button.setAttribute("aria-disabled", String(unavailable));
      button.setAttribute("aria-label", `Card ${index + 1}, ${open ? SYMBOL_NAMES[game.deck[index]] : "face down"}${matched ? ", matched" : ""}`);
      if (open) button.replaceChildren(symbol(game.deck[index]));
      else {
        const back = document.createElement("span");
        back.className = "card-back";
        back.setAttribute("aria-hidden", "true");
        back.textContent = "✧";
        button.replaceChildren(back);
      }
    });
  }
  function onCard(event, index) {
    // .click(), dispatchEvent(), parent messages and render callbacks cannot
    // create the first accepted-input milestone. Native keyboard clicks work.
    if (!event.isTrusted || stopped || !game) return;
    const next = selectCard(game, index);
    if (next === game) return;
    game = next;
    const acceptedEpochMs = performance.timeOrigin + performance.now();
    paint();
    if (!inputReported) {
      inputReported = true;
      post("CONTENT_INPUT_ACCEPTED", { inputAcceptedEpochMs: acceptedEpochMs, bodyCompleteEpochMs,
        action: "reveal-card", inputKind: event.detail === 0 ? "keyboard-or-assistive" : "pointer",
        isTrusted: true, cardIndex: index });
    }
    if (game.complete) {
      status("MEASURED · All eight pairs found. Board complete — reset whenever you like.");
      if (!roundCompleteReported) {
        roundCompleteReported = true;
        post("CONTENT_GAME_COMPLETE", { gameCompleteEpochMs: acceptedEpochMs, round,
          pairs: game.pairs, turns: game.turns, bodyCompleteEpochMs });
      }
    } else if (game.faceUp.length === 2) {
      status(`MEASURED · ${SYMBOL_NAMES[game.deck[game.faceUp[0]]]} and ${SYMBOL_NAMES[game.deck[game.faceUp[1]]]}. Different symbols. Turn these cards back when you are ready.`);
      // Keep normal focus on the selected card; Continue is next after the board.
    } else if (game.faceUp.length === 0) {
      status("MEASURED · A matching pair. Choose another card.");
    } else status(`MEASURED · ${SYMBOL_NAMES[game.deck[index]]} revealed. Choose its twin.`);
  }
  function mountBoard(seed) {
    game = createGame(seed);
    const theme = createTheme(seed);
    document.documentElement.style.setProperty("--hue", String(theme.hue));
    document.documentElement.style.setProperty("--accent-hue", String(theme.accentHue));
    document.documentElement.style.setProperty("--symbol-rotation", `${theme.rotation}deg`);
    cardButtons = game.deck.map((_, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card";
      button.dataset.index = String(index);
      button.addEventListener("click", event => onCard(event, index));
      button.addEventListener("keydown", event => {
        if (stopped || event.altKey || event.ctrlKey || event.metaKey) return;
        const row = Math.floor(index / 4), column = index % 4;
        const targets = { ArrowRight: row * 4 + (column + 1) % 4,
          ArrowLeft: row * 4 + (column + 3) % 4, ArrowDown: (index + 4) % 16,
          ArrowUp: (index + 12) % 16, Home: row * 4, End: row * 4 + 3 };
        if (Object.hasOwn(targets, event.key)) {
          event.preventDefault(); cardButtons[targets[event.key]].focus();
        }
      });
      return button;
    });
    ui.board.replaceChildren(...cardButtons);
    ui.waiting.hidden = true;
    ui.board.hidden = false;
    ui.controls.hidden = false;
    paint();
    // Never autofocus on launch; policy/load completion must not steal focus.
    status("MEASURED · Asset bodies consumed. Choose a card to establish accepted input.");
  }
  ui.continue.addEventListener("click", event => {
    if (!event.isTrusted || stopped || !game) return;
    const next = dismissMismatch(game);
    if (next === game) return;
    const focusIndex = game.faceUp[0];
    game = next; paint();
    status("MEASURED · Cards turned back. Choose another pair.");
    cardButtons[focusIndex].focus();
  });
  ui.reset.addEventListener("click", event => {
    if (!event.isTrusted || stopped || !game) return;
    game = resetGame(game); round += 1; roundCompleteReported = false;
    paint();
    status("MEASURED · Same seeded board reset. No additional asset requests.");
    cardButtons[0].focus();
  });

  async function launch() {
    try {
      status("MEASURED · Reading exact synthetic asset bodies. Input acceptance remains UNKNOWN.");
      const loaded = await consumeLaunchAssets(plan, { signal: controller.signal });
      if (stopped) return;
      bodyCompleteEpochMs = loaded.bodyCompleteEpochMs;
      const rt = await collectResourceTimings(loaded.results, controller.signal);
      if (stopped) return;
      post("CONTENT_ASSETS_COMPLETE", { bodyBytes: loaded.bodyBytes, bodyCompleteEpochMs,
        bodyCompleteMs: loaded.bodyCompleteMs, launchStartEpochMs: loaded.launchStartEpochMs,
        durationMs: loaded.durationMs, resourceTimingLabel: rt.label, resourceTimingWaitMs: rt.waitMs,
        resourceTimings: rt.entries, assets: loaded.results.map(({ hash: _hash, ...result }) => result) });
      mountBoard(loaded.seed);
    } catch {
      if (!stopped) stop("ASSET_LOAD_FAILED"); // Never forward URLs, errors or response payloads.
    }
  }
  window.addEventListener("message", event => {
    if (parentWindow === window || event.source !== parentWindow || event.origin !== origin || stopped) return;
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "CONTENT_ABORT") {
      if (plan && message.launchId === plan.launchId) stop("ABORTED");
      return;
    }
    if (message.type !== "CONTENT_LAUNCH" || launchAttempted) return;
    launchAttempted = true; // One attempt per iframe, including invalid attempts.
    try { plan = validateLaunchPlan(message, origin); }
    catch { stop("INVALID_LAUNCH"); return; }
    ui["catalogue-title"].textContent = plan.title.title;
    if (typeof globalThis.AbortController !== "function"
        || typeof globalThis.fetch !== "function" || typeof globalThis.ReadableStream !== "function") {
      stop("CAPABILITY_UNAVAILABLE"); return;
    }
    controller = new AbortController();
    void launch();
  });
  window.addEventListener("pagehide", () => stop("ABORTED", false), { once: true });
  // Handshake only: no game/asset/input assertion and no requests until launch.
  post("CONTENT_READY", { handshake: true, capabilities: { protocolVersion: 1,
    fullBody: typeof globalThis.fetch === "function" && typeof globalThis.ReadableStream === "function"
      && typeof globalThis.AbortController === "function" } });
}

// Import-safe for Node tests; normal module execution boots only in the iframe.
if (typeof window !== "undefined" && typeof document !== "undefined") bootScene();
