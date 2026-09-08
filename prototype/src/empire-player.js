// Wrapper observes the original document's Resource Timing only. It does not
// patch provider code, intercept requests, substitute assets or synthesize input.
// Standalone: instance origins serve this module without the lobby module graph.
// Keep this standalone allowlist aligned with empire-catalogue.js; unit tests
// compare it against the catalogue. Instance origins serve no lobby imports.
const WRAPPER_ASSETS = [
  ['assets/locale/en/gameContent.json', 'PRELOADER', 3997],
  ['assets/locale/en/commonContent.json', 'PRELOADER', 14865],
  ['assets/fonts/en/Mulish.ttf', 'PRELOADER', 210380],
  ['assets/images/@1x/brandLogo.png', 'PRELOADER', 10611],
  ['assets/fonts/en/NewRocker-Regular.ttf', 'COMMON', 168128],
  ['assets/fonts/en/Oswald-Bold.ttf', 'COMMON', 87600],
  ['assets/images/@1x/controlPanelPrimaryAssets.json', 'COMMON', 1633],
  ['assets/images/@1x/controlPanelPrimaryAssets.webp', 'COMMON', 26726],
];
export function validateWrapperConfiguration(value, origin) {
  const loopback = candidate => {
    try {
      const url = new URL(candidate);
      return url.origin === candidate && url.protocol === 'http:' && url.hostname === '127.0.0.1'
        && Number(url.port) >= 1024;
    } catch { return false; }
  };
  const entry = value?.entries?.[0];
  if (value?.mode !== 'PROVIDER_EARLY_ASSETS' || !Array.isArray(value.entries) || value.entries.length !== 1
      || !loopback(origin) || entry?.origin !== origin || !loopback(value.lobbyOrigin) || value.lobbyOrigin === origin
      || !/^title-(0[1-9]|1\d|20)$/.test(entry?.id) || !/^[a-f0-9]{64}$/.test(value.archiveSha256)
      || value.build !== `empire-${value.archiveSha256.slice(0, 16)}` || value.locale !== 'en' || value.tier !== '1x'
      || !Array.isArray(entry.assets) || entry.assets.length !== 8
      || !Array.from(entry.assets).every((asset, index) => asset?.url === `${origin}/${WRAPPER_ASSETS[index][0]}`
        && asset.stage === WRAPPER_ASSETS[index][1] && asset.estimatedBytes === WRAPPER_ASSETS[index][2]
        && /^[a-f0-9]{64}$/.test(asset.sha256) && asset.releaseBuild === value.build)) {
    throw new TypeError('Invalid wrapper configuration');
  }
  // Retain only the validated fields; later fixture/config mutations cannot
  // change the trusted message origin or exact observation identities.
  return Object.freeze({ mode: value.mode, lobbyOrigin: value.lobbyOrigin,
    archiveSha256: value.archiveSha256, build: value.build, locale: value.locale, tier: value.tier,
    entries: Object.freeze([Object.freeze({ id: entry.id, origin: entry.origin,
      assets: Object.freeze(entry.assets.map(asset => Object.freeze({ url: asset.url,
        stage: asset.stage, estimatedBytes: asset.estimatedBytes }))) })]) });
}

