import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });

  console.log('Prefetching Game 1 in lobby...');
  await page.goto('http://127.0.0.1:8090/lobby.html');
  await page.waitForSelector('[data-game-id="1"][data-state="warm"]', { timeout: 15000 });
  console.log('Game 1 is WARM!');

  // Now launch Game 1
  console.log('Clicking Game 1...');
  const t0 = performance.now();
  await page.click('[data-game-id="1"]');

  const frameElement = await page.waitForSelector('#frame-host iframe');
  const frame = await frameElement.contentFrame();

  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(200);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    
    // Move mouse over the iframe center where Play button is
    const box = await frameElement.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.77);
    }
    
    const status = await frame.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { hasCanvas: false, cursor: '' };
      return {
        hasCanvas: true,
        cursor: canvas.style.cursor || getComputedStyle(canvas).cursor
      };
    }).catch(e => ({ hasCanvas: false, cursor: e.message }));
    
    console.log(`[${elapsed}s] Canvas cursor: "${status.cursor}"`);
    if (status.cursor === 'pointer') {
      console.log(`>>> WARM PLAY BUTTON DETECTED VIA CURSOR AT ${elapsed}s! <<<`);
      break;
    }
  }
  await browser.close();
}

test().catch(console.error);
