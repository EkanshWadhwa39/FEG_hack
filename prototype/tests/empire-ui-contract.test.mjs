import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { CDN_MODE, EARLY_ASSETS, REVIEWED_EMPIRE_ARCHIVE_SHA256, createEmpireSource } from '../src/empire-catalogue.js';
import { empireVariantMetadata, validateEarlyBatch, validateEmpireLaunchGrant } from '../src/empire-milestone.js';
import { startEmpirePlayer, loadWrapperConfiguration, validateWrapperConfiguration } from '../src/empire-player.js';
import { createSyntheticAuthorization } from '../src/content-adapters.js';

// Pure injected clocks/DOM/message ports. No server, socket, browser or provider code.
const copy = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function config() {
  const archiveSha256 = 'a'.repeat(64), build = `empire-${archiveSha256.slice(0, 16)}`;
  return { mode: 'PROVIDER_EARLY_ASSETS', lobbyOrigin: 'http://127.0.0.1:8100', archiveSha256,
    build, locale: 'en', tier: '1x', byteBudget: 10485760,
    entries: Array.from({ length: 20 }, (_, i) => ({ id: `title-${String(i + 1).padStart(2, '0')}`,
      origin: `http://127.0.0.1:${8101 + i}`, assets: EARLY_ASSETS.map(([path, stage, estimatedBytes]) => ({
        url: `http://127.0.0.1:${8101 + i}/${path}`, stage, estimatedBytes,
        sha256: 'b'.repeat(64), releaseBuild: build,
      })) })) };
}
function fakeTimers() {
  let id = 0;
  const timeouts = new Map(), intervals = new Map();
  return { timeouts, intervals,
    setTimeoutImpl(fn, ms) { const key = ++id; timeouts.set(key, { fn, ms }); return key; },
    clearTimeoutImpl(key) { timeouts.delete(key); },
    setIntervalImpl(fn, ms) { const key = ++id; intervals.set(key, { fn, ms }); return key; },
    clearIntervalImpl(key) { intervals.delete(key); },
    fire(ms) {
      const match = [...timeouts].find(([, item]) => item.ms === ms);
      assert.ok(match, `pending ${ms}ms deadline`); timeouts.delete(match[0]); match[1].fn();
    },
  };
}
function eventPort() {
  const listeners = new Map(), events = [];
  return { events, listeners,
    addEventListener(type, fn, options) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push({ fn, once: options?.once }); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter(item => item.fn !== fn)); },
    dispatchEvent(event) {
      events.push(event);
      for (const item of [...(listeners.get(event.type) ?? [])]) {
        if (!(listeners.get(event.type) ?? []).includes(item)) continue;
        if (item.once) this.removeEventListener(event.type, item.fn);
        item.fn(event);
      }
    },
  };
}
function cdnConfig() {
  const value = config(), archiveSha256 = REVIEWED_EMPIRE_ARCHIVE_SHA256;
  const origin = 'https://empire.example.test', assetBaseUrl = `${origin}/releases/${archiveSha256}/`;
  value.mode = CDN_MODE; value.delivery = 'CDN'; value.cachePolicy = 'public, max-age=31536000, immutable';
  value.archiveSha256 = archiveSha256; value.build = `empire-${archiveSha256.slice(0, 16)}`;
  value.entries = [{ id: 'title-01', delivery: 'CDN', origin, wrapperUrl: `${origin}/__vault/player.html`,
    launchUrl: `${assetBaseUrl}index.html?language=en`, assetBaseUrl,
    assets: EARLY_ASSETS.map(([path, stage, estimatedBytes]) => ({ url: `${assetBaseUrl}${path}`, stage, estimatedBytes,
      sha256: 'b'.repeat(64), releaseBuild: value.build })) }];
  return value;
}
function wrapperFixture(options = {}) {
  const value = options.value ?? config(); value.entries = value.entries.slice(0, 1);
  const timers = fakeTimers(), sent = [], state = { textContent: '' };
  const frame = { src: '', removeAttribute() { this.src = ''; },
    contentDocument: { querySelector: () => null },
    contentWindow: { location: { href: 'about:blank' }, performance: { timeOrigin: 1000, getEntriesByType: () => [] } } };
  const parent = { postMessage(data, origin) { sent.push({ data: copy(data), origin }); } };
  const win = { ...eventPort(), location: { origin: value.entries[0].origin }, parent };
  const fetchImpl = options.fetchImpl ?? (async () => ({ ok: true, json: async () => value }));
  const boot = startEmpirePlayer({ window: win, document: { getElementById: id => id === 'state' ? state : frame },
    fetchImpl, clock: { timeOrigin: 1000, now: () => 100 }, ...timers });
  const send = (data, patch = {}) => win.dispatchEvent({ type: 'message', source: parent, origin: value.lobbyOrigin, data, ...patch });
  const launch = { type: 'EMPIRE_LAUNCH', titleId: 'title-01', build: value.build, launchId: 'launch-1', observeEarlyBatch: true };
  return { boot, send, launch, timers, value, win, sent, state, frame };
}

