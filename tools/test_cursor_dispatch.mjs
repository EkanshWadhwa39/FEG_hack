import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto('http://127.0.0.1:8090/lobby.html');
  await page.waitForSelector('[data-game-id="1"][data-state="warm"]', { timeout: 15000 });
  console.log('Game 1 is WARM! Clicking...');
  
  const t0 = performance.now();
  await page.click('[data-game-id="1"]');

  const frameElement = await page.waitForSelector('#frame-host iframe');
  const frame = await frameElement.contentFrame();

  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    
    // Dispatch pointermove to canvas center-bottom
    const res = await frame.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { hasCanvas: false, cursor: '' };
      
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height * 0.75; // location of startBtn

      canvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: cx,
        clientY: cy,
        bubbles: true,
        cancelable: true
      }));
      
      return {
        hasCanvas: true,
        cursor: canvas.style.cursor,
        rect: { w: Math.round(rect.width), h: Math.round(rect.height) }
      };
    }).catch(e => ({ hasCanvas: false, cursor: e.message }));
    
    console.log(`[${elapsed}s] cursor: "${res.cursor}" (rect: ${JSON.stringify(res.rect || {})})`);
    if (res.cursor === 'pointer') {
      console.log(`>>> DETECTED PLAY BUTTON VIA CURSOR DISPATCH AT ${elapsed}s! <<<`);
      break;
    }
  }
  await browser.close();
}

test().catch(console.error);
