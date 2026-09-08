import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Loading lobby...');
  await page.goto('http://127.0.0.1:8090/lobby.html');

  // Wait for Game 1 to be warm
  await page.waitForFunction(() => document.querySelector('[data-game-id="1"]')?.dataset.state === 'warm');
  console.log('Game 1 is warm!');

  console.log('Clicking Game 1...');
  const t0 = Date.now();
  await page.click('[data-game-id="1"]');

  for (let s = 1; s <= 12; s++) {
    await page.waitForTimeout(1000);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    await page.screenshot({ path: `tools/warm_timeline_${elapsed}s.png` });
    console.log(`Saved warm_timeline_${elapsed}s.png`);
  }

  await browser.close();
}
run();
