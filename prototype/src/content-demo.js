import { createSyntheticCatalogue, getPlayerCatalogue } from './catalogue.js';
import { createPopularityPrior, createSyntheticSession } from './candidate-policy.js';
import { createSyntheticManifestSource, createSyntheticAuthorization, createBrowserEnvironment } from './content-adapters.js';
import { createSandboxBrowserRequester } from './bounded-browser-requester.js';
import { createContentLoader } from './content-loader.js';
import { bindCatalogueIntent, bindThumbnailFallback } from './catalogue-bindings.js';
import { topPreparationCandidates } from './content-demo-policy.js';
import { createPreparationScheduler } from './content-demo-scheduler.js';

const $ = id => document.getElementById(id);
const catalogue = createSyntheticCatalogue({ origin: location.origin });
const prior = createPopularityPrior({ catalogue });
const session = createSyntheticSession({ catalogue });
const authorization = createSyntheticAuthorization('UNKNOWN');
const environment = createBrowserEnvironment();
const names = ['Amber Arcade', 'Moonlit Garden', 'Sapphire Steps', 'Cedar Vault', 'Solar Bloom',
  'Velvet Comet', 'Coral Atlas', 'Jade Journey', 'Silver Orchard', 'Copper Cove',
  'Violet Passage', 'Golden Fern', 'Blue Meridian', 'Ruby Lantern', 'Ivory Horizon',
  'Moss & Marble', 'Indigo Echo', 'Desert Prism', 'Polar Petal', 'Starlight Studio'];
const symbols = ['✦', '☾', '◆', '❖', '☀', '✧', '✿', '♧', '◈', '◇'];
const titleNames = new Map(catalogue.map((entry, index) => [entry.id, names[index]]));
const thumbnailUrls = new Map(catalogue.map(entry => [entry.id, entry.thumbnailUrl]));
const loader = createContentLoader({ catalogue, prior, session, authorization, environment,
  manifestSource: createSyntheticManifestSource(catalogue),
  requestAsset: createSandboxBrowserRequester({ origin: location.origin }),
  byteBudget: 3 * 1024 * 1024, policy: 'POPULAR_UNPLAYED' });
let activeLaunch = null;
let launchSequence = 0;
let noticeTimer;
let focusTimer;
let stopped = false;
let focusCard;
const thumbnails = [];
const variant = () => ({ build: 'synthetic-v1', locale: $('locale').value, tier: $('tier').value });
const canPrepare = () => !stopped && !activeLaunch && !loader.snapshot().foreground
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

// The catalogue is rendered ONCE from a whitelisted fixed sequence. Policy and
// preparation state never receive a card element or alter player ordering/style.
const cards = document.createDocumentFragment();
for (const [index, entry] of getPlayerCatalogue(catalogue).entries()) {
  const card = document.createElement('button'); card.type = 'button';
  card.className = 'game-card'; card.dataset.gameId = entry.id;
  card.setAttribute('aria-label', `Play ${names[index]}, synthetic Vault Match edition ${index + 1}`);
  const cover = document.createElement('span'); cover.className = 'cover'; cover.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img'); image.alt = ''; image.loading = 'eager'; image.decoding = 'async';
  const fallback = document.createElement('span'); fallback.className = 'cover-fallback'; fallback.textContent = 'Original synthetic edition';
  thumbnails.push(bindThumbnailFallback({ image, fallback }));
  image.src = thumbnailUrls.get(entry.id);
  const symbol = document.createElement('span'); symbol.className = 'cover-symbol'; symbol.textContent = symbols[index % symbols.length];
  cover.append(image, symbol, fallback);
  const copy = document.createElement('span'); copy.className = 'card-copy';
  const title = document.createElement('span'); title.className = 'card-title'; title.textContent = names[index];
  const meta = document.createElement('span'); meta.className = 'card-meta'; meta.textContent = `SIMULATED · ${entry.id} · Memory`;
  const play = document.createElement('span'); play.className = 'card-play'; play.textContent = 'Play Vault Match';
  const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true'); play.append(arrow);
  copy.append(title, meta, play); card.append(cover, copy); cards.append(card);
}
$('catalogue').append(cards);