test('configuration deadline covers uncooperative headers and body JSON, aborting and failing closed', async () => {
  for (const body of [false, true]) {
    const timers = fakeTimers(), controller = new AbortController(); let init;
    const result = loadWrapperConfiguration({ ...timers, controller, origin: 'http://127.0.0.1:8101',
      fetchImpl: (_url, options) => {
        init = options;
        return body ? Promise.resolve({ ok: true, json: () => new Promise(() => {}) }) : new Promise(() => {});
      } });
    const rejection = assert.rejects(result, /timed out/);
    await tick(); timers.fire(10000); await rejection;
    assert.equal(controller.signal.aborted, true); assert.equal(timers.timeouts.size, 0);
    assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
  }
});

test('invalid configuration, HTTP error and JSON failure never post READY or mount the provider', async () => {
  for (const mutate of [v => { v.mode = 'other'; }, v => { v.lobbyOrigin = 'http://example.test:8100'; },
    v => { v.entries[0].origin = 'http://127.0.0.1:8200'; }, v => { v.build = 'other'; },
    v => { v.locale = 'hr'; }, v => { v.tier = '0.5x'; }, v => { v.entries[0].assets = []; }]) {
    const value = config(); value.entries = value.entries.slice(0, 1); mutate(value);
    assert.throws(() => validateWrapperConfiguration(value, 'http://127.0.0.1:8101'));
    const f = wrapperFixture({ fetchImpl: async () => ({ ok: true, json: async () => value }) });
    await f.boot; assert.deepEqual(f.sent, []); assert.equal(f.frame.src, '');
    assert.match(f.state.textContent, /not mounted/); assert.equal(f.timers.timeouts.size, 0);
    f.send(f.launch); assert.equal(f.frame.src, '');
  }
  for (const response of [{ ok: false }, { ok: true, json: async () => { throw new Error('secret config body'); } }]) {
    const f = wrapperFixture({ fetchImpl: async () => response }); await f.boot;
    assert.deepEqual(f.sent, []); assert.doesNotMatch(f.state.textContent, /secret/);
  }
});

test('a late configuration cannot resurrect a timed-out or hidden wrapper', async () => {
  for (const hidden of [false, true]) {
    let resolve;
    const f = wrapperFixture({ fetchImpl: () => new Promise(r => { resolve = r; }) });
    if (hidden) f.win.dispatchEvent({ type: 'pagehide' });
    else { f.timers.fire(10000); await f.boot; }
    resolve({ ok: true, json: async () => f.value }); await f.boot; await tick();
    assert.deepEqual(f.sent, []); assert.equal(f.frame.src, ''); assert.equal(f.timers.timeouts.size, 0);
  }
});

test('wrapper launch handshake is bounded; late launch never mounts after expiry', async () => {
  const f = wrapperFixture(); await f.boot;
  assert.equal(f.sent[0].data.type, 'EMPIRE_READY');
  f.timers.fire(10000); f.send(f.launch);
  assert.equal(f.frame.src, ''); assert.match(f.state.textContent, /not mounted/);
  assert.equal(f.timers.intervals.size, 0);
});

test('wrapper preserves source/origin/title/build/launch validation and acknowledges mounting only once', async () => {
  const f = wrapperFixture(); await f.boot;
  for (const patch of [{ source: {} }, { origin: 'http://127.0.0.1:8999' }]) f.send(f.launch, patch);
  for (const patch of [{ titleId: 'title-02' }, { build: 'other' }, { launchId: 'bad' }, { observeEarlyBatch: undefined }]) f.send({ ...f.launch, ...patch });
  assert.equal(f.frame.src, '');
  f.send(f.launch); f.send(f.launch);
  assert.equal(f.frame.src, 'http://127.0.0.1:8101/?language=en');
  assert.deepEqual(f.sent.at(-1), { origin: f.value.lobbyOrigin,
    data: { type: 'EMPIRE_PROVIDER_MOUNTED', titleId: 'title-01', launchId: 'launch-1' } });
  assert.equal(f.sent.filter(e => e.data.type === 'EMPIRE_PROVIDER_MOUNTED').length, 1);
  assert.equal([...f.timers.timeouts.values()].some(t => t.ms === 10000), false);
  f.send({ type: 'EMPIRE_ABORT', launchId: 'launch-0' }); assert.notEqual(f.frame.src, '');
  f.send({ type: 'EMPIRE_ABORT', launchId: 'launch-1' }); assert.equal(f.frame.src, '');
  assert.equal(f.timers.timeouts.size, 0); assert.equal(f.timers.intervals.size, 0);
  f.send(f.launch); assert.equal(f.frame.src, '');
});

test('CDN wrapper accepts only the pinned same-origin release and launches its exact URL verbatim', async () => {
  const value = cdnConfig(), f = wrapperFixture({ value }); await f.boot;
  assert.equal(f.sent[0].data.type, 'EMPIRE_READY');
  f.send({ ...f.launch, build: value.build });
  assert.equal(f.frame.src, value.entries[0].launchUrl);
  const trusted = validateWrapperConfiguration(value, value.entries[0].origin);
  assert.equal(trusted.entries[0].wrapperUrl, value.entries[0].wrapperUrl);
  assert.equal(trusted.entries[0].launchUrl, value.entries[0].launchUrl);
  for (const mutate of [v => { v.archiveSha256 = 'a'.repeat(64); v.build = `empire-${v.archiveSha256.slice(0, 16)}`; },
    v => { v.entries[0].launchUrl += '#changed'; }, v => { v.entries[0].assetBaseUrl += 'other/'; },
    v => { v.entries[0].origin = 'https://other.example.test'; }, v => { v.entries[0].wrapperUrl += '?v=1'; },
    v => { v.cachePolicy = 'no-store'; }]) {
    const changed = cdnConfig(); mutate(changed);
    assert.throws(() => validateWrapperConfiguration(changed, value.entries[0].origin));
  }
});

