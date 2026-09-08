import { createEmpireSource, supportsAuditedDesktop } from './empire-catalogue.js';
import { validateEarlyBatch, empireVariantMetadata, validateEmpireLaunchGrant } from './empire-milestone.js';
import { createPopularityPrior, createSyntheticSession } from './candidate-policy.js';
import { createSyntheticAuthorization, createBrowserEnvironment } from './content-adapters.js';
import { createCredentialFreeBrowserRequester, createSandboxCatalogueRequester } from './bounded-browser-requester.js';
import { createContentLoader } from './content-loader.js';
import { bindCatalogueIntent, bindThumbnailFallback } from './catalogue-bindings.js';
import { topPreparationCandidates } from './content-demo-policy.js';
import { createPreparationScheduler } from './content-demo-scheduler.js';

const $ = id => document.getElementById(id);
function resolveEmpireConfigUrl(value, lobbyUrl = location.href) {
  const url = new URL(value || '/__vault/config.json', lobbyUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/__vault/config.json')
    throw new Error('Invalid Empire configuration URL');
  const loopback = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) throw new Error('Invalid Empire configuration URL');
  return url.href;
}
async function boot() {
const controller = new AbortController();
let stopped = false;
const disposers = [];
const listen = (target, type, handler, options) => {
  target.addEventListener(type, handler, options);
  disposers.push(() => target.removeEventListener(type, handler, options));
};
function dispose() {
  if (stopped) return;
  stopped = true; controller.abort();
  for (const cleanup of disposers.splice(0).reverse()) cleanup();
}
// Retain only this lifecycle listener after disposal so BF-cache restores reboot
// with UNKNOWN authorization and consent off, including hides during config fetch.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
listen(window, 'pagehide', dispose, { once: true });
try {
let configTimer, cancelConfig;
let config;
try {
  const cancelled = new Promise((_, reject) => {
    cancelConfig = () => reject(new Error('configuration cancelled'));
    controller.signal.addEventListener('abort', cancelConfig, { once: true });
  });
  const deadline = new Promise((_, reject) => {
    configTimer = setTimeout(() => {
      reject(new Error('configuration timeout')); controller.abort();
    }, 10000);
  });
  config = await Promise.race([deadline, cancelled, (async () => {
    const configured = document.querySelector?.('meta[name="empire-config-url"]')?.content;
    const configurationUrl = resolveEmpireConfigUrl(configured, location.href);
    const response = await fetch(configurationUrl, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal });
    if (controller.signal.aborted || !response.ok || response.redirected) throw new Error('configuration');
    const value = await response.json();
    if (controller.signal.aborted) throw new Error('configuration');
    return value;
  })()]);
} finally {
  clearTimeout(configTimer); controller.signal.removeEventListener('abort', cancelConfig);
}
if (stopped) return;
const source = createEmpireSource(config, { lobbyOrigin: location.origin });
const { catalogue } = source;
const desktopSupported = supportsAuditedDesktop();
// Async configuration may finish after pageshow; explicitly reset restored form state.
$('authorization').value = 'UNKNOWN'; $('prefetch-enabled').checked = false;
const prior = createPopularityPrior({ catalogue });
const session = createSyntheticSession({ catalogue });
const authorization = createSyntheticAuthorization('UNKNOWN');
const environment = createBrowserEnvironment();
disposers.push(() => environment.dispose());
const names = ['Amber Arcade', 'Moonlit Garden', 'Sapphire Steps', 'Cedar Vault', 'Solar Bloom',
  'Velvet Comet', 'Coral Atlas', 'Jade Journey', 'Silver Orchard', 'Copper Cove',
  'Violet Passage', 'Golden Fern', 'Blue Meridian', 'Ruby Lantern', 'Ivory Horizon',
  'Moss & Marble', 'Indigo Echo', 'Desert Prism', 'Polar Petal', 'Starlight Studio'];
const symbols = ['✦', '☾', '◆', '❖', '☀', '✧', '✿', '♧', '◈', '◇'];
const titleNames = new Map(catalogue.map((entry, index) => [entry.id, names[index]]));
const thumbnailUrls = new Map(catalogue.map(entry => [entry.id, entry.thumbnailUrl]));
const requesterOptions = { allowedOrigins: source.origins, allowedAssetUrls: source.allowedAssetUrls, priority: 'low' };
const requestAsset = source.deployment === 'CDN_ONE_TITLE'
  ? createCredentialFreeBrowserRequester(requesterOptions)
  : createSandboxCatalogueRequester({ origins: source.origins, allowedAssetUrls: source.allowedAssetUrls, priority: 'low' });
const loader = createContentLoader({ catalogue, prior, session, authorization, environment,
  manifestSource: source.manifestSource, requestAsset,
  byteBudget: config.byteBudget, policy: 'POPULAR_UNPLAYED' });
disposers.push(() => loader.dispose());
let activeLaunch = null;
let pendingLaunch = null;
let returnFocus = null;
let launchSequence = 0;
let noticeTimer;
let focusTimer;
let focusCard;
const thumbnails = [];
const variant = () => ({ build: config.build, locale: $('locale').value, tier: $('tier').value });
const canPrepare = () => desktopSupported && !stopped && !activeLaunch && !pendingLaunch && !loader.snapshot().foreground
  && $('prefetch-enabled').checked && $('mode').value !== 'OFF'
  && authorization.isGranted() && document.visibilityState === 'visible';
const bytes = count => count < 1024 ? `${count} B` : `${(count / 1024).toFixed(1)} KiB`;
const now = () => performance.timeOrigin + performance.now();
function trace(text) {
  const row = document.createElement('li');
  row.textContent = `SIMULATED control state · ${text}`;
  $('trace').prepend(row);
  while ($('trace').childElementCount > 30) $('trace').lastElementChild.remove();
}
function notice(text) {
  if (stopped) return;
  clearTimeout(noticeTimer); $('notice').textContent = text; $('notice').hidden = false;
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500);
}
function renderAccounting() {
  const state = loader.snapshot();
  $('prepared-bytes').textContent = bytes(state.observedBodyBytes);
  $('prepared-objects').textContent = String(state.completedObjects);
  $('reserved-bytes').textContent = bytes(state.reservedBodyBytes);
  $('budget').value = state.reservedBodyBytes;
  // Machine-readable values are measured accounting, not claims of cache hits.
  $('prepared-objects').dataset.count = String(state.completedObjects);
  $('prepared-bytes').dataset.bytes = String(state.observedBodyBytes);
  const network = environment.read();
  $('network-status').textContent = network.effectiveType === undefined || network.saveData === undefined
    ? 'UNKNOWN — network capability unavailable; speculative requests are blocked. Normal authorized launch still works.'
    : `MEASURED browser capability · ${network.effectiveType}; Save-Data ${network.saveData ? 'on' : 'off'}; ${network.visibilityState}.`;
}
function preparationEvent(event) {
  if (stopped) return;
  if (event.type === 'PLAN') {
    $('candidate-summary').textContent = `SIMULATED · top-three plan: ${event.ids.join(', ') || 'none for this policy and session'}.`;
  } else if (event.type === 'STARTED') {
    $('preparation-status').textContent = `${event.source}: fetching ${event.id} before launch…`;
    $('preparation-status').dataset.status = 'PREPARING';
    trace(`${event.source} → ${event.id}`);
  } else if (event.type === 'FINISHED') {
    $('preparation-status').textContent = `${event.id}: ${event.status}${event.reason ? ` (${event.reason})` : ''}. Cache reuse remains UNKNOWN until launch.`;
    $('preparation-status').dataset.status = event.status;
    trace(`${event.id} → ${event.status}${event.reason ? ` / ${event.reason}` : ''}`);
  } else if (event.type === 'DEFERRED') {
    $('preparation-status').textContent = 'Page is busy; waiting once for a quiet interval.';
  } else if (event.type === 'IDLE') {
    $('preparation-status').textContent = 'Top-three pass finished. Check the trace for completed or blocked requests. Hover another title to prepare it.';
    $('preparation-status').dataset.status = 'TOP3_FINISHED';
  } else if (event.type === 'SKIPPED') {
    $('preparation-status').textContent = `${event.id}: already requested in this visit; browser cache residency is UNKNOWN.`;
  }
  renderAccounting();
}
const scheduler = createPreparationScheduler({ loader, canPrepare, getVariant: variant,
  getMode: () => $('mode').value,
  gameIds: catalogue.map(entry => entry.id),
  getCandidates: () => topPreparationCandidates({ catalogue, prior, session: session.snapshot(), policy: $('policy').value }),
  onEvent: preparationEvent });
