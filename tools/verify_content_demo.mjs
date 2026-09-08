#!/usr/bin/env node
/** Serial real-browser checks of the ORIGINAL synthetic localhost app. Fresh
 * browser/context per arm; no routes/cache overrides/artificial latency/provider
 * traffic. Output is bounded synthetic telemetry, not raw HAR or player data. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createContentDemoServer } from './content_demo_server.mjs';
import { fixtureManifest, resolveSyntheticFixture } from './content_demo_fixtures.mjs';
import { hashBytes, seedFromAssetHashes, createGame } from '../prototype/src/content-game-model.js';

const args = process.argv.slice(2);
let runs = 3, channel;
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === '--runs' && /^[1-5]$/.test(args[i + 1] ?? '')) runs = Number(args[i + 1]);
  else if (args[i] === '--channel' && args[i + 1] === 'chrome') channel = 'chrome';
  else throw new Error('Usage: npm run verify:demo -- [--runs 1..5] [--channel chrome]');
}
const server = await createContentDemoServer({ port: 0 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const metrics = async () => (await fetch(`${server.origin}/__metrics`)).json();
function assetTotals(snapshot, id) {
  return (id ? [snapshot.by_title[id]] : Object.values(snapshot.by_title)).reduce((sum, bucket) => {
    for (const kind of ['preloader', 'common', 'splash']) {
      sum.requests += bucket[kind].requests; sum.bodyBytes += bucket[kind].body_bytes;
    }
    return sum;
  }, { requests: 0, bodyBytes: 0 });
}
function delta(before, after, id) {
  const a = assetTotals(before, id), b = assetTotals(after, id);
  return { requests: b.requests - a.requests, bodyBytes: b.bodyBytes - a.bodyBytes };
}
async function poll(read, predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read(); if (predicate(value)) return value; await pause(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function readResult(page) {
  try { return JSON.parse(await page.locator('#launch-result').textContent()); } catch { return {}; }
}
async function launch(page, id) {
  await page.locator(`[data-game-id="${id}"]`).click();
  const result = await poll(() => readResult(page), r => r.titleId === id && r.assetCount === 3, 'asset bodies');
  assert.equal(result.consumedBodyBytes, 114688);
  assert.equal(result.inputAccepted, false, 'load/paint must not claim accepted input');
  assert.equal(await page.frameLocator('iframe').locator('#board .card').count(), 16);
  return result;
}
async function prepareTopThree(page) {
  await page.check('#prefetch-enabled');
  await page.waitForSelector('#preparation-status[data-status="TOP3_FINISHED"]');
  assert.equal(await page.locator('#prepared-objects').getAttribute('data-count'), '9');
  assert.equal(await page.locator('#prepared-bytes').getAttribute('data-bytes'), '344064');
}
async function scenario(name, action, contextOptions = {}, init) {
  const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, serviceWorkers: 'block', ...contextOptions });
    if (init) await context.addInitScript(init);
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', () => errors.push('pageerror'));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text().includes('net::ERR_INTERNET_DISCONNECTED') ? 'offline network error' : 'console error'); });
    const before = await metrics();
    await page.goto(server.entryUrl); await page.waitForSelector('.game-card');
    assert.equal(await page.locator('.game-card').count(), 20);
    await poll(() => page.locator('.game-card img:not([hidden])').count(), count => count === 20, 'twenty loaded thumbnails');
    const fixedCards = await page.locator('#catalogue').innerHTML();
    const result = await action({ page, context, before });
    assert.equal(await page.locator('#catalogue').innerHTML(), fixedCards, 'policy must not alter player ordering/styles');
    assert.deepEqual(result.expectedOfflineErrors ? errors.filter(error => error !== 'offline network error') : errors, [], 'no unexpected runtime or CSP errors');
    await context.close(); console.log(`PASS ${name}`);
    return { name, browser: browser.version(), ...result };
  } finally { await browser.close(); }
}
const evidence = { classification: 'MEASURED', contentClassification: 'SIMULATED',
  scope: 'Original Vault Match; synthetic same-loopback Node host; serial isolated browser visits',
  browserChannel: channel ?? 'Playwright Chromium', operatingSystem: process.platform, runsPerArm: runs,
  fixture: { titleId: 'title-01', locale: 'en', tier: '1x', assets: 3, bodyBytes: 114688 },
  methodology: 'Fresh browser/context per arm; exact same URLs; no routing/cache overrides/artificial latency/provider traffic/custom asset cache.',
  byteSemantics: 'Server response body-write deltas plus browser Resource Timing; not packet capture/wire bytes. Excludes thumbnails, HTML, JS and CSS.',
  milestone: 'asset response bodies consumed; input acceptance tested separately by automated trusted browser input, not a human readiness latency',
  providerPlayable: 'UNKNOWN — no provider game tested', pairs: [], diagnostics: [] };
try {
  for (let run = 1; run <= runs; run++) {
    const pair = { run };
    for (const arm of ['CONTROL', 'TREATMENT']) {
      pair[arm] = await scenario(`${arm} ${run}`, async ({ page, before }) => {
        await page.selectOption('#authorization', 'GRANTED');
        if (arm === 'TREATMENT') await prepareTopThree(page);
        const beforeClick = await metrics();
        const prep = delta(before, beforeClick);
        assert.deepEqual(prep, arm === 'CONTROL' ? { requests: 0, bodyBytes: 0 } : { requests: 9, bodyBytes: 344064 });
        const measurement = await launch(page, 'title-01');
        const targetLaunch = delta(beforeClick, await metrics(), 'title-01');
        assert.deepEqual(targetLaunch, arm === 'CONTROL' ? { requests: 3, bodyBytes: 114688 } : { requests: 0, bodyBytes: 0 });
        assert.equal(measurement.resourceTimingTransferBytes, arm === 'CONTROL' ? 115588 : 0);
        await page.frameLocator('iframe').locator('#board .card').first().click();
        const input = await poll(() => readResult(page), r => r.inputAccepted === true, 'accepted input');
        assert.equal(input.milestone, 'reference scene input accepted');
        return { preparationServerDelta: prep, launchServerDelta: targetLaunch, launchMeasurement: measurement,
          automatedInputAccepted: true, cacheGate: 'PASS' };
      });
    }
    evidence.pairs.push(pair);
  }
  evidence.diagnostics.push(await scenario('hover-only exact title + keyboard play + reset', async ({ page, before }) => {
    await page.selectOption('#authorization', 'GRANTED'); await page.selectOption('#mode', 'HOVER');
    await page.check('#prefetch-enabled'); await page.locator('[data-game-id="title-17"]').hover();
    await poll(() => page.locator('#prepared-objects').getAttribute('data-count'), n => n === '3', 'hover bodies');
    const beforeClick = await metrics();
    assert.deepEqual(delta(before, beforeClick, 'title-17'), { requests: 3, bodyBytes: 114688 });
    const result = await launch(page, 'title-17'); assert.equal(result.resourceTimingTransferBytes, 0);
    assert.deepEqual(delta(beforeClick, await metrics()), { requests: 0, bodyBytes: 0 });
    const board = page.frameLocator('iframe');
    const manifest = fixtureManifest('title-17', 'en', '1x');
    const seed = seedFromAssetHashes(manifest.assets.map(asset => hashBytes(resolveSyntheticFixture(asset.url).body)));
    const game = createGame(seed);
    for (let symbol = 0; symbol < 8; symbol++) {
      for (const index of game.deck.map((value, index) => value === symbol ? index : -1).filter(index => index >= 0)) {
        await board.locator(`[data-index="${index}"]`).focus(); await page.keyboard.press('Enter');
      }
    }
    assert.equal(await board.locator('#pairs').textContent(), '8 / 8');
    await poll(() => page.locator('#player-status').textContent(), text => text.includes('completed'), 'board complete');
    await board.locator('#reset').click(); assert.equal(await board.locator('#pairs').textContent(), '0 / 8');
    assert.deepEqual(delta(beforeClick, await metrics()), { requests: 0, bodyBytes: 0 });
    return { hoverTitle: 'title-17', launchTransfer: 0, keyboardBoardCompleted: true, resetRefetches: 0 };
  }));
  evidence.diagnostics.push(await scenario('keyboard focus dwell', async ({ page, before }) => {
    await page.selectOption('#authorization', 'GRANTED'); await page.selectOption('#mode', 'HOVER'); await page.check('#prefetch-enabled');
    await page.locator('[data-game-id="title-18"]').focus();
    await poll(() => page.locator('#prepared-objects').getAttribute('data-count'), n => n === '3', 'focus preparation');
    assert.deepEqual(delta(before, await metrics(), 'title-18'), { requests: 3, bodyBytes: 114688 });
    return { focusTitle: 'title-18', preparedObjects: 3 };
  }));
  evidence.diagnostics.push(await scenario('wrong title remains cold; thumbnails are not game assets', async ({ page, before }) => {
    await page.selectOption('#authorization', 'GRANTED'); await prepareTopThree(page);
    const beforeClick = await metrics();
    const result = await launch(page, 'title-20');
    assert.deepEqual(delta(before, beforeClick, 'title-20'), { requests: 0, bodyBytes: 0 });
    assert.deepEqual(delta(beforeClick, await metrics(), 'title-20'), { requests: 3, bodyBytes: 114688 });
    assert.equal(result.resourceTimingTransferBytes, 115588);
    return { wrongTitleLaunchBodyBytes: 114688, noCrossTitleReuse: true };
  }));
  evidence.diagnostics.push(await scenario('fail closed and live revocation', async ({ page, before }) => {
    for (const state of ['UNKNOWN', 'DENIED', 'ERROR']) {
      await page.selectOption('#authorization', state); await page.check('#prefetch-enabled');
      await page.locator('[data-game-id="title-01"]').hover(); await pause(300);
      await page.locator('[data-game-id="title-01"]').click();
      await poll(() => page.locator('#player-dialog').getAttribute('open'), open => open === null, 'blocked dialog');
      assert.equal(await page.locator('iframe').count(), 0);
    }
    assert.deepEqual(delta(before, await metrics()), { requests: 0, bodyBytes: 0 });
    await page.uncheck('#prefetch-enabled'); await page.selectOption('#authorization', 'GRANTED'); await launch(page, 'title-01');
    // Diagnostic programmatic operator change: the modal makes the select inert.
    await page.locator('#authorization').evaluate(select => { select.value = 'DENIED'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(await page.locator('iframe').count(), 0);
    assert.equal(await page.locator('#player-dialog').getAttribute('open'), null);
    return { blockedStates: ['UNKNOWN', 'DENIED', 'ERROR'], revokedFrameRemoved: true };
  }));
  evidence.diagnostics.push(await scenario('missing network capability blocks speculation, not authorized play', async ({ page, before }) => {
    await page.selectOption('#authorization', 'GRANTED'); await page.check('#prefetch-enabled');
    await page.waitForSelector('#preparation-status[data-status="TOP3_FINISHED"]');
    assert.deepEqual(delta(before, await metrics()), { requests: 0, bodyBytes: 0 });
    assert.equal((await launch(page, 'title-01')).consumedBodyBytes, 114688);
    return { diagnosticInjection: 'navigator.connection unavailable; not a benchmark', speculationBlocked: true, authorizedLaunchWorks: true };
  }, {}, () => { Object.defineProperty(navigator, 'connection', { configurable: true, get: () => undefined }); }));
  evidence.diagnostics.push(await scenario('mobile viewport and reduced motion', async ({ page }) => {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.selectOption('#authorization', 'GRANTED'); await launch(page, 'title-02');
    await page.frameLocator('iframe').locator('#board .card').first().tap();
    await poll(() => readResult(page), r => r.inputAccepted === true, 'touch input');
    const frame = page.frames().find(frame => frame.url().endsWith('/content-game.html'));
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    return { viewport: '390x844 emulated', touchInputAccepted: true, horizontalOverflow: false, actualMobileDevice: 'UNKNOWN — not tested' };
  }, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' }));
  evidence.diagnostics.push(await scenario('offline launch has bounded fallback and online recovery', async ({ page, context }) => {
    await page.selectOption('#authorization', 'GRANTED'); await context.setOffline(true);
    await page.locator('[data-game-id="title-06"]').click();
    await poll(() => readResult(page), result => result.milestone === 'UNKNOWN — launch timed out', 'bounded offline fallback', 30000);
    assert.equal(await page.locator('iframe').count(), 0);
    assert.equal(await page.locator('#player-dialog').getAttribute('open'), null);
    await context.setOffline(false);
    await launch(page, 'title-06');
    return { expectedOfflineErrors: true, diagnosticInjection: 'offline context, not benchmark', boundedFallback: true, onlineRetryWorks: true };
  }));
  evidence.diagnostics.push(await scenario('navigation return and persisted pageshow restore fail-closed controls', async ({ page }) => {
    await page.selectOption('#authorization', 'GRANTED');
    await page.goto(`${server.origin}/health`); await page.goBack(); await page.waitForSelector('.game-card');
    assert.equal(await page.locator('#authorization').inputValue(), 'UNKNOWN');
    // Exercise the persisted event branch explicitly; actual BFCache admission
    // varies by browser and is not asserted by this diagnostic.
    await Promise.all([page.waitForEvent('load'), page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))]);
    await page.waitForSelector('.game-card');
    await poll(() => page.locator('.game-card img:not([hidden])').count(), count => count === 20, 'restored thumbnails');
    assert.equal(await page.locator('#authorization').inputValue(), 'UNKNOWN');
    assert.equal(await page.locator('#prefetch-enabled').isChecked(), false);
    await page.selectOption('#authorization', 'GRANTED'); await launch(page, 'title-07');
    return { navigationReturnWorks: true, diagnosticInjection: 'persisted pageshow event', restoredAuthorization: 'UNKNOWN', restoredConsent: false };
  }));
  evidence.result = 'PASS'; evidence.generatedAt = new Date().toISOString();
  await mkdir(new URL('../evidence/derived/', import.meta.url), { recursive: true });
  await writeFile(new URL('../evidence/derived/content-demo-verification.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`PASS ${runs} isolated pairs and ${evidence.diagnostics.length} diagnostics. Summary: evidence/derived/content-demo-verification.json`);
} finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
