import { chromium } from 'playwright';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

async function run() {
  const reqs = JSON.parse(fs.readFileSync('tools/requests_to_play.json'));
  const uniqueUrls = [...new Set(reqs.map(r => r.url).filter(u => u && u.startsWith('assets/')))];

  const userDataDir = mkdtempSync(join(tmpdir(), 'pw-cache-test2-'));
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: ['--disk-cache-size=104857600']
  });
  const page = await browser.newPage();

  const slotUrl = 'http://127.0.0.1:8091/game/test_cached2/';
  await page.goto('http://127.0.0.1:8090/lobby.html');

  console.log(`Pre-warming ${uniqueUrls.length} assets...`);
  await page.evaluate(async ({ urls, base }) => {
    for (const u of urls) {
      try {
        const res = await fetch(base + u);
        await res.blob();
      } catch (e) {}
    }
  }, { urls: uniqueUrls, base: slotUrl });

  console.log('Pre-warm finished. Navigating to game with CDP tracking...');
  const cdp = await browser.newCDPSession(page);
  await cdp.send('Network.enable');

  const navRequests = [];
  cdp.on('Network.requestWillBeSent', e => {
    if (e.request.url.includes('8091')) {
      navRequests.push({ url: e.request.url.split('?')[0].split('/').slice(-2).join('/'), id: e.requestId, time: performance.now() });
    }
  });
  cdp.on('Network.loadingFinished', e => {
    const r = navRequests.find(x => x.id === e.requestId);
    if (r) r.bytes = e.encodedDataLength;
  });

  const t0 = performance.now();
  await page.goto(slotUrl, { waitUntil: 'domcontentloaded' });

  await page.waitForTimeout(6000);
  console.log('Requests during game load:');
  for (const r of navRequests) {
    console.log(`  [+${Math.round(r.time - t0)}ms] ${r.url} (wireBytes: ${r.bytes})`);
  }

  await browser.close();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
run();