disposers.push(() => scheduler.dispose());
disposers.push(() => thumbnails.forEach(binding => binding.dispose()));

// The catalogue is rendered ONCE from a whitelisted fixed sequence. Policy and
// preparation state never receive a card element or alter player ordering/style.
const cards = document.createDocumentFragment();
for (const [index, entry] of source.getPlayerCatalogue().entries()) {
  const card = document.createElement('button'); card.type = 'button';
  card.className = 'game-card'; card.dataset.gameId = entry.id;
  card.setAttribute('aria-label', `Launch ${names[index]}, simulated identity ${index + 1}, unchanged Empire of Gold`);
  const cover = document.createElement('span'); cover.className = 'cover'; cover.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img'); image.alt = ''; image.loading = 'eager'; image.decoding = 'async';
  const fallback = document.createElement('span'); fallback.className = 'cover-fallback'; fallback.textContent = 'Simulated catalogue identity';
  thumbnails.push(bindThumbnailFallback({ image, fallback }));
  image.src = thumbnailUrls.get(entry.id);
  const symbol = document.createElement('span'); symbol.className = 'cover-symbol'; symbol.textContent = symbols[index % symbols.length];
  cover.append(image, symbol, fallback);
  const copy = document.createElement('span'); copy.className = 'card-copy';
  const title = document.createElement('span'); title.className = 'card-title'; title.textContent = names[index];
  const meta = document.createElement('span'); meta.className = 'card-meta'; meta.textContent = `SIMULATED · ${entry.id} · Empire`;
  const play = document.createElement('span'); play.className = 'card-play'; play.textContent = 'Launch Empire of Gold';
  const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true'); play.append(arrow);
  copy.append(title, meta, play); card.append(cover, copy); cards.append(card);
}
$('catalogue').append(cards);
const cardById = new Map([...$('catalogue').querySelectorAll('[data-game-id]')].map(card => [card.dataset.gameId, card]));