test('wrapper polling ends even when provider navigation stays blank or throws', async () => {
  for (const inaccessible of [false, true]) {
    const f = wrapperFixture(); await f.boot; f.send(f.launch);
    if (inaccessible) Object.defineProperty(f.frame, 'contentDocument', { get() { throw new Error('navigation'); } });
    for (const item of f.timers.intervals.values()) item.fn();
    f.timers.fire(30000);
    assert.equal(f.timers.intervals.size, 0);
    assert.equal(f.sent.at(-1).data.type, 'EMPIRE_OBSERVATION_END');
    assert.equal(f.sent.at(-1).data.earlyBatchComplete, false);
  }
});

test('mobile wrapper does not report the desktop batch even if all its resources appear', async () => {
  for (const desktop of [false, true]) {
    const f = wrapperFixture(); await f.boot; f.send({ ...f.launch, observeEarlyBatch: desktop });
    f.frame.contentWindow.location.href = `${f.value.entries[0].origin}/?language=en`;
    f.frame.contentWindow.performance.getEntriesByType = () => f.value.entries[0].assets.map(a => ({ name: a.url,
      decodedBodySize: a.estimatedBytes, encodedBodySize: a.estimatedBytes, responseEnd: 20, transferSize: 0 }));
    for (const item of f.timers.intervals.values()) item.fn();
    assert.equal(f.sent.some(e => e.data.type === 'EMPIRE_EARLY_BATCH_COMPLETE'), desktop);
    if (!desktop) assert.match(f.state.textContent, /Desktop early-batch milestone not applicable/);
    f.win.dispatchEvent({ type: 'pagehide' });
    assert.equal(f.timers.timeouts.size, 0); assert.equal(f.timers.intervals.size, 0);
  }
});