function clearFocusDwell() { clearTimeout(focusTimer); focusTimer = null; focusCard = null; }
const intents = bindCatalogueIntent({ root: $('catalogue'), gameIds: catalogue.map(entry => entry.id), dwellMs: 220,
  onIntent(intent) {
    if (intent.kind === 'CLICK') { clearFocusDwell(); return launch(intent.gameId); }
    if (intent.kind === 'HOVER_DWELL') return scheduler.hover(intent.gameId);
  } });
$('catalogue').addEventListener('pointerout', event => {
  const oldCard = event.target.closest?.('[data-game-id]');
  const nextCard = event.relatedTarget?.closest?.('[data-game-id]');
  if (oldCard && oldCard !== nextCard) void scheduler.leaveHover();
});
$('catalogue').addEventListener('focusin', event => {
  clearFocusDwell(); const card = event.target.closest?.('[data-game-id]');
  if (!card) return;
  focusCard = card;
  focusTimer = setTimeout(() => {
    if (focusCard === card && document.activeElement === card && canPrepare()) void scheduler.hover(card.dataset.gameId, 'FOCUS');
  }, 220);
});
$('catalogue').addEventListener('focusout', () => { clearFocusDwell(); void scheduler.leaveHover(); });

function configure() {
  scheduler.stop(); intents.cancelPending(); clearFocusDwell();
  loader.setPolicy($('mode').value === 'OFF' ? 'OFF' : $('policy').value);
  loader.setEnabled($('prefetch-enabled').checked && $('mode').value !== 'OFF');
  $('preparation-status').dataset.status = 'IDLE';
  $('preparation-status').textContent = !authorization.isGranted() ? 'Sandbox authorization is not granted. No preparation or launch is allowed.'
    : !$('prefetch-enabled').checked || $('mode').value === 'OFF' ? 'Preparation is off. Choose a title to launch normally.'
      : $('mode').value === 'HOVER' ? 'Hover or focus a title for a short dwell to prepare its assets.' : 'Scheduling the cache-only top-three pass…';
  $('candidate-summary').textContent = 'SIMULATED · no active candidate plan';
  renderAccounting();
  void scheduler.startBackground();
}
$('authorization').addEventListener('change', () => { authorization.setState($('authorization').value); trace(`authorization → ${$('authorization').value}`); configure(); });
for (const id of ['prefetch-enabled', 'mode', 'policy', 'locale', 'tier']) $(id).addEventListener('change', configure);