function clearFocusDwell() { clearTimeout(focusTimer); focusTimer = null; focusCard = null; }
const intents = bindCatalogueIntent({ root: $('catalogue'), gameIds: catalogue.map(entry => entry.id), dwellMs: 220,
  onIntent(intent) {
    if (intent.kind === 'CLICK') { clearFocusDwell(); return launch(intent.gameId); }
    if (intent.kind === 'HOVER_DWELL') return scheduler.hover(intent.gameId);
  } });
listen($('catalogue'), 'pointerout', event => {
  const oldCard = event.target.closest?.('[data-game-id]');
  const nextCard = event.relatedTarget?.closest?.('[data-game-id]');
  if (oldCard && oldCard !== nextCard) void scheduler.leaveHover();
});
listen($('catalogue'), 'focusin', event => {
  clearFocusDwell(); const card = event.target.closest?.('[data-game-id]');
  if (!card) return;
  focusCard = card;
  focusTimer = setTimeout(() => {
    if (focusCard === card && document.activeElement === card && canPrepare()) void scheduler.hover(card.dataset.gameId, 'FOCUS');
  }, 220);
});
listen($('catalogue'), 'focusout', () => { clearFocusDwell(); void scheduler.leaveHover(); });

disposers.push(() => intents.dispose());

function configure() {
  if (stopped) return;
  scheduler.stop(); intents.cancelPending(); clearFocusDwell();
  loader.setPolicy($('mode').value === 'OFF' ? 'OFF' : $('policy').value);
  loader.setEnabled(desktopSupported && $('prefetch-enabled').checked && $('mode').value !== 'OFF');
  $('preparation-status').dataset.status = 'IDLE';
  $('preparation-status').textContent = !authorization.isGranted() ? 'Sandbox authorization is not granted. No preparation or launch is allowed.'
    : !desktopSupported ? 'UNKNOWN — desktop variant not established. Preparation blocked; authorized normal launch remains available.'
    : !$('prefetch-enabled').checked || $('mode').value === 'OFF' ? 'Preparation is off. Choose a title to launch normally.'
      : $('mode').value === 'HOVER' ? 'Hover or focus a title for a short dwell to prepare its assets.' : 'Scheduling the cache-only top-three pass…';
  $('candidate-summary').textContent = 'SIMULATED · no active candidate plan';
  renderAccounting();
  void scheduler.startBackground();
}
function updateAuthorization() {
  authorization.setState($('authorization').value);
  trace(`authorization → ${$('authorization').value}`);
  // A pending adapter may ignore cancellation; dismiss the UI immediately.
  if (!authorization.isGranted() && (activeLaunch || pendingLaunch)) {
    stopLaunch('Sandbox authorization was withdrawn. Game stopped.');
  } else configure();
}
listen($('authorization'), 'change', updateAuthorization);
for (const id of ['prefetch-enabled', 'mode', 'policy', 'locale', 'tier']) listen($(id), 'change', configure);