const demoSource = await readFile(new URL('../src/empire-demo.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../empire-demo.html', import.meta.url), 'utf8');
test('reviewer instructions require isolated launch and distinguish headless from visual acceptance', () => {
  assert.match(html, /npm run verify:empire -- --zip/);
  assert.match(html, /npm run demo:empire -- --zip/);
  assert.match(html, /browser and server inside the same isolated namespace/);
  assert.match(html, /local graphical display is required/);
  assert.match(html, /Visual acceptance remains UNKNOWN/);
  assert.match(html, /Do not open this provider build in an ordinary browser profile/);
  assert.doesNotMatch(html, /interactive path does not exist yet/);
});
function element() {
  return { ...eventPort(), value: '', checked: false, dataset: {}, textContent: '', children: [], open: false,
    append(...children) { this.children.push(...children); }, prepend(child) { this.children.unshift(child); },
    replaceChildren(...children) { this.children = children; }, setAttribute() {},
    isConnected: true, focus() { this.focusCount = (this.focusCount ?? 0) + 1; },
    querySelectorAll() { return this.children.flatMap(child => child.dataset.gameId ? [child] : child.querySelectorAll()); },
    showModal() { this.open = true; }, close() { this.open = false; },
    get childElementCount() { return this.children.length; },
    contentWindow: { messages: [], postMessage(data, origin) { this.messages.push({ data: copy(data), origin }); } },
  };
}
async function lobbyFixture(desktop = true, options = {}) {
  const value = options.value ?? config(), timers = fakeTimers(), elements = new Map(), win = eventPort();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const doc = { ...eventPort(), getElementById: get, visibilityState: 'visible', createElement: element,
    createDocumentFragment: element, querySelectorAll: () => [...elements.values()],
    querySelector: selector => selector === 'meta[name="empire-config-url"]' && options.configUrl
      ? { content: options.configUrl } : null };
  for (const [id, v] of Object.entries({ mode: 'TOP3', policy: 'POPULAR_UNPLAYED', locale: 'en', tier: '1x' })) get(id).value = v;
  let grantController, auth, onIntent, reloadCount = 0, sandboxRequesterCalls = 0, cdnRequesterCalls = 0, configFetchUrl;
  const grants = [];
  const makeGrant = (gameId = 'title-01') => {
    grantController = new AbortController(); grants.push(grantController);
    return { status: 'LAUNCH_AUTHORIZED', signal: grantController.signal,
      plan: { id: gameId, build: value.build, locale: 'en', tier: '1x',
        assets: value.entries.find(e => e.id === gameId).assets } };
  };
  const loader = { enabled: false, foreground: false, cancelled: 0, resumed: 0, disposed: 0,
    snapshot() { return { enabled: this.enabled, foreground: this.foreground, observedBodyBytes: 0, completedObjects: 0, reservedBodyBytes: 0 }; },
    setPolicy() {}, setEnabled(value) { this.enabled = value; },
    cancelLaunch() { this.cancelled++; grantController?.abort(); },
    resumeBrowsing() { this.resumed++; this.foreground = false; }, dispose() { this.disposed++; },
    async beginLaunch({ gameId }) { this.foreground = true; return auth.isGranted() ? makeGrant(gameId) : { status: 'AUTHORIZATION_BLOCKED' }; } };
  const context = { window: win, document: doc, location: { origin: value.lobbyOrigin, href: `${value.lobbyOrigin}/empire-demo.html`, reload() { reloadCount++; } }, URL, AbortController,
    performance: { timeOrigin: 1000, now: () => 100 },
    fetch: options.fetchImpl ?? (async url => { configFetchUrl = url; return { ok: true, redirected: false, json: async () => value }; }),
    setTimeout: timers.setTimeoutImpl, clearTimeout: timers.clearTimeoutImpl,
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    createEmpireSource, supportsAuditedDesktop: () => desktop, validateEarlyBatch, empireVariantMetadata, validateEmpireLaunchGrant,
    createPopularityPrior: () => ({}), createSyntheticSession: () => ({ snapshot: () => ({}) }),
    createSyntheticAuthorization: initial => { auth = createSyntheticAuthorization(initial); return auth; },
    createBrowserEnvironment: () => ({ read: () => ({}), subscribe: () => () => {}, dispose() {} }),
    createSandboxCatalogueRequester: () => { sandboxRequesterCalls++; return () => {}; },
    createCredentialFreeBrowserRequester: () => { cdnRequesterCalls++; return () => {}; }, createContentLoader: () => loader,
    bindCatalogueIntent: ({ onIntent: handler }) => { onIntent = handler; return { dispose() {}, cancelPending() {} }; },
    bindThumbnailFallback: () => ({ dispose() {} }), topPreparationCandidates: () => [],
    createPreparationScheduler: () => ({ stop() {}, dispose() {}, startBackground() {}, leaveHover() {} }),
  };
  vm.runInNewContext(demoSource.replace(/^import .*;\n/gm, ''), context); await tick();
  const authorize = (state = 'GRANTED') => { get('authorization').value = state; get('authorization').dispatchEvent({ type: 'change' }); };
  const click = (gameId = 'title-01') => onIntent({ kind: 'CLICK', gameId });
  if (options.autoLaunch !== false) {
    authorize(); await click(); await tick();
    assert.ok(get('frame-host').children[0]);
  }
  const send = (data, patch = {}) => {
    const clicks = win.events.filter(e => e.type === 'empire-launch-click');
    const frame = get('frame-host').children[0];
    const titleId = clicks.at(-1)?.detail.titleId ?? 'title-01';
    const launchId = frame?.contentWindow.messages.find(m => m.data.type === 'EMPIRE_LAUNCH')?.data.launchId ?? 'launch-1';
    win.dispatchEvent({ type: 'message', origin: value.entries.find(e => e.id === titleId).origin,
      source: frame?.contentWindow, data: { titleId, launchId, ...data }, ...patch });
  };
  const measurements = () => win.events.filter(e => e.type === 'empire-measurement').map(e => copy(e.detail));
  const ready = () => send({ type: 'EMPIRE_READY' });
  const mount = () => send({ type: 'EMPIRE_PROVIDER_MOUNTED' });
  const resources = value.entries[0].assets.map((a, index) => ({ index, decodedBodySize: a.estimatedBytes,
    encodedBodySize: a.estimatedBytes, transferSize: 0, responseEndEpochMs: 1100 }));
  return { win, doc, get, timers, value, send, ready, mount, measurements, resources, loader, click, authorize, makeGrant, grants,
    get frame() { return get('frame-host').children[0]; }, get grantController() { return grantController; },
    get reloadCount() { return reloadCount; }, get sandboxRequesterCalls() { return sandboxRequesterCalls; },
    get cdnRequesterCalls() { return cdnRequesterCalls; }, get configFetchUrl() { return configFetchUrl; } };
}

test('CDN lobby selects the HTTPS requester and mounts the validated wrapper URL verbatim', async () => {
  const value = cdnConfig(), f = await lobbyFixture(true, { value, configUrl: `${value.entries[0].origin}/__vault/config.json` });
  assert.equal(f.configFetchUrl, `${value.entries[0].origin}/__vault/config.json`);
  assert.equal(f.cdnRequesterCalls, 1); assert.equal(f.sandboxRequesterCalls, 0);
  assert.equal(f.frame.src, value.entries[0].wrapperUrl);
});

test('lobby rejects credentialed, queried and insecure remote configuration URLs before fetch', async () => {
  for (const configUrl of ['http://remote.example/__vault/config.json', 'https://user@cdn.example/__vault/config.json',
    'https://cdn.example/__vault/config.json?v=1']) {
    const f = await lobbyFixture(true, { autoLaunch: false, configUrl });
    assert.equal(f.configFetchUrl, undefined);
    assert.match(f.get('preparation-status').textContent, /failed closed/);
  }
});

