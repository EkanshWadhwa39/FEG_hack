#!/usr/bin/env node
/** Serial unchanged-provider experiment. Run through verify_empire_isolated.sh.
 * One browser at a time; fixed origins and browsing interval; no routing, custom
 * cache, provider patch, readiness fabrication or control-only slowdown.
 * HARs are private and body-omitted; public output is a bounded whitelist.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import { delta, summarizePairs, cacheEvidence, networkBatch, timingQuality, proofVerdict, experimentVerdict, documentRole, preparationComplete } from './empire_measurement.mjs';
import { exportEmpireHar } from './redact_empire_har.mjs';
import { runReviewerQA } from './empire_reviewer_qa.mjs';
import { inspectHarCoverage, expectedPreparationTitles } from './empire_har_coverage.mjs';
import { runLiveRevocation } from './empire_revocation_diagnostic.mjs';
const EXPECTED_ARCHIVE_SHA256 = 'f0b4947f9d703af9c99419418293ac518189afe3c8dabfc9781f9558a9dacdba';

let zip, interactive = false, interactiveSmoke = false, runs = 10, dwellMs = 3000, horizonMs = 30000, diagnostics = true;
let output = 'evidence/derived/empire-provider-measurement.json';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Use npm run verify:empire -- --zip PRIVATE.zip [--runs 1..20] [--dwell-ms 0..15000] [--horizon-ms 5000..30000] [--output FILE.json] [--no-diagnostics] [--interactive | --interactive-smoke]');
  console.log('Linux isolated namespace only. Unthrottled early-asset proof, not gameplay. Skipped diagnostics make acceptance INCONCLUSIVE.');
  process.exit(0);
}
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--interactive') { interactive = true; continue; }
  if (key === '--interactive-smoke') { interactive = true; interactiveSmoke = true; continue; }
  if (key === '--no-diagnostics') { diagnostics = false; continue; }
  const value = args[++i];
  if (key === '--zip' && value) zip = path.resolve(value);
  else if (key === '--runs' && /^(?:[1-9]|1[0-9]|20)$/.test(value ?? '')) runs = Number(value);
  else if (key === '--dwell-ms' && /^\d+$/.test(value ?? '') && Number(value) <= 15000) dwellMs = Number(value);
  else if (key === '--horizon-ms' && /^\d+$/.test(value ?? '') && Number(value) >= 5000 && Number(value) <= 30000) horizonMs = Number(value);
  else if (key === '--output' && value?.endsWith('.json')) output = value;
  else throw new Error('Usage: --zip PRIVATE.zip [--runs 1..20] [--dwell-ms 0..15000] [--horizon-ms 5000..30000] [--output FILE.json] [--no-diagnostics] [--interactive]');
}
if (!zip) throw new Error('A private --zip is required; no archive is downloaded or bundled.');
if (interactive && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  throw new Error('Interactive mode requires a graphical display. Use verify:empire for headless validation.');
}
const runId = `empire-${Date.now()}`;
const privateDir = path.resolve('evidence/private', runId);
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await mkdir(path.dirname(output), { recursive: true });
const redactedDir = path.resolve('evidence/derived', runId);
await mkdir(redactedDir, { recursive: true, mode: 0o700 });
async function sourceHashes(directory) {
  const records = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) records.push(...await sourceHashes(file));
    else if (/\.(?:js|mjs|html|css|py|sh)$/.test(file)) records.push([file, createHash('sha256').update(await readFile(file)).digest('hex')]);
  }
  return records;
}
const evidence = {
  classification: 'MEASURED', runId, scope: 'One unchanged Empire of Gold archive; English desktop @1x; 20 SIMULATED loopback identities',
  authorization: 'SIMULATED fail-closed fixture, not the real exclusion register',
  network: 'Unthrottled localhost origins; ordinary host networking; no Playwright request routing or artificial throttling',
  browser: null, rendering: 'Headless Chromium; SwiftShader explicitly requested, not representative GPU hardware',
  method: { runsPerArm: runs, dwellMs, horizonMs, browsingToleranceMs: 250, snapshotGapToleranceMs: 250, samplingToleranceMs: 100, order: 'counterbalanced CONTROL/TREATMENT across pairs',
    freshBrowserAndServerPerArm: true, cacheEnabled: true, preconnect: false,
    preparation: 'Real lobby top-three scheduler, bounded eight-object PRELOADER/partial COMMON subset',
    clickRule: 'Same fixed browsing interval; never wait for warm completion only in treatment',
    milestone: 'App launch-handler click epoch to all eight CDP Network.loadingFinished epochs, inside a fixed observation window; provider gameplay readiness UNKNOWN',
    clickInput: 'SIMULATED DOM button.click(), identical in both arms; not evidence of accepted provider input',
    bytes: 'Server socket-accepted body bytes, excluding HTTP headers and lobby/wrapper/cover resources; identity delivery in both arms. launch/selectedLaunch are PRE-DISPATCH-SNAPSHOT-TO-SAMPLE counters, NOT exact click-separated bytes. Snapshot/click gap retained.',
    sessionHorizon: 'Preparation plus provider traffic sampled by the independent Node/server clock, not blocked page evaluation; actual sample start/end and overruns retained' },
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  source: { dependencies: await Promise.all(['package.json', 'package-lock.json', 'requirements-dev.txt'].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])), baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    uncommittedIntegration: true, fileHashes: (await Promise.all(['prototype', 'tools', 'scripts'].map(sourceHashes))).flat() },
  providerPlayable: 'UNKNOWN', pairs: [], diagnostics: [],
};
async function save() {
  evidence.summary = summarizePairs(evidence.pairs);
  evidence.proofVerdict = experimentVerdict(evidence, { runs, diagnosticsRequired: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}
async function startServer(cachePolicy) {
  const child = spawn('python3', ['tools/empire_catalogue_server.py', '--zip', zip, '--cache-policy', cachePolicy, '--expected-archive-sha256', EXPECTED_ARCHIVE_SHA256],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '', errors = 0;
  child.stderr.on('data', () => { errors++; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SERVER_START_TIMEOUT')), 15000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('SERVER_START_FAILED')); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('SERVER_EXITED_BEFORE_READY')); });
    child.stdout.on('data', chunk => {
      text += chunk;
      if (text.includes('\n')) {
        clearTimeout(timer);
        try { resolve(JSON.parse(text.split('\n')[0])); } catch { reject(new Error('SERVER_BAD_READY')); }
      }
      if (text.length > 65536) { clearTimeout(timer); reject(new Error('SERVER_BAD_READY')); }
    });
  });
  const close = async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    try { await deadline(exited, 20000, 'SERVER_STOP_TIMEOUT'); }
    catch { if (child.exitCode === null) child.kill('SIGKILL'); await exited; }
  };
  try { const info = await ready; return { info, pid: child.pid, close, stderrEvents: () => errors }; }
  catch (error) { await close(); throw error; }
}
async function scenario(name, { arm = 'CONTROL', titleIndex = 0, cachePolicy = 'cache', action, warmMode = 'TOP3', intentTitle } = {}) {
  let server, browser, context;
  const record = { name, arm, titleIndex, cachePolicy, status: 'UNKNOWN', stage: 'SETUP' };
  try {
    server = await startServer(cachePolicy);
    record.stage = 'SERVER_READY';
    const origin = server.info.lobbyOrigin;
    const metrics = async () => (await fetch(`${origin}/__vault/stats.json`, { signal: AbortSignal.timeout(5000) })).json();
    const config = await (await fetch(`${origin}/__vault/config.json`)).json();
    evidence.archiveSha256 = config.archiveSha256;
    assert.equal(config.entries.length, 20); assert.equal(config.entries[0].assets.length, 8);
    const lookup = new Map(config.entries.flatMap((title, ti) => title.assets.map((asset, ai) => [asset.url, { titleIndex: ti, assetIndex: ai }])));
    record.stage = 'BROWSER_START';
    browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
    evidence.browser = browser.version();
    record.stage = 'PROCESS_ATTESTATION';
    record.stage = 'LOBBY';
    context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, serviceWorkers: 'block',
      recordHar: { path: `${privateDir}/${name}.har`, content: 'omit', mode: 'full' } });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    let phase = 'BROWSING', pageErrors = 0, clickObserved, uiMeasurement;
    const click = new Promise(resolve => { clickObserved = resolve; });
    await page.exposeBinding('__empireReadOnly', ({ frame }, kind, fields) => {
      if (frame !== page.mainFrame() || !fields || JSON.stringify(fields).length > 4096) return;
      if (kind === 'click' && fields.titleId === config.entries[titleIndex].id && Number.isFinite(fields.clickedAtEpochMs)) clickObserved(fields.clickedAtEpochMs);
      if (kind === 'measurement' && fields.titleId === config.entries[titleIndex].id) uiMeasurement = fields;
    });
    await page.addInitScript(() => {
      if (window !== window.top) return;
      for (const [event, kind] of [['empire-launch-click', 'click'], ['empire-measurement', 'measurement']]) {
        window.addEventListener(event, message => { void window.__empireReadOnly(kind, message.detail).catch(() => {}); });
      }
    });
    page.on('pageerror', () => { pageErrors++; });
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
    const requests = new Map(), cached = new Set(), events = [];
    cdp.on('Network.requestWillBeSent', event => {
      const identity = lookup.get(event.request.url);
      if (identity) requests.set(event.requestId, { ...identity, phase,
        documentRole: documentRole(event.documentURL, config.entries[identity.titleIndex].origin, origin),
        startedEpochMs: event.wallTime * 1000, clockOffsetMs: (event.wallTime - event.timestamp) * 1000 });
    });
    cdp.on('Network.requestServedFromCache', event => {
      cached.add(event.requestId);
      const response = events.find(e => e.requestId === event.requestId);
      if (response) response.memoryCache = true;
    });
    cdp.on('Network.responseReceived', event => {
      const identity = requests.get(event.requestId);
      if (identity) events.push({ ...identity, requestId: event.requestId, status: event.response.status,
        diskCache: event.response.fromDiskCache === true, prefetchCache: event.response.fromPrefetchCache === true,
        memoryCache: cached.has(event.requestId) });
    });
    cdp.on('Network.loadingFinished', event => {
      const response = events.find(e => e.requestId === event.requestId);
      if (response) response.finishedEpochMs = event.timestamp * 1000 + response.clockOffsetMs;
    });
    cdp.on('Network.loadingFailed', event => {
      const response = events.find(e => e.requestId === event.requestId);
      if (response) response.failed = true;
    });
    const before = await metrics();
    await page.goto(origin); await page.waitForSelector('.game-card');
    assert.equal(await page.locator('.game-card').count(), 20);
    const fixedCards = await page.locator('#catalogue').innerHTML();
    if (action) {
      phase = 'LAUNCH';
      Object.assign(record, await action({ page, context, before, metrics, config,
        providerActivity: () => networkBatch(events, { titleIndex, expectedAssets: 8, clickedAtEpochMs: 0, cutoffEpochMs: Date.now() }).assetCount }));
    } else {
      await page.selectOption('#authorization', 'GRANTED');
      await page.selectOption('#mode', warmMode);
      // Equivalent DOM operator event in both arms; same fixed browsing lead time.
      const triggered = await page.locator('#prefetch-enabled').evaluate((input, enabled) => {
        const epoch = performance.timeOrigin + performance.now();
        input.checked = enabled; input.dispatchEvent(new Event('change', { bubbles: true }));
        return { epoch, cards: document.getElementById('catalogue').innerHTML };
      }, arm === 'TREATMENT');
      assert.equal(triggered.cards, fixedCards, 'Policy changed fixed player cards');
      const triggerEpochMs = triggered.epoch;
      if (intentTitle) await page.locator(`[data-game-id="${intentTitle}"]`).focus();
      await pause(Math.max(0, triggerEpochMs + dwellMs - Date.now()));
      const snapshotStartedEpochMs = Date.now();
      const beforeClick = await metrics();
      record.preparation = delta(before, beforeClick);
      record.selectedPreparation = delta(before, beforeClick, titleIndex);
      const snapshotEndedEpochMs = Date.now();
      record.preDispatchSnapshot = { startedEpochMs: snapshotStartedEpochMs, endedEpochMs: snapshotEndedEpochMs };
      record.byteBoundary = 'launch/selectedLaunch: pre-dispatch snapshot to independent observation sample, not exact click-separated bytes';
      record.stage = 'CLICK'; phase = 'LAUNCH';
      // Dispatch identical real app click handlers without awaiting renderer work.
      // The app supplies the click epoch before authorization/iframe attachment.
      void page.locator(`[data-game-id="title-${String(titleIndex + 1).padStart(2, '0')}"]`)
        .evaluate(button => { button.click(); }).catch(error => { record.clickDispatchErrorType = error.name; });
      const clickEpochMs = await deadline(click, 20000, 'CLICK_OBSERVATION_TIMEOUT');
      const cutoffEpochMs = clickEpochMs + horizonMs;
      record.observedBrowsingMs = clickEpochMs - triggerEpochMs;
      record.snapshotToClickMs = clickEpochMs - snapshotStartedEpochMs;
      record.clickedAtEpochMs = clickEpochMs;
      record.stage = 'OBSERVATION';
      await pause(Math.max(0, cutoffEpochMs - Date.now()));
      // Never consult the blocked renderer to decide when to sample the server.
      const sampleStart = Date.now();
      const after = await metrics();
      const sampleEnd = Date.now();
      record.observedPostClickMs = { sampleStartedMs: sampleStart - clickEpochMs, sampleEndedMs: sampleEnd - clickEpochMs };
      record.observationOverrunMs = Math.max(0, sampleEnd - cutoffEpochMs);
      record.timingQuality = timingQuality({ ...record, dwellMs });
      record.launch = delta(beforeClick, after);
      record.selectedLaunch = delta(beforeClick, after, titleIndex);
      record.session = delta(before, after);
      record.stage = 'CLOSE_AND_ATTRIBUTE';
      await context.close(); context = null;
      const withinWindow = events.filter(e => e.startedEpochMs >= clickEpochMs && e.finishedEpochMs <= cutoffEpochMs);
      record.networkObservations = events.map(({ requestId: _id, clockOffsetMs: _offset, ...safe }) => safe);
      record.preparationCompletedBeforeClick = preparationComplete(events, { titleIndex, expectedAssets: 8, clickedAtEpochMs: clickEpochMs });
      record.intendedPreparationCompleted = expectedPreparationTitles(record).every(ti =>
        preparationComplete(events, { titleIndex: ti, expectedAssets: 8, clickedAtEpochMs: clickEpochMs }));
      record.measurement = networkBatch(events, { titleIndex, expectedAssets: 8, clickedAtEpochMs: clickEpochMs, cutoffEpochMs });
      record.earlyAssetCacheEvidence = cacheEvidence(withinWindow, titleIndex, 8);
      record.exactEarlyReuseObserved = record.measurement.assetCount === 8
        && record.preparationCompletedBeforeClick
        && record.selectedPreparation.earlyRequests === 8
        && record.selectedPreparation.earlyBodyBytes === 523940
        && record.selectedLaunch.earlyRequests === 0
        && record.selectedLaunch.earlyBodyBytes === 0
        && record.earlyAssetCacheEvidence.every(asset => asset.browserCacheAttributed);
      record.uiMeasurement = uiMeasurement ?? { milestone: 'UNKNOWN — no renderer observation delivered before close', providerPlayable: 'UNKNOWN' };
      record.unselectedPreparationBodyBytes = record.preparation.bodyBytes - record.selectedPreparation.bodyBytes;
      record.costNote = 'Unselected preparation is unused within this one-selection observation, not necessarily wasted forever.';
      record.status = record.measurement.assetCount === 8 ? 'COMPLETE_EARLY_BATCH' : 'UNKNOWN_EARLY_BATCH';
      assert.equal(record.measurement.inputAccepted, false);
    }
    record.pageErrors = pageErrors;
    record.serverStderrEvents = server.stderrEvents();
    if (context) { await context.close(); context = null; }
    record.redactedHar = await exportEmpireHar(`${privateDir}/${name}.har`, `${redactedDir}/${name}-early.har`);
    if (!action) {
      const coverageOptions = { titleIndex, clickedAtEpochMs: record.clickedAtEpochMs, horizonMs,
        preparationTitles: expectedPreparationTitles(record) };
      // Private HAR is read locally for all-provider pre-click coverage, never printed.
      record.harCoverage = inspectHarCoverage(JSON.parse(await readFile(`${privateDir}/${name}.har`, 'utf8')), coverageOptions);
      // Independently require the actual sanitized reviewer artifact to retain proof.
      record.redactedHarCoverage = inspectHarCoverage(JSON.parse(await readFile(`${redactedDir}/${name}-early.har`, 'utf8')), coverageOptions);
    }
    record.proofVerdict = proofVerdict(record);
    record.stage = 'DONE';
    console.log(`${name}: ${record.status}; early=${record.measurement?.clickToEarlyBatchMs ?? 'UNKNOWN'}ms; selected launch early bytes=${record.selectedLaunch?.earlyBodyBytes ?? 'n/a'}`);
  } catch (error) {
    record.status = 'ERROR'; record.proofVerdict = 'FAIL'; record.errorType = error.name;
    const safeCodes = ['SERVER_START_TIMEOUT', 'SERVER_START_FAILED', 'SERVER_EXITED_BEFORE_READY', 'SERVER_BAD_READY',
      'LAUNCH_PROCESS_CONFINEMENT_UNVERIFIED', 'CLICK_OBSERVATION_TIMEOUT'];
    if (safeCodes.includes(error.message)) record.errorCode = error.message;
    // Do not reflect provider exceptions, URLs, private paths or request data.
    console.log(`${name}: ERROR (${error.name}); retained in report`);
  } finally {
    await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await server?.close();
  }
  return record;
}
async function interactiveDemo() {
  let server, browser;
  try {
    server = await startServer('cache');
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ viewport: null, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(server.info.lobbyOrigin);
    await page.waitForSelector('.game-card');
    assert.equal(await page.locator('.game-card').count(), 20);
    console.log('Local interactive sandbox running. Close its browser to stop. SIMULATED authorization; gameplay readiness UNKNOWN.');
    if (interactiveSmoke) {
      assert.equal(await page.locator('#frame-host iframe').count(), 0);
      await page.selectOption('#authorization', 'DENIED');
      await page.locator('[data-game-id="title-01"]').click();
      assert.equal(await page.locator('#frame-host iframe').count(), 0);
      const stats = await (await fetch(`${server.info.lobbyOrigin}/__vault/stats.json`, { signal: AbortSignal.timeout(5000) })).json();
      assert.equal(stats.instances.reduce((sum, instance) => sum + instance.requests, 0), 0);
      await context.close();
      const qa = await runReviewerQA({ browser, origin: server.info.lobbyOrigin, privateDir,
        metrics: async () => (await fetch(`${server.info.lobbyOrigin}/__vault/stats.json`, { signal: AbortSignal.timeout(5000) })).json() });
      const report = { classification: 'MEASURED', status: 'PASS', mode: 'HEADED_REVIEWER_QA',
        runId, runtime: evidence.runtime, source: evidence.source, ...qa,
        browser: browser.version(), catalogueCards: 20, denialBlockedProviderLaunch: true,
        providerPlayable: 'UNKNOWN' };
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      console.log(`Headed reviewer QA PASS; report: ${output}`);
    } else {
      await new Promise(resolve => {
        browser.once('disconnected', resolve);
        process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
      });
    }
  } finally { await browser?.close().catch(() => {}); await server?.close(); }
}
if (interactive) {
  await interactiveDemo();
} else {
try {
  await save();
  for (let run = 1; run <= runs; run++) {
    const pair = { run, order: run % 2 ? ['CONTROL', 'TREATMENT'] : ['TREATMENT', 'CONTROL'] };
    evidence.pairs.push(pair);
    for (const arm of pair.order) { pair[arm] = await scenario(`pair-${run}-${arm}`, { arm }); await save(); }
  }
  if (diagnostics) {
    for (const [name, options] of [
      ['wrong-title', { arm: 'TREATMENT', titleIndex: 19 }],
      ['no-store', { arm: 'TREATMENT', cachePolicy: 'no-store' }],
      ['keyboard-intent', { arm: 'TREATMENT', titleIndex: 16, warmMode: 'HOVER', intentTitle: 'title-17' }],
      ['fail-closed', { action: async ({ page, before, metrics }) => {
        for (const state of ['UNKNOWN', 'DENIED', 'ERROR']) {
          await page.selectOption('#authorization', state); await page.check('#prefetch-enabled');
          await page.locator('[data-game-id="title-01"]').hover(); await pause(300);
          await page.locator('[data-game-id="title-01"]').click(); await pause(100);
          assert.equal(await page.locator('#frame-host iframe').count(), 0);
        }
        const traffic = delta(before, await metrics()); assert.equal(traffic.requests, 0);
        return { status: 'PASS', blockedStates: ['UNKNOWN', 'DENIED', 'ERROR'], traffic };
      } }],
      ['live-revocation', { action: runLiveRevocation }],
    ]) { evidence.diagnostics.push(await scenario(name, options)); await save(); }
  }
} finally { await save(); }
console.log(`Redacted report: ${output}`);
console.log(JSON.stringify(evidence.summary));
console.log(`Required proof verdict: ${evidence.proofVerdict}`);
if (evidence.proofVerdict !== 'PASS') process.exitCode = evidence.proofVerdict === 'FAIL' ? 1 : 2;

}
