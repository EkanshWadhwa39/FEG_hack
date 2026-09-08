import { chromium } from 'playwright';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

const manifest = [
  "assets/index-canvas-_ynnR-4e.js",
  "assets/vendor-pixi-C8WzrnZv.js",
  "assets/core-engine-DXW-O-mj.js",
  "assets/game-empireofgold-CK6MbOiD.js",
  "assets/panel/css/common.css?v=1788443825853",
  "assets/panel/css/footer.css?v=1788443825853",
  "assets/panel/css/commonGameRules.css?v=1788443825853",
  "assets/panel/css/gameRules.css?v=1788443825853",
  "assets/panel/css/history.css?v=1788443825853",
  "assets/panel/devUtils/cheatTool.css",
  "assets/images/loader.webp",
  "assets/locale/en/gameContent.json",
  "assets/locale/en/commonContent.json",
  "assets/images/@1x/brandLogo.png",
  "assets/fonts/en/Mulish.ttf",
  "assets/fonts/en/NewRocker-Regular.ttf",
  "assets/fonts/en/Oswald-Bold.ttf",
  "assets/spines/@1x/EOG_Logo_Anim.json",
  "assets/spines/@1x/EOG_Logo_Anim.atlas",
  "assets/spines/@1x/EOG_Logo_Anim.png",
  "assets/spines/@1x/EOG_Logo_Anim_2.png",
  "assets/images/@1x/controlPanelPrimaryAssets.json",
  "assets/images/@1x/controlPanelPrimaryAssets.webp",
  "assets/images/@1x/splashBG.json",
  "assets/images/@1x/splashBG.jpg",
  "assets/images/@1x/splashAssets.json",
  "assets/images/@1x/splashAssets.webp",
  "assets/images/@1x/loader_anim.gif",
  "assets/fonts/bmp/bitmapFont.fnt",
  "assets/fonts/bmp/bitmapFont_0.png",
  "assets/spines/@1x/BG_king.json",
  "assets/spines/@1x/BG_king.atlas",
  "assets/spines/@1x/BG_king.png",
  "assets/spines/@1x/BG_king_2.png",
  "assets/images/@1x/controlPanelAssets.json",
  "assets/images/@1x/controlPanelAssets.webp",
  "assets/images/@1x/en/commonLangAssets.json",
  "assets/images/@1x/en/commonLangAssets.webp",
  "assets/images/@1x/gameElements.json",
  "assets/images/@1x/gameElements.webp",
  "assets/spines/@1x/reels_frame.json",
  "assets/spines/@1x/reels_frame.atlas",
  "assets/spines/@1x/reels_frame.png",
  "assets/spines/@1x/reels_frame_2.png",
  "assets/images/@1x/symbols.json",
  "assets/images/@1x/symbols.webp",
  "assets/spines/@1x/king_character.json",
  "assets/spines/@1x/king_character.atlas",
  "assets/spines/@1x/king_character.png",
  "assets/spines/@1x/king_character_2.png",
  "assets/spines/@1x/king_character_3.png",
  "assets/spines/@1x/explosion1.json",
  "assets/spines/@1x/explosion1.atlas",
  "assets/spines/@1x/explosion1.png",
  "assets/images/@1x/en/langImages.json",
  "assets/images/@1x/en/langImages.webp",
  "assets/sounds/ogg/BBGM.ogg",
  "assets/sounds/ogg/genericButtonSound.ogg"
];

async function measure() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'pw-timing-test-'));
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: ['--disk-cache-size=104857600']
  });
  const page = await browser.newPage();

  console.log('Testing WARM prefetch of 58 assets...');
  const slotUrl = 'http://127.0.0.1:8091/game/test_warm_timing/';
  await page.goto('http://127.0.0.1:8090/lobby.html');

  const tPrefetchStart = performance.now();
  await page.evaluate(async ({ urls, base }) => {
    // concurrency 2
    let index = 0;
    async function worker() {
      while (index < urls.length) {
        const u = urls[index++];
        try {
          const r = await fetch(base + u);
          await r.blob();
        } catch(e) {}
      }
    }
    await Promise.all([worker(), worker()]);
  }, { urls: manifest, base: slotUrl });
  const prefetchDurationMs = performance.now() - tPrefetchStart;
  console.log(`Prefetch completed in ${(prefetchDurationMs/1000).toFixed(2)}s (${Math.round(prefetchDurationMs)}ms)`);

  console.log('Now launching game iframe for slot...');
  const tLaunchStart = performance.now();
  await page.goto(slotUrl, { waitUntil: 'domcontentloaded' });

  // Poll for green Play button
  let playTime = null;
  for (let s = 1; s <= 20; s++) {
    await page.waitForTimeout(250);
    const elapsed = (performance.now() - tLaunchStart);
    // take screenshot or check
    if (s % 4 === 0) {
      console.log(`  launch at ${(elapsed/1000).toFixed(2)}s...`);
    }
  }

  await browser.close();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

measure().catch(console.error);
