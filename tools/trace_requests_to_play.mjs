import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const requests = [];

  page.on('request', req => {
    if (req.url().includes('8091')) {
      requests.push({
        url: req.url().split('?')[0].replace(/http:\/\/127\.0\.0\.1:8091\/game\/[^/]+\//, ''),
        time: performance.now()
      });
    }
  });

  const t0 = performance.now();
  await page.goto('http://127.0.0.1:8091/game/cold_trace/', { waitUntil: 'domcontentloaded' });

  let playFound = false;
  let playTime = 0;
  for (let s = 1; s <= 15; s++) {
    await page.waitForTimeout(500);
    // take screenshot or check if play button rendered by examining pixel or canvas
    // Let's capture screenshot and check
    await page.screenshot({ path: `tools/trace_${s * 500}ms.png` });
  }

  console.log(`Total requests captured: ${requests.length}`);
  const fs = await import('fs');
  fs.writeFileSync('tools/requests_to_play.json', JSON.stringify(requests, null, 2));
  await browser.close();
}
run();