test('parent startup timeout is truthful, removes the wrapper, and ignores late handshake events', async () => {
  const f = await lobbyFixture();
  f.timers.fire(12000);
  assert.equal(f.get('frame-host').children.length, 0);
  assert.match(f.get('player-status').textContent, /startup was not confirmed/);
  assert.doesNotMatch(f.get('player-status').textContent, /remains visible/);
  assert.equal(f.measurements().at(-1).startupFailure, 'WRAPPER_HANDSHAKE_TIMEOUT');
  const count = f.measurements().length;
  f.ready(); f.mount(); f.send({ type: 'EMPIRE_EARLY_BATCH_COMPLETE', resources: f.resources });
  assert.equal(f.measurements().length, count);
  f.get('close-player').dispatchEvent({ type: 'click' }); assert.equal(f.get('player-dialog').open, false);
});

test('parent accepts only current-origin/source/title/launch observations after the mount handshake', async () => {
  const f = await lobbyFixture(); const count = f.measurements().length;
  for (const patch of [{ origin: 'http://127.0.0.1:8999' }, { source: {} }]) f.send({ type: 'EMPIRE_READY' }, patch);
  f.send({ type: 'EMPIRE_READY', titleId: 'title-02' });
  assert.equal(f.frame.contentWindow.messages.length, 0);
  f.mount(); f.send({ type: 'EMPIRE_EARLY_BATCH_COMPLETE', resources: f.resources });
  assert.equal(f.measurements().length, count);
  f.ready(); f.ready(); assert.equal(f.frame.contentWindow.messages.length, 1);
  assert.equal(f.frame.contentWindow.messages[0].data.observeEarlyBatch, true);
  f.send({ type: 'EMPIRE_PROVIDER_MOUNTED', launchId: 'launch-old' });
  f.send({ type: 'EMPIRE_EARLY_BATCH_COMPLETE', resources: f.resources }); assert.equal(f.measurements().length, count);
  f.mount(); f.mount();
  assert.equal([...f.timers.timeouts.values()].filter(t => t.ms === 31000).length, 1);
  f.send({ type: 'EMPIRE_EARLY_BATCH_COMPLETE', resources: f.resources, launchId: 'launch-old' });
  assert.equal(f.measurements().length, count);
  f.send({ type: 'EMPIRE_EARLY_BATCH_COMPLETE', resources: f.resources, token: 'secret', url: 'private-launch-url' });
  assert.equal(f.measurements().at(-1).assetCount, 8);
  assert.equal([...f.timers.timeouts.values()].some(t => [12000, 31000].includes(t.ms)), false);
  f.grantController.abort(); assert.equal(f.get('frame-host').children.length, 0);
  const after = f.measurements().length; f.send({ type: 'EMPIRE_CANVAS_OBSERVED', observedAtEpochMs: 1100 });
  assert.equal(f.measurements().length, after);
});

test('read-only observer callbacks retain exact safe payloads; provider message extras never leak', async () => {
  const f = await lobbyFixture(); f.ready(); f.mount();
  f.send({ type: 'EMPIRE_EARLY_BATCH_COMPLETE', resources: f.resources, token: 'secret' });
  const click = f.win.events.find(e => e.type === 'empire-launch-click');
  assert.deepEqual(copy(click.detail), { titleId: 'title-01', clickedAtEpochMs: 1100 });
  const measured = f.measurements().at(-1);
  assert.deepEqual(Object.keys(measured).sort(), ['classification', 'titleId', 'locale', 'tier', 'manifestTier',
    'actualProviderTier', 'tierNote', 'variantSupport', 'milestone', 'preparationMode', 'preparationBodyBytesBeforeClick',
    'providerPlayable', 'inputAccepted', 'clickToEarlyBatchMs', 'assetCount', 'decodedBodyBytes',
    'resourceTimingTransferBytes', 'resourceTimingEncodedBodyBytes', 'cacheObservation'].sort());
  assert.deepEqual(JSON.parse(f.get('launch-result').textContent), measured);
  assert.equal(measured.inputAccepted, false); assert.equal(measured.actualProviderTier, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(measured), /secret|https?:|launchId|resources/);
});

test('mobile parent ignores desktop batch observations and keeps manifest/actual tier separate', async () => {
  const f = await lobbyFixture(false); f.ready(); f.mount();
  assert.equal(f.frame.contentWindow.messages[0].data.observeEarlyBatch, false);
  f.send({ type: 'EMPIRE_EARLY_BATCH_COMPLETE', resources: f.resources });
  f.send({ type: 'EMPIRE_CANVAS_OBSERVED', observedAtEpochMs: 1100 });
  const result = f.measurements().at(-1);
  assert.equal(result.manifestTier, '1x'); assert.equal(result.actualProviderTier, 'UNKNOWN');
  assert.equal(result.canvasObserved, true); assert.equal(result.assetCount, undefined);
  assert.equal(result.clickToEarlyBatchMs, undefined); assert.match(result.milestone, /not applicable/);
  assert.equal([...f.timers.timeouts.values()].some(t => t.ms === 31000), false);
  assert.equal(f.loader.enabled, false);
});

test('mounted-but-incomplete timeout claims neither visible gameplay nor readiness', async () => {
  const f = await lobbyFixture(); f.ready(); f.mount(); f.timers.fire(31000);
  assert.equal(f.get('frame-host').children.length, 1);
  assert.match(f.get('player-status').textContent, /rendering and gameplay readiness are not established/);
  assert.match(f.measurements().at(-1).milestone, /incomplete/);
  assert.equal(f.measurements().at(-1).inputAccepted, false);
});

