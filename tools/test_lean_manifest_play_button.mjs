import { chromium } from 'playwright';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

async function test() {
  const all = JSON.parse(fs.readFileSync('tools/all_game_assets.json'));
  const warmup36 = all.filter((a) =>
    !a.path.includes('sounds/') &&
    !a.path.includes('bigwins') &&
    !a.path.includes('scatter') &&
    !a.path.includes('chest') &&
    !a.path.includes('book') &&
    !a.path.includes('shield') &&
    !a.path.includes('cup') &&
    !a.path.includes('low_') &&
    !a.path.includes('spines/')
  );

  console.log(`Testing with lean ${warmup36.length} assets (~5.5 MB)...`);
  const userDataDir = mkdtempSync(join(tmpdir(), 'pw-lean-test-'));
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: ['--disk-cache-size=104857600']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });

  const slotUrl = 'http://127.0.0.1:8091/game/test_lean_warm/';

  // Step 1: Pre-warm the 36 assets via fetch
  console.log('Prewarming 36 assets...');
  const tWarm0 = performance.now();
  await page.goto('http://127.0.0.1:8090/sandbox.html');
  await page.evaluate(async ({ urls, base }) => {
    for (const u of urls) {
      try {
        const res = await fetch(base + u.path, { mode: 'cors', credentials: 'omit' });
        await res.blob();
      } catch (e) {}
    }
  }, { urls: warmup36, base: slotUrl });
  const warmDuration = ((performance.now() - tWarm0) / 1000).toFixed(2);
  console.log(`Prewarm complete in ${warmDuration}s!`);

  // Step 2: Navigate to game and detect cursor pointer on canvas
  console.log('Navigating to game and detecting Play button via cursor pointer...');
  const tLaunch0 = performance.now();
  await page.goto(slotUrl, { waitUntil: 'domcontentloaded' });

  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(200);
    const elapsed = ((performance.now() - tLaunch0) / 1000).toFixed(2);
    
    // Move mouse over Play button center
    await page.mouse.move(640, 520);
    
    const cursor = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return canvas ? (canvas.style.cursor || getComputedStyle(canvas).cursor) : 'no-canvas';
    });
    
    console.log(`[${elapsed}s] Canvas cursor: "${cursor}"`);
    if (cursor === 'pointer') {
      console.log(`>>> SUCCESS: PLAY BUTTON READY AT ${elapsed}s WITH LEAN 36 MANIFEST! <<<`);
      break;
    }
  }

  await browser.close();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

test().catch(console.error);