/** A single deadline covers headers AND JSON, even if a fetch ignores abort. */
export async function loadWrapperConfiguration({ fetchImpl, origin, controller,
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  if (controller.signal.aborted) throw new Error('Wrapper configuration cancelled');
  let deadline, onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(new Error('Wrapper configuration cancelled'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  const timedOut = new Promise((_, reject) => {
    deadline = setTimeoutImpl(() => {
      reject(new Error('Wrapper configuration timed out')); controller.abort();
    }, 10000);
  });
  try {
    return await Promise.race([timedOut, cancelled, (async () => {
      const response = await fetchImpl('/__vault/config.json', {
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
      });
      if (controller.signal.aborted || !response.ok || response.redirected) throw new Error('configuration');
      const value = await response.json();
      if (controller.signal.aborted) throw new Error('configuration');
      return validateWrapperConfiguration(value, origin);
    })()]);
  } finally {
    clearTimeoutImpl(deadline); controller.signal.removeEventListener('abort', onAbort);
  }
}

export async function startEmpirePlayer({ window: win = globalThis.window, document: doc = globalThis.document,
  fetchImpl = globalThis.fetch, clock = globalThis.performance, Controller = globalThis.AbortController,
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  const state = doc.getElementById('state');
  const frame = doc.getElementById('provider');
  const controller = new Controller();
  let current = null, timer, handshakeTimer, observationTimer, config, stopped = false;
  const post = (type, fields = {}) => {
    if (config && !stopped) win.parent.postMessage({ type, launchId: current?.id, titleId: config.entries[0].id, ...fields }, config.lobbyOrigin);
  };
  function stop() {
    if (stopped) return;
    stopped = true; controller.abort();
    win.removeEventListener?.('message', onMessage);
    win.removeEventListener?.('pagehide', stop);
    clearTimeoutImpl(handshakeTimer); clearTimeoutImpl(observationTimer);
    clearIntervalImpl(timer); timer = null; current = null;
    frame.removeAttribute('src');
  }
  function failStartup(reason) {
    try { post('EMPIRE_STARTUP_FAILURE', { reason }); } catch { /* Parent has its own deadline. */ }
    stop();
    state.textContent = 'UNKNOWN — wrapper startup failed closed. Rendering and gameplay readiness were not established. Return to the lobby to retry.';
  }
  win.addEventListener('pagehide', stop, { once: true });
  try {
    // Assign only validated configuration; malformed JSON must never enable READY.
    config = await loadWrapperConfiguration({ fetchImpl, origin: win.location.origin, controller, setTimeoutImpl, clearTimeoutImpl });
  } catch {
    if (!stopped) {
      stop(); state.textContent = 'UNKNOWN — wrapper configuration failed closed. Provider was not mounted. Return to the lobby to retry.';
    }
    return;
  }
  if (stopped) return;
  function observe() {
    if (stopped || !current || current.observationEnded) return;
    const game = frame.contentWindow;
    if (!game || !frame.contentDocument || game.location.href === 'about:blank') return;
    const entries = game.performance.getEntriesByType('resource');
    if (!current.canvas && frame.contentDocument.querySelector('canvas')) {
      current.canvas = true;
      post('EMPIRE_CANVAS_OBSERVED', { observedAtEpochMs: clock.timeOrigin + clock.now() });
    }
    const failed = entries.filter(entry => Number.isFinite(entry.responseStatus) && entry.responseStatus >= 400).length;
    if (failed > current.failed) {
      current.failed = failed;
      post('EMPIRE_DEPENDENCY_FAILURE', { count: failed });
      state.textContent = 'MEASURED — a provider resource failed. This may affect later gameplay; readiness remains UNKNOWN.';
    }
    // The parent scopes this preregistered @1x milestone to audited desktop only.
    // Mobile still launches normally, with actual provider tier/readiness UNKNOWN.
    if (current.observeEarlyBatch && !current.complete) {
      const resources = config.entries[0].assets.map((asset, index) => {
        const match = entries.find(entry => entry.name === asset.url && entry.decodedBodySize === asset.estimatedBytes
          && Number.isFinite(entry.responseEnd) && entry.responseEnd > 0
          && Number.isSafeInteger(entry.encodedBodySize) && entry.encodedBodySize > 0
          && Number.isSafeInteger(entry.transferSize) && entry.transferSize >= 0
          && !(Number.isFinite(entry.responseStatus) && entry.responseStatus >= 400));
        return match && { index, decodedBodySize: match.decodedBodySize, encodedBodySize: match.encodedBodySize,
          transferSize: match.transferSize, responseEndEpochMs: game.performance.timeOrigin + match.responseEnd };
      });
      if (resources.every(Boolean)) {
        current.complete = true;
        post('EMPIRE_EARLY_BATCH_COMPLETE', { resources });
        if (!current.failed) state.textContent = `MEASURED — all ${config.entries[0].assets.length} early resource responses completed. This is not a gameplay-ready signal.`;
      }
    }
  }
  function onMessage(event) {
    if (stopped || !config || event.source !== win.parent || event.origin !== config.lobbyOrigin || !event.data || typeof event.data !== 'object') return;
    const data = event.data;
    if (data.type === 'EMPIRE_ABORT' && current && data.launchId === current.id) { stop(); return; }
    if (data.type !== 'EMPIRE_LAUNCH' || current || typeof data.launchId !== 'string' || !/^launch-\d+$/.test(data.launchId)
        || data.titleId !== config.entries[0].id || data.build !== config.build
        || typeof data.observeEarlyBatch !== 'boolean') return;
    clearTimeoutImpl(handshakeTimer);
    current = { id: data.launchId, started: clock.now(), complete: false, canvas: false, failed: 0,
      observeEarlyBatch: data.observeEarlyBatch };
    state.textContent = data.observeEarlyBatch
      ? 'SIMULATED authorization granted · loading the unchanged local provider game. Readiness: UNKNOWN.'
      : 'SIMULATED authorization granted · normal launch only. Actual provider tier and gameplay readiness: UNKNOWN. Desktop early-batch milestone not applicable.';
    // Exact audited locale; provider still chooses its own actual device tier.
    try { frame.src = '/?language=en'; } catch {
      failStartup('PROVIDER_MOUNT_FAILED'); return;
    }
    try {
    // This acknowledges src assignment, NOT successful navigation, paint or input.
    post('EMPIRE_PROVIDER_MOUNTED');
    timer = setIntervalImpl(() => { try { observe(); } catch { /* Transient navigation, not readiness. */ } }, 100);
    // End polling even when navigation stalls, access throws, or no canvas exists.
    observationTimer = setTimeoutImpl(() => {
      if (stopped || !current || current.observationEnded) return;
      current.observationEnded = true;
      post('EMPIRE_OBSERVATION_END', { earlyBatchComplete: current.complete, canvasObserved: current.canvas, failedDependencyCount: current.failed });
      clearIntervalImpl(timer); timer = null;
      if (!current.failed && !current.complete) state.textContent = current.observeEarlyBatch
        ? 'UNKNOWN — early batch incomplete at the end of observation. Rendering and gameplay readiness are not established.'
        : 'UNKNOWN — observation ended. Actual provider tier and gameplay readiness remain unknown; desktop early-batch milestone is not applicable.';
    }, 30000);
    } catch { failStartup('WRAPPER_STARTUP_FAILED'); }
  }
  try {
    win.addEventListener('message', onMessage);
    handshakeTimer = setTimeoutImpl(() => {
      stop(); state.textContent = 'UNKNOWN — wrapper launch handshake timed out. Provider was not mounted. Return to the lobby to retry.';
    }, 10000);
    post('EMPIRE_READY');
  } catch { failStartup('WRAPPER_STARTUP_FAILED'); }
}

if (typeof document !== 'undefined') void startEmpirePlayer();
