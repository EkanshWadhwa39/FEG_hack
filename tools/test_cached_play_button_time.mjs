import { chromium } from 'playwright';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

async function run() {
  const reqs = JSON.parse(fs.readFileSync('tools/requests_to_play.json'));
  const uniqueUrls = [...new Set(reqs.map(r => r.url).filter(u => u && u.startsWith('assets/')))];

  const userDataDir = mkdtempSync(join(tmpdir(), 'pw-cache-test-'));
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: ['--disk-cache-size=104857600']
  });
  const page = await browser.newPage();

  const slotUrl = 'http://127.0.0.1:8091/game/test_cached/';
  console.log(`Prefetching ${uniqueUrls.length} assets into browser cache...`);

  // Prefetch without link throttling or fetch via browser page
  await page.goto('http://127.0.0.1:8090/lobby.html');

  const results = await page.evaluate(async ({ urls, base }) => {
    const loaded = [];
    for (const u of urls) {
      try {
        const res = await fetch(base + u);
        await res.blob();
        loaded.push(u);
      } catch (e) {
        // ignore
      }
    }
    return loaded;
  }, { urls: uniqueUrls, base: slotUrl });

  console.log(`Prefetched ${results.length}/${uniqueUrls.length} assets into disk cache.`);

  // Now navigate to the slot game and measure time until "Play game" button
  console.log('Navigating to game with 100% warmed assets...');
  const t0 = performance.now();
  await page.goto(slotUrl, { waitUntil: 'domcontentloaded' });

  for (let s = 1; s <= 20; s++) {
    await page.waitForTimeout(500);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    await page.screenshot({ path: `tools/cached_t_${elapsed}s.png` });
    console.log(`t = ${elapsed}s screenshot saved.`);
  }

  await browser.close();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
run();
