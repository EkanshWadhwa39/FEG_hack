/** Serial, non-benchmark reviewer QA. Invoked only by the isolated headed launcher.
 * Real preparation requests; provider-document navigation is forbidden/observed. Offline/capability
 * interventions are SIMULATED diagnostics, never cache/performance evidence.
 */
import assert from 'node:assert/strict';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await pause(100); }
  throw new Error('QA_CONDITION_TIMEOUT');
}
export async function runReviewerQA({ browser, origin, privateDir, metrics }) {
  const checks = [], screenshots = [];
  const total = snapshot => snapshot.instances.reduce((sum, row) => sum + row.requests, 0);
  async function visit(name, options, action, init) {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, serviceWorkers: 'block', ...options });
    try {
      if (init) await context.addInitScript(init);
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      let providerDocumentRequests = 0;
      page.on('request', request => {
        if (request.isNavigationRequest() && /^http:\/\/127\.0\.0\.1:(?:810[1-9]|811\d|8120)\/\?language=en$/.test(request.url())) providerDocumentRequests++;
      });
      const before = total(await metrics());
      await page.goto(origin); await page.waitForSelector('.game-card');
      assert.equal(await page.locator('.game-card').count(), 20);
      await action({ page, context, requests: async () => total(await metrics()) - before });
      assert.equal(providerDocumentRequests, 0, 'Non-provider reviewer QA must not launch the provider');
      assert.equal(await page.locator('#frame-host iframe').count(), 0);
      checks.push({ name, status: 'PASS', providerDocumentRequests });
    } finally { await context.close(); }
  }
  await visit('desktop-keyboard-policy-and-real-preparation', {}, async ({ page, requests }) => {
    assert.equal(await page.inputValue('#authorization'), 'UNKNOWN');
    assert.equal(await page.isChecked('#prefetch-enabled'), false);
    const catalogue = await page.locator('#catalogue').innerHTML();
    for (const state of ['UNKNOWN', 'DENIED', 'ERROR']) {
      await page.selectOption('#authorization', state);
      await page.check('#prefetch-enabled');
      const card = page.locator('[data-game-id="title-01"]');
      await card.focus(); await page.keyboard.press('Enter');
      await until(async () => !(await page.locator('#player-dialog').evaluate(node => node.open)));
      assert.equal(await page.locator('#frame-host iframe').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.gameId), 'title-01');
    }
    assert.equal(await requests(), 0);
    await page.uncheck('#prefetch-enabled');
    await page.locator('#policy').focus();
    for (const policy of ['FAVOURITE', 'POPULAR_UNPLAYED']) {
      await page.selectOption('#policy', policy);
      assert.equal(await page.locator('#catalogue').innerHTML(), catalogue);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'policy');
    }
    await page.selectOption('#authorization', 'GRANTED');
    await page.check('#prefetch-enabled');
    await until(async () => Number(await page.locator('#prepared-objects').getAttribute('data-count')) === 24);
    assert.equal(Number(await page.locator('#prepared-bytes').getAttribute('data-bytes')), 1571820);
    assert.equal(await requests(), 24);
    assert.equal(await page.locator('#catalogue').innerHTML(), catalogue);
    await page.selectOption('#mode', 'HOVER');
    await page.locator('[data-game-id="title-17"]').focus();
    await until(async () => Number(await page.locator('#prepared-objects').getAttribute('data-count')) === 32);
    assert.equal(await requests(), 32);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.gameId), 'title-17');
    await page.screenshot({ path: `${privateDir}/reviewer-desktop-lobby.png`, fullPage: true });
    screenshots.push('reviewer-desktop-lobby.png');
    await page.reload(); await page.waitForSelector('.game-card');
    assert.equal(await page.inputValue('#authorization'), 'UNKNOWN');
    assert.equal(await page.isChecked('#prefetch-enabled'), false);
    assert.equal(await page.locator('#frame-host iframe').count(), 0);
  });
  await visit('mobile-reduced-motion-conservative-variant', {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce',
    userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  }, async ({ page, requests }) => {
    await page.selectOption('#authorization', 'GRANTED'); await page.check('#prefetch-enabled');
    await page.locator('[data-game-id="title-01"]').focus(); await pause(500);
    assert.equal(await requests(), 0);
    assert.match(await page.textContent('#preparation-status'), /desktop variant not established/);
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${privateDir}/reviewer-mobile-lobby.png`, fullPage: true });
    screenshots.push('reviewer-mobile-lobby.png');
  });
  for (const mode of ['missing', 'save-data']) {
    await visit(`simulated-${mode}-capability-blocks-preparation`, {}, async ({ page, requests }) => {
      await page.selectOption('#authorization', 'GRANTED'); await page.check('#prefetch-enabled');
      await pause(600); assert.equal(await requests(), 0);
      assert.equal(Number(await page.locator('#prepared-objects').getAttribute('data-count')), 0);
    }, mode === 'missing' ? () => {
      Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined });
    } : () => {
      Object.defineProperty(navigator, 'connection', { configurable: true,
        value: { effectiveType: '4g', saveData: true, addEventListener() {}, removeEventListener() {} } });
    });
  }
  await visit('simulated-offline-wrapper-failure-and-keyboard-recovery', {}, async ({ page, context, requests }) => {
    await page.selectOption('#authorization', 'GRANTED');
    await context.setOffline(true);
    await page.locator('[data-game-id="title-01"]').focus(); await page.keyboard.press('Enter');
    await until(async () => /wrapper was removed/.test(await page.textContent('#player-status')), 18000);
    assert.equal(await page.locator('#frame-host iframe').count(), 0);
    assert.match(await page.textContent('#launch-result'), /WRAPPER_HANDSHAKE_TIMEOUT/);
    await page.screenshot({ path: `${privateDir}/reviewer-offline-recovery.png`, fullPage: true });
    screenshots.push('reviewer-offline-recovery.png');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#player-dialog').evaluate(node => node.open), false);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.gameId), 'title-01');
    await context.setOffline(false); await page.selectOption('#authorization', 'DENIED');
    await page.locator('[data-game-id="title-02"]').click();
    await until(async () => !(await page.locator('#player-dialog').evaluate(node => node.open)));
    assert.equal(await requests(), 0);
  });
  return { checks, screenshots, observedProviderDocumentRequests: 0, providerPlayable: 'UNKNOWN',
    limitation: 'Automated headed Chromium with virtual display; not human visual, screen-reader or physical-mobile acceptance. Capability and offline interventions are SIMULATED. Not a cache benchmark.' };
}