function writeResult(launch, fields) {
  launch.measurement = { ...launch.measurement, ...fields };
  $('launch-result').textContent = JSON.stringify(launch.measurement, null, 2);
  // Read-only observer seam: exactly the redacted fields already displayed.
  window.dispatchEvent(new CustomEvent('empire-measurement', { detail: { ...launch.measurement } }));
}
function stopLaunch(message, { restart = true } = {}) {
  launchSequence += 1;
  const previous = activeLaunch; activeLaunch = null;
  pendingLaunch?.cancel(); pendingLaunch = null;
  previous?.grant.signal.removeEventListener('abort', previous.onAbort);
  clearTimeout(previous?.timeout); clearTimeout(previous?.handshakeTimeout);
  try { previous?.frame?.contentWindow?.postMessage({ type: 'EMPIRE_ABORT', launchId: previous.id }, previous.origin); } catch { /* Removal still stops the wrapper. */ }
  $('frame-host').replaceChildren();
  if ($('player-dialog').open) $('player-dialog').close();
  loader.cancelLaunch(); loader.resumeBrowsing();
  const target = returnFocus; returnFocus = null;
  if (!stopped && target?.isConnected) target.focus({ preventScroll: true });
  // Programmatic recovery focus is not a new preparation intent.
  clearFocusDwell();
  if (message) { notice(message); trace(message); }
  if (restart && !stopped) configure();
}
async function launch(gameId) {
  if (!titleNames.has(gameId) || stopped) return;
  if (activeLaunch || pendingLaunch) stopLaunch('', { restart: false });
  returnFocus = cardById.get(gameId);
  scheduler.stop(); intents.cancelPending(); clearFocusDwell();
  const sequence = ++launchSequence;
  const clickedAt = now();
  try {
  window.dispatchEvent(new CustomEvent('empire-launch-click', { detail: { titleId: gameId, clickedAtEpochMs: clickedAt } }));
  const selected = variant();
  const before = loader.snapshot();
  $('launch-result').textContent = 'UNKNOWN — new launch authorization and asset bodies pending.';
  $('player-title').textContent = `${titleNames.get(gameId)} · Empire of Gold`;
  $('player-status').textContent = 'Checking sandbox authorization before mounting the game…';
  if (!$('player-dialog').open) $('player-dialog').showModal();
  let grant, grantTimer;
  const pending = {};
  pendingLaunch = pending;
  try {
    const cancelled = new Promise(resolve => { pending.cancel = () => { clearTimeout(grantTimer); resolve(null); }; });
    const deadline = new Promise(resolve => { grantTimer = setTimeout(() => resolve(null), 16000); });
    grant = await Promise.race([cancelled, deadline, Promise.resolve().then(() => {
      if (pendingLaunch !== pending || stopped) return null;
      return loader.beginLaunch({ gameId, ...selected });
    })]);
  } catch { grant = null; }
  finally { clearTimeout(grantTimer); }
  if (sequence !== launchSequence || stopped) return;
  pendingLaunch = null;
  const expectedAssets = catalogue.find(entry => entry.id === gameId)?.locales[selected.locale]?.tiers[selected.tier]?.assets;
  if (!authorization.isGranted() || !validateEmpireLaunchGrant(grant, { id: gameId, ...selected }, expectedAssets)) {
    const message = grant?.status === 'IDENTITY_UNRESOLVED'
      ? 'Launch blocked: the exact local release or variant could not be validated.'
      : grant?.status === 'LAUNCH_BLOCKED'
        ? 'Launch blocked: outstanding preparation could not be safely settled. Return to the lobby or reload to recover.'
        : 'Launch blocked. A valid current synthetic authorization and exact launch grant are required. Please retry from the lobby.';
    stopLaunch(message); return;
  }
  const selectedEntry = catalogue.find(entry => entry.id === gameId);
  const current = { id: `launch-${sequence}`, sequence, gameId, selected, grant, clickedAt,
    origin: selectedEntry.origin, wrapperUrl: selectedEntry.wrapperUrl, inputAccepted: false, assetsComplete: false,
    measurement: { classification: source.deployment === 'CDN_ONE_TITLE'
      ? 'MEASURED — this configured CDN provider-bundle visit' : 'MEASURED — this local provider-bundle visit', titleId: gameId,
      ...empireVariantMetadata(selected, desktopSupported), preparationMode: before.enabled ? $('mode').value : 'OFF',
      preparationBodyBytesBeforeClick: before.observedBodyBytes,
      providerPlayable: 'UNKNOWN — no authoritative provider input-accepted signal',
      inputAccepted: false } };
  activeLaunch = current;
  const frame = document.createElement('iframe'); current.frame = frame;
  frame.title = `${titleNames.get(gameId)} — unchanged Empire of Gold in the configured sandbox`;
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.src = current.wrapperUrl;
  current.onAbort = () => {
    if (activeLaunch === current) stopLaunch('Sandbox authorization or launch grant was withdrawn. Game stopped.');
  };
  grant.signal.addEventListener('abort', current.onAbort, { once: true });
  // Includes wrapper navigation, bounded configuration and the mount acknowledgement.
  current.handshakeTimeout = setTimeout(() => {
    if (activeLaunch !== current || current.providerMounted) return;
    startupFailure(current, 'WRAPPER_HANDSHAKE_TIMEOUT');
  }, 12000);
  $('player-status').textContent = 'SIMULATED authorization granted. Loading the unchanged provider; gameplay readiness remains UNKNOWN.';
  writeResult(current, {});
  $('frame-host').append(frame);
  trace(`${gameId} → LAUNCH_AUTHORIZED`);
  renderAccounting();
  } catch {
    if (sequence === launchSequence && !stopped) stopLaunch('Launch failed closed. Return to the lobby and retry; provider readiness remains UNKNOWN.');
  }
}
function startupFailure(current, reason) {
  current.startupFailed = true;
  clearTimeout(current.handshakeTimeout); clearTimeout(current.timeout);
  current.grant.signal.removeEventListener('abort', current.onAbort);
  try { current.frame.contentWindow?.postMessage({ type: 'EMPIRE_ABORT', launchId: current.id }, current.origin); } catch { /* Remove regardless. */ }
  $('frame-host').replaceChildren();
  loader.cancelLaunch(); // No preparation resumes until the player returns to the lobby.
  writeResult(current, { milestone: 'UNKNOWN — provider startup was not confirmed', startupFailure: reason });
  $('player-status').textContent = 'UNKNOWN — provider startup was not confirmed. The wrapper was removed; no visibility or gameplay claim is available. Return to the lobby to retry.';
  $('close-player').focus({ preventScroll: true });
}
listen(window, 'message', event => {
  const current = activeLaunch;
  if (!current || current.startupFailed || event.origin !== current.origin || event.source !== current.frame.contentWindow
      || current.grant.signal.aborted || !authorization.isGranted()) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.titleId !== current.gameId) return;
  if (data.type === 'EMPIRE_READY') {
    if (current.sent) return;
    current.sent = true;
    try {
      current.frame.contentWindow.postMessage({ type: 'EMPIRE_LAUNCH', launchId: current.id,
        titleId: current.gameId, build: config.build, observeEarlyBatch: desktopSupported }, current.origin);
    } catch { startupFailure(current, 'WRAPPER_HANDSHAKE_FAILED'); }
    return;
  }
  if (data.launchId !== current.id || !current.sent) return;
  if (data.type === 'EMPIRE_STARTUP_FAILURE'
      && ['PROVIDER_MOUNT_FAILED', 'WRAPPER_STARTUP_FAILED'].includes(data.reason)) {
    startupFailure(current, data.reason); return;
  }
  if (data.type === 'EMPIRE_PROVIDER_MOUNTED') {
    if (current.providerMounted) return;
    current.providerMounted = true; clearTimeout(current.handshakeTimeout);
    $('player-status').textContent = desktopSupported
      ? 'MEASURED wrapper action — provider frame mounted. Rendering and gameplay readiness remain UNKNOWN.'
      : 'UNKNOWN — actual provider tier and gameplay readiness. Normal launch only; desktop early-batch milestone is not applicable.';
    if (desktopSupported) current.timeout = setTimeout(() => {
      if (activeLaunch !== current || current.assetsComplete) return;
      writeResult(current, { milestone: 'UNKNOWN — early response batch incomplete after the 30-second observation window' });
      $('player-status').textContent = 'UNKNOWN — early batch incomplete. The provider frame was mounted, but rendering and gameplay readiness are not established. Return to the lobby or inspect the failure.';
    }, 31000);
    return;
  }
  if (!current.providerMounted) return;
  if (data.type === 'EMPIRE_EARLY_BATCH_COMPLETE' && desktopSupported && !current.assetsComplete) {
    const result = validateEarlyBatch(data, { assets: current.grant.plan.assets, clickedAt: current.clickedAt, now: now(), desktopSupported });
    if (!result) return;
    current.assetsComplete = true; clearTimeout(current.timeout);
    writeResult(current, { ...result,
      cacheObservation: result.resourceTimingTransferBytes === 0
        ? 'MEASURED — Resource Timing reports zero transfer for this exact early batch on launch'
        : 'MEASURED — early resources reported transfer; not a fully cached early batch' });
    $('player-status').textContent = `MEASURED — all ${result.assetCount} early resource responses complete. This is not provider time-to-interactive.`;
    trace(`${current.gameId} → EARLY_RESPONSES_COMPLETE`);
  } else if (data.type === 'EMPIRE_CANVAS_OBSERVED' && !current.canvasObserved) {
    if (!Number.isFinite(data.observedAtEpochMs) || data.observedAtEpochMs < current.clickedAt || data.observedAtEpochMs > now()) return;
    current.canvasObserved = true;
    writeResult(current, { canvasObserved: true, clickToCanvasObservedMs: Math.round(data.observedAtEpochMs - current.clickedAt),
      canvasNote: 'MEASURED wrapper polling observation, not first paint or accepted input' });
  } else if (data.type === 'EMPIRE_DEPENDENCY_FAILURE') {
    if (!Number.isSafeInteger(data.count) || data.count < 1 || data.count > 1000) return;
    writeResult(current, { failedDependencyCount: data.count,
      dependencyNote: 'MEASURED resource failure; this alone does not establish whether base gameplay is possible' });
    $('player-status').textContent = 'MEASURED — a provider dependency failed. Rendering and gameplay readiness remain UNKNOWN; return to the lobby or inspect the failure.';
  }
});
listen($('close-player'), 'click', () => stopLaunch(''));
listen($('revoke-access'), 'click', () => {
  $('authorization').value = 'DENIED'; updateAuthorization();
});
listen($('player-dialog'), 'cancel', event => { event.preventDefault(); stopLaunch(''); });
listen($('player-dialog'), 'close', () => {
  // Also cover native/programmatic close. A queued old close event must not
  // cancel a newly reopened dialog; stopLaunch has already cleared old state.
  if (!$('player-dialog').open && (activeLaunch || pendingLaunch)) stopLaunch('');
});
listen(document, 'visibilitychange', () => {
  clearFocusDwell(); intents.cancelPending(); scheduler.stop();
  if (document.visibilityState === 'visible' && !activeLaunch && !pendingLaunch) configure();
  else if (!activeLaunch) $('preparation-status').textContent = 'Page hidden: speculative requests cancelled.';
  renderAccounting();
});
disposers.push(environment.subscribe(renderAccounting));
listen(window, 'pageshow', event => {
  if (event.persisted || stopped) return;
  // Browsers may restore form fields even when this document was not BF-cached.
  $('authorization').value = 'UNKNOWN'; $('prefetch-enabled').checked = false;
  authorization.setState('UNKNOWN'); configure();
});
disposers.push(() => {
  clearTimeout(noticeTimer); clearFocusDwell();
  stopLaunch('', { restart: false });
});
configure();
} catch {
  const hidden = stopped;
  dispose();
  if (hidden) return;
  $('preparation-status').textContent = 'UNKNOWN — deployment configuration failed closed. No preparation or provider launch is allowed. Reload to retry.';
  $('preparation-status').dataset.status = 'CONFIGURATION_ERROR';
  document.querySelectorAll('select,input,button').forEach(control => { control.disabled = true; });
}
}
void boot();
