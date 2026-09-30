import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.setViewportSize({ width: 1280, height: 720 });
  const t0 = performance.now();
  await page.goto('http://127.0.0.1:8091/game/test_cursor/', { waitUntil: 'domcontentloaded' });
  
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(400);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    
    // Hover over the center-bottom where the Play button is
    await page.mouse.move(640, 520);
    
    const status = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { hasCanvas: false, cursor: '' };
      return {
        hasCanvas: true,
        cursor: canvas.style.cursor || getComputedStyle(canvas).cursor,
        width: canvas.width,
        height: canvas.height
      };
    });
    
    console.log(`[${elapsed}s] Canvas cursor: "${status.cursor}" (canvas: ${status.hasCanvas})`);
    if (status.cursor === 'pointer') {
      console.log(`>>> PLAY BUTTON DETECTED VIA CURSOR AT ${elapsed}s! <<<`);
      break;
    }
  }
  await browser.close();
}

test().catch(console.error);