test('mobile order matches DOM without CSP-blocked styles; policy never rerenders fixed cards', async () => {
  // .operator is inside a normal block, not a workspace grid/flex item. Its
  // shared order:-1 is inert; the two workspace items retain DOM order.
  assert.match(html, /<div class="collection operator-slot"><aside class="operator"/);
  assert.match(html, /<\/aside><\/div>/);
  assert.doesNotMatch(html, /<style|\sstyle=/);
  assert.ok(html.indexOf('class="collection"') < html.indexOf('class="collection operator-slot"'));
  assert.match(html, /Manifest asset tier/);
  assert.match(html, /Actual provider tier: UNKNOWN/);
  assert.equal((demoSource.match(/\$\('catalogue'\)\.append\(cards\)/g) ?? []).length, 1);
  const f = await lobbyFixture(); const cards = f.get('catalogue').children[0].children;
  const before = cards.map(card => ({ id: card.dataset.gameId, className: card.className }));
  for (const policy of ['FAVOURITE', 'POPULAR_UNPLAYED']) {
    f.get('policy').value = policy; f.get('policy').dispatchEvent({ type: 'change' });
    assert.deepEqual(cards.map(card => ({ id: card.dataset.gameId, className: card.className })), before);
  }
  assert.equal(cards.length, 20); assert.equal(new Set(before.map(c => c.id)).size, 20);
});

