import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8091/game/test_dom/', { waitUntil: 'domcontentloaded' });
  
  for (let s = 1; s <= 14; s++) {
    await page.waitForTimeout(1000);
    const info = await page.evaluate(() => {
      const preload = document.getElementById('preload');
      const stage = document.getElementById('gameStage');
      const canvas = document.querySelector('canvas');
      return {
        preloadDisplay: preload ? getComputedStyle(preload).display : 'missing',
        canvasPresent: !!canvas,
        canvasWidth: canvas ? canvas.width : 0
      };
    });
    console.log('t = ' + s + 's:', JSON.stringify(info));
  }
  await browser.close();
}
test();