function writeResult(launch, fields) {
  launch.measurement = { ...launch.measurement, ...fields };
  $('launch-result').textContent = JSON.stringify(launch.measurement, null, 2);
}
function stopLaunch(message, { restart = true } = {}) {
  launchSequence += 1;
  const previous = activeLaunch; activeLaunch = null;
  clearTimeout(previous?.timeout);
  if (previous?.frame?.contentWindow) previous.frame.contentWindow.postMessage({ type: 'CONTENT_ABORT', launchId: previous.id }, location.origin);
  $('frame-host').replaceChildren();
  if ($('player-dialog').open) $('player-dialog').close();
  loader.cancelLaunch(); loader.resumeBrowsing();
  if (message) { notice(message); trace(message); }
  if (restart && !stopped) configure();
}
async function launch(gameId) {
  if (!titleNames.has(gameId) || stopped) return;
  if (activeLaunch) stopLaunch('', { restart: false });
  scheduler.stop(); intents.cancelPending(); clearFocusDwell();
  const sequence = ++launchSequence;
  const clickedAt = now();
  const selected = variant();
  const before = loader.snapshot();
  $('launch-result').textContent = 'UNKNOWN — new launch authorization and asset bodies pending.';
  $('player-title').textContent = `${titleNames.get(gameId)} · Vault Match`;
  $('player-status').textContent = 'Checking sandbox authorization before mounting the game…';
  if (!$('player-dialog').open) $('player-dialog').showModal();
  const grant = await loader.beginLaunch({ gameId, ...selected });
  if (sequence !== launchSequence || stopped) return;
  if (grant.status !== 'LAUNCH_AUTHORIZED' || grant.signal.aborted) {
    stopLaunch('Launch blocked. Grant the synthetic sandbox authorization first.'); return;
  }
  const current = { id: `launch-${sequence}`, sequence, gameId, selected, grant, clickedAt,
    inputAccepted: false, assetsComplete: false,
    measurement: { classification: 'MEASURED — this synthetic browser visit', titleId: gameId,
      locale: selected.locale, tier: selected.tier, preparationMode: before.enabled ? $('mode').value : 'OFF',
      preparationBodyBytesBeforeClick: before.observedBodyBytes, milestone: 'UNKNOWN — waiting for asset bodies',
      providerPlayable: 'UNKNOWN — not tested; original reference scene only' } };
  activeLaunch = current;
  const frame = document.createElement('iframe'); current.frame = frame;
  frame.title = `${titleNames.get(gameId)} — original non-wagering memory game`;
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.src = '/content-game.html';
  grant.signal.addEventListener('abort', () => {
    if (activeLaunch === current) stopLaunch('Sandbox authorization or launch grant was withdrawn. Game stopped.');
  }, { once: true });
  current.timeout = setTimeout(() => {
    if (activeLaunch !== current || current.assetsComplete) return;
    writeResult(current, { milestone: 'UNKNOWN — launch timed out' });
    stopLaunch('The reference scene did not finish loading. Return to the lobby and retry.');
  }, 20000);
  $('player-status').textContent = 'Authorized synthetic launch. Waiting for complete asset bodies—not calling this interactive.';
  writeResult(current, {});
  $('frame-host').append(frame);
  trace(`${gameId} → LAUNCH_AUTHORIZED`);
  renderAccounting();
}
window.addEventListener('message', event => {
  const current = activeLaunch;
  if (!current || event.origin !== location.origin || event.source !== current.frame.contentWindow
      || current.grant.signal.aborted || !authorization.isGranted()) return;
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'CONTENT_READY') {
    if (current.sent) return;
    current.sent = true;
    current.frame.contentWindow.postMessage({ type: 'CONTENT_LAUNCH', launchId: current.id,
      title: { id: current.gameId, title: titleNames.get(current.gameId) },
      assets: current.grant.plan.assets, locale: current.selected.locale, tier: current.selected.tier }, location.origin);
    return;
  }
  if (data.launchId !== current.id) return;
  if (data.type === 'CONTENT_ASSETS_COMPLETE' && !current.assetsComplete) {
    const approved = current.grant.plan.assets;
    if (data.bodyBytes !== 114688 || !Array.isArray(data.assets) || data.assets.length !== 3
        || !data.assets.every((asset, i) => asset.url === approved[i].url && asset.stage === approved[i].stage
          && asset.bodyBytes === approved[i].estimatedBytes)
        || !Number.isFinite(data.bodyCompleteEpochMs) || data.bodyCompleteEpochMs < current.clickedAt
        || data.bodyCompleteEpochMs > now()) return;
    current.assetsComplete = true; current.bodyCompleteEpochMs = data.bodyCompleteEpochMs; clearTimeout(current.timeout);
    const timing = data.resourceTimings;
    const timingValid = data.resourceTimingLabel === 'MEASURED' && Array.isArray(timing) && timing.length === 3
      && timing.every((entry, i) => entry?.name === approved[i].url && Number.isFinite(entry.transferSize)
        && entry.transferSize >= 0 && entry.encodedBodySize === approved[i].estimatedBytes);
    const transfer = timingValid ? timing.reduce((sum, entry) => sum + entry.transferSize, 0) : 'UNKNOWN';
    writeResult(current, { milestone: 'reference asset response bodies consumed',
      clickToBodiesCompleteMs: Math.round((data.bodyCompleteEpochMs - current.clickedAt) * 10) / 10,
      assetCount: 3, consumedBodyBytes: data.bodyBytes,
      resourceTimingTransferBytes: transfer,
      resourceTimingEncodedBodyBytes: timingValid ? timing.reduce((sum, entry) => sum + entry.encodedBodySize, 0) : 'UNKNOWN',
      cacheObservation: transfer === 0 ? 'Resource Timing reports zero launch asset transfer on this visit'
        : transfer === 'UNKNOWN' ? 'UNKNOWN — matching Resource Timing entries unavailable'
          : 'Launch assets reported nonzero transfer; do not claim a fully cached launch',
      inputAccepted: false });
    $('player-status').textContent = 'MEASURED — asset bodies consumed. Make a move in the game to confirm accepted input.';
    trace(`${current.gameId} → ASSET_BODIES_COMPLETE`);
  } else if (data.type === 'CONTENT_INPUT_ACCEPTED' && current.assetsComplete && !current.inputAccepted) {
    if (!Number.isFinite(data.inputAcceptedEpochMs) || data.inputAcceptedEpochMs < current.bodyCompleteEpochMs
        || data.inputAcceptedEpochMs > now()) return;
    current.inputAccepted = true; loader.recordPlayed(current.gameId);
    writeResult(current, { milestone: 'reference scene input accepted', inputAccepted: true,
      clickToInputAcceptedMs: Math.round((data.inputAcceptedEpochMs - current.clickedAt) * 10) / 10,
      inputTimingNote: 'Includes the user’s delay before making a move; not provider time-to-interactive.' });
    $('player-status').textContent = 'MEASURED — reference scene accepted your input. Interactive in this scene only.';
    trace(`${current.gameId} → INPUT_ACCEPTED`);
  } else if (data.type === 'CONTENT_GAME_COMPLETE' && current.inputAccepted) {
    $('player-status').textContent = 'MEASURED — you completed the reference board. Replay, or return to the lobby.';
  } else if (data.type === 'CONTENT_ERROR') {
    writeResult(current, { milestone: 'UNKNOWN — reference launch failed' });
    stopLaunch('Reference assets could not be loaded safely. No readiness claim was recorded.');
  }
});
$('close-player').addEventListener('click', () => stopLaunch(''));
$('revoke-access').addEventListener('click', () => {
  $('authorization').value = 'DENIED'; authorization.setState('DENIED'); configure();
});
$('player-dialog').addEventListener('cancel', event => { event.preventDefault(); stopLaunch(''); });
document.addEventListener('visibilitychange', () => {
  clearFocusDwell(); intents.cancelPending(); scheduler.stop();
  if (document.visibilityState === 'visible' && !activeLaunch) configure();
  else if (!activeLaunch) $('preparation-status').textContent = 'Page hidden: speculative requests cancelled.';
  renderAccounting();
});
const unsubscribeEnvironment = environment.subscribe(renderAccounting);
// A persisted page was deliberately disposed on hide. Restore via a fresh,
// fail-closed app boot rather than leaving dead listeners or stale consent.
window.addEventListener('pageshow', event => {
  if (event.persisted) { location.reload(); return; }
  // Browsers may restore form fields even when this document was not BF-cached.
  // Keep the visible controls aligned with the new UNKNOWN authorization model.
  $('authorization').value = 'UNKNOWN'; $('prefetch-enabled').checked = false;
  authorization.setState('UNKNOWN'); configure();
});
window.addEventListener('pagehide', () => {
  stopped = true; clearTimeout(noticeTimer); clearFocusDwell(); scheduler.dispose(); intents.dispose();
  stopLaunch('', { restart: false }); thumbnails.forEach(binding => binding.dispose());
  unsubscribeEnvironment(); environment.dispose(); loader.dispose();
}, { once: true });
configure();