const listenerCount = port => [...port.listeners.values()].reduce((n, items) => n + items.length, 0);
const card = (f, id = 'title-01') => f.get('catalogue').querySelectorAll().find(el => el.dataset.gameId === id);
const back = f => f.get('close-player').dispatchEvent({ type: 'click' });
const escape = f => {
  let prevented = false;
  f.get('player-dialog').dispatchEvent({ type: 'cancel', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
};

test('lobby configuration has a true headers-and-JSON deadline; late completion cannot enable activity', async () => {
  for (const body of [false, true]) {
    let resolve, signal;
    const waiting = new Promise(r => { resolve = r; });
    const f = await lobbyFixture(true, { autoLaunch: false, fetchImpl: (_url, init) => {
      signal = init.signal;
      assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
      return body ? Promise.resolve({ ok: true, json: () => waiting }) : waiting;
    } });
    f.timers.fire(10000); await tick();
    assert.equal(signal.aborted, true);
    assert.equal(f.get('preparation-status').dataset.status, 'CONFIGURATION_ERROR');
    assert.match(f.get('preparation-status').textContent, /Reload to retry/);
    resolve(body ? f.value : { ok: true, json: async () => f.value }); await tick();
    assert.equal(f.get('catalogue').children.length, 0); assert.equal(f.frame, undefined);
    assert.equal(f.timers.timeouts.size, 0); assert.equal(f.measurements().length, 0);
    assert.equal(listenerCount(f.win), 1); // Only fail-closed BF-cache reload listener remains.
  }
});

test('lobby rejects HTTP/redirect/JSON/configuration errors without displaying sensitive exception details', async () => {
  for (const fetchImpl of [async () => { throw new Error('secret-token'); }, async () => ({ ok: false }),
    async () => ({ ok: true, redirected: true, json: async () => config() }),
    async () => ({ ok: true, json: async () => { throw new Error('secret-token'); } }),
    async () => ({ ok: true, json: async () => ({ ...config(), locale: 'hr' }) })]) {
    const f = await lobbyFixture(true, { autoLaunch: false, fetchImpl });
    assert.equal(f.get('preparation-status').dataset.status, 'CONFIGURATION_ERROR');
    assert.equal(f.get('mode').disabled, true);
    assert.doesNotMatch(f.get('preparation-status').textContent, /secret-token/);
    assert.equal(f.timers.timeouts.size, 0); assert.equal(f.frame, undefined);
  }
});

test('pagehide during lobby config cancels boot and BF-cache restoration requires a fresh fail-closed reload', async () => {
  let resolve, signal;
  const f = await lobbyFixture(true, { autoLaunch: false, fetchImpl: (_url, init) => {
    signal = init.signal; return new Promise(r => { resolve = r; });
  } });
  f.win.dispatchEvent({ type: 'pagehide' }); await tick();
  assert.equal(signal.aborted, true); assert.equal(f.timers.timeouts.size, 0);
  resolve({ ok: true, json: async () => f.value }); await tick();
  assert.equal(f.get('catalogue').children.length, 0); assert.equal(f.frame, undefined);
  f.win.dispatchEvent({ type: 'pageshow', persisted: true }); assert.equal(f.reloadCount, 1);
});

test('malformed/rejected/aborted grants fail closed, restore focus and allow a fresh authorized relaunch', async () => {
  const mutations = [() => null, () => undefined, () => ({}), g => ({ ...g, signal: null }),
    g => ({ ...g, signal: { aborted: false } }), g => ({ ...g, plan: null }),
    g => ({ ...g, status: 'AUTHORIZATION_BLOCKED' }), g => ({ ...g, plan: { ...g.plan, id: 'title-02' } }),
    g => ({ ...g, plan: { ...g.plan, assets: [] } }),
    g => ({ ...g, plan: { ...g.plan, assets: [...g.plan.assets].reverse() } }),
    () => { throw new Error('secret-grant'); }];
  for (const mutate of mutations) {
    const f = await lobbyFixture(true, { autoLaunch: false }); f.authorize();
    const normal = f.loader.beginLaunch.bind(f.loader);
    f.loader.beginLaunch = async () => mutate(f.makeGrant());
    await f.click();
    assert.equal(f.frame, undefined); assert.equal(f.get('player-dialog').open, false);
    assert.equal(f.loader.foreground, false); assert.ok(f.loader.cancelled > 0);
    assert.equal(card(f).focusCount, 1); assert.equal(f.measurements().length, 0);
    assert.doesNotMatch(f.get('notice').textContent, /secret-grant/);
    assert.equal([...f.timers.timeouts.values()].some(t => [12000, 16000].includes(t.ms)), false);
    f.loader.beginLaunch = normal; await f.click(); f.ready(); f.mount();
    assert.ok(f.frame); assert.equal(f.measurements().at(-1).inputAccepted, false); back(f);
  }
  const f = await lobbyFixture(true, { autoLaunch: false }); f.authorize();
  f.loader.beginLaunch = async () => { const grant = f.makeGrant(); f.grantController.abort(); return grant; };
  await f.click(); assert.equal(f.frame, undefined); assert.equal(card(f).focusCount, 1);
});

test('Back and Escape cancel pending grants; a late grant never mounts or disturbs a newer launch', async () => {
  for (const close of [back, escape]) {
    const f = await lobbyFixture(true, { autoLaunch: false }); f.authorize();
    const normal = f.loader.beginLaunch.bind(f.loader); const oldGrant = f.makeGrant();
    let resolve;
    f.loader.beginLaunch = () => new Promise(r => { resolve = r; });
    const pending = f.click(); await tick();
    assert.equal(f.get('player-dialog').open, true); assert.equal(f.frame, undefined);
    close(f); await pending;
    assert.equal(f.get('player-dialog').open, false); assert.equal(card(f).focusCount, 1);
    assert.equal(f.timers.timeouts.size, 0);
    f.loader.beginLaunch = normal; await f.click('title-02'); const currentFrame = f.frame;
    f.ready(); f.mount(); const before = f.measurements().length;
    resolve(oldGrant); await tick();
    assert.equal(f.frame, currentFrame); assert.equal(f.measurements().length, before);
    assert.equal(f.measurements().at(-1).titleId, 'title-02'); close(f);
    assert.equal(card(f, 'title-02').focusCount, 1); assert.equal(f.timers.timeouts.size, 0);
  }
});

test('uncooperative launch boundary times out closed; late grant is ignored and no sensitive failure leaks', async () => {
  const f = await lobbyFixture(true, { autoLaunch: false }); f.authorize();
  const oldGrant = f.makeGrant(); let resolve;
  f.loader.beginLaunch = () => new Promise(r => { resolve = r; });
  const pending = f.click(); await tick(); f.timers.fire(16000); await pending;
  assert.equal(f.frame, undefined); assert.equal(f.get('player-dialog').open, false);
  assert.equal(card(f).focusCount, 1); assert.equal(f.loader.foreground, false);
  resolve(oldGrant); await tick(); assert.equal(f.frame, undefined); assert.equal(f.measurements().length, 0);
});

test('Back/Escape after mount remove frames, deadlines and grant listeners and preserve observer identity on relaunch', async () => {
  for (const close of [back, escape]) {
    const f = await lobbyFixture(); f.ready(); f.mount();
    const oldFrame = f.frame, oldController = f.grantController;
    close(f);
    assert.equal(f.frame, undefined); assert.equal(f.get('player-dialog').open, false);
    assert.equal(card(f).focusCount, 1); assert.equal(f.timers.timeouts.size, 0);
    assert.equal(oldController.signal.aborted, true);
    assert.equal(oldFrame.contentWindow.messages.at(-1).data.type, 'EMPIRE_ABORT');
    await f.click(); f.ready(); f.mount();
    const current = f.frame, count = f.measurements().length;
    assert.notEqual(current, oldFrame);
    assert.notEqual(current.contentWindow.messages[0].data.launchId, oldFrame.contentWindow.messages[0].data.launchId);
    f.send({ type: 'EMPIRE_EARLY_BATCH_COMPLETE', resources: f.resources, launchId: 'launch-1' }, { source: oldFrame.contentWindow });
    oldController.abort(); assert.equal(f.frame, current); assert.equal(f.measurements().length, count);
    close(f); assert.equal(f.timers.timeouts.size, 0);
  }
});

test('explicit wrapper mount failure is validated, bounded, recoverable and never a readiness signal', async () => {
  const f = await lobbyFixture();
  f.send({ type: 'EMPIRE_STARTUP_FAILURE', reason: 'PROVIDER_MOUNT_FAILED' }); assert.ok(f.frame);
  f.ready();
  f.send({ type: 'EMPIRE_STARTUP_FAILURE', reason: 'secret-reason' }); assert.ok(f.frame);
  f.send({ type: 'EMPIRE_STARTUP_FAILURE', reason: 'PROVIDER_MOUNT_FAILED' });
  assert.equal(f.frame, undefined); assert.equal(f.timers.timeouts.size, 0);
  assert.equal(f.get('close-player').focusCount, 1);
  const result = f.measurements().at(-1);
  assert.equal(result.startupFailure, 'PROVIDER_MOUNT_FAILED'); assert.equal(result.inputAccepted, false);
  assert.equal(result.actualProviderTier, 'UNKNOWN'); assert.doesNotMatch(JSON.stringify(result), /secret-reason/);
  escape(f); await f.click(); f.ready(); f.mount(); assert.ok(f.frame); back(f);
});

test('dialog/mount exceptions fail closed and remain recoverable without an unhandled rejection', async () => {
  for (const mount of [false, true]) {
    const f = await lobbyFixture(true, { autoLaunch: false }); f.authorize();
    const target = mount ? f.get('frame-host') : f.get('player-dialog');
    const key = mount ? 'append' : 'showModal', normal = target[key];
    target[key] = () => { throw new Error('secret-navigation'); };
    await f.click();
    assert.equal(f.frame, undefined); assert.equal(f.get('player-dialog').open, false);
    assert.equal(f.timers.timeouts.size, 1); // Bounded recovery notice only.
    assert.equal(card(f).focusCount, 1); assert.doesNotMatch(f.get('notice').textContent, /secret-navigation/);
    target[key] = normal; await f.click(); assert.ok(f.frame); back(f);
  }
});

test('pagehide disposes lobby timers/listeners once; stale controls and late events cannot relaunch', async () => {
  const f = await lobbyFixture(); f.ready(); f.mount();
  f.win.dispatchEvent({ type: 'pagehide' }); await tick();
  assert.equal(f.frame, undefined); assert.equal(f.timers.timeouts.size, 0);
  assert.equal(f.loader.disposed, 1); assert.equal(f.grantController.signal.aborted, true);
  assert.equal(listenerCount(f.win), 1); assert.equal(listenerCount(f.doc), 0);
  for (const id of ['catalogue', 'authorization', 'mode', 'prefetch-enabled', 'policy', 'locale', 'tier', 'close-player', 'revoke-access', 'player-dialog']) {
    assert.equal(listenerCount(f.get(id)), 0, id);
  }
  const count = f.measurements().length;
  f.authorize(); await f.click(); f.send({ type: 'EMPIRE_CANVAS_OBSERVED', observedAtEpochMs: 1100 });
  assert.equal(f.measurements().length, count); assert.equal(f.frame, undefined);
  f.win.dispatchEvent({ type: 'pagehide' }); assert.equal(f.loader.disposed, 1);
  f.win.dispatchEvent({ type: 'pageshow', persisted: true }); assert.equal(f.reloadCount, 1);
});

test('wrapper standalone validation rejects sparse and non-exact asset identities and snapshots trusted fields', () => {
  const original = config(); original.entries = original.entries.slice(0, 1);
  for (const mutate of [v => { delete v.entries[0].assets[3]; }, v => { v.entries[0].assets[1] = null; },
    v => { v.entries[0].assets[0].sha256 = ''; }, v => { v.entries[0].assets[0].releaseBuild = 'other'; },
    v => { v.entries[0].assets[0].url += '?v=other'; }, v => { v.entries[0].assets[0].stage = 'SECONDARY'; },
    v => { v.entries[0].assets[0].estimatedBytes++; }, v => { v.lobbyOrigin = v.entries[0].origin; },
    v => { v.entries[0].id = 'title-21'; }]) {
    const value = copy(original); mutate(value);
    assert.throws(() => validateWrapperConfiguration(value, original.entries[0].origin));
  }
  const result = validateWrapperConfiguration(original, original.entries[0].origin);
  original.entries[0].assets[0].url = 'http://example.test'; original.lobbyOrigin = 'http://example.test';
  assert.equal(result.lobbyOrigin, 'http://127.0.0.1:8100');
  assert.match(result.entries[0].assets[0].url, /^http:\/\/127\.0\.0\.1:8101\//);
  assert.equal(Object.isFrozen(result.entries[0].assets[0]), true);
});

test('wrapper stop removes message/pagehide listeners on abort, config failure and mount failure', async () => {
  const failed = wrapperFixture({ fetchImpl: async () => ({ ok: false }) }); await failed.boot;
  assert.equal(listenerCount(failed.win), 0);
  for (const mountFailure of [false, true]) {
    const f = wrapperFixture(); await f.boot;
    if (mountFailure) {
      Object.defineProperty(f.frame, 'src', { configurable: true, get: () => '', set: value => { if (value) throw new Error('mount failure'); } });
    }
    f.send(f.launch);
    if (!mountFailure) f.send({ type: 'EMPIRE_ABORT', launchId: 'launch-1' });
    else assert.equal(f.sent.at(-1).data.type, 'EMPIRE_STARTUP_FAILURE');
    assert.equal(listenerCount(f.win), 0); assert.equal(f.timers.timeouts.size, 0); assert.equal(f.timers.intervals.size, 0);
  }
});
