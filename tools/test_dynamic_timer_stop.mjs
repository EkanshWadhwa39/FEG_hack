import { chromium } from 'playwright';

async function run() {
  console.log('====================================================');
  console.log('TESTING DYNAMIC TIMER STOP & INTERACTIVE PLAY DETECTION');
  console.log('====================================================');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('[1] Navigating to lobby...');
  await page.goto('http://127.0.0.1:8090/lobby.html');

  // Wait for Game 1 auto-warm (top-1 sequential)
  console.log('[2] Waiting for Game 1 auto-warm...');
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-game-id="1"]');
    return card?.dataset.state === 'warm';
  }, { timeout: 10000 });
  console.log('  ✓ Game 1 auto-warmed to 100%!');

  // Launch Game 1 (WARM)
  console.log('[3] Launching Game 1 (Warm Treatment)...');
  await page.click('[data-game-id="1"]');

  let warmResult = null;
  const warmStart = Date.now();
  while (Date.now() - warmStart < 8000) {
    const state = await page.evaluate(() => {
      const clock = document.getElementById('launch-elapsed-clock')?.textContent;
      const precise = document.getElementById('launch-timing-precise')?.textContent;
      const ready = document.getElementById('launch-readiness-label')?.textContent;
      const title = document.getElementById('launch-status-title')?.textContent;
      return { clock, precise, ready, title };
    });

    if (state.ready?.includes('PLAY BUTTON READY') || state.title === 'Interactive Play Button Ready!') {
      warmResult = state;
      console.log(`  ✓ Warm launch interactive play button detected at ${state.clock} (${state.precise})`);
      break;
    }
    await page.waitForTimeout(50);
  }

  if (!warmResult) {
    throw new Error('Warm launch did not detect interactive play button within 8s');
  }

  await page.screenshot({ path: 'evidence/derived/test_warm_dynamic_timer.png' });

  // Close Game 1
  await page.click('#close-game');
  await page.waitForTimeout(500);

  // Launch Game 5 (COLD)
  console.log('[4] Launching Game 5 (Cold Baseline)...');
  await page.click('[data-game-id="5"]');

  let coldResult = null;
  const coldStart = Date.now();
  let lastLog = 0;

  while (Date.now() - coldStart < 25000) {
    const state = await page.evaluate(() => {
      const clock = document.getElementById('launch-elapsed-clock')?.textContent;
      const precise = document.getElementById('launch-timing-precise')?.textContent;
      const ready = document.getElementById('launch-readiness-label')?.textContent;
      const title = document.getElementById('launch-status-title')?.textContent;
      return { clock, precise, ready, title };
    });

    const elapsedSec = Math.floor((Date.now() - coldStart) / 1000);
    if (elapsedSec > lastLog && elapsedSec % 2 === 0) {
      lastLog = elapsedSec;
      console.log(`  ... Cold launch streaming: ${state.clock} (${state.ready})`);
    }

    if (state.ready?.includes('PLAY BUTTON READY') || state.title === 'Interactive Play Button Ready!') {
      coldResult = state;
      console.log(`  ✓ Cold launch interactive play button detected at ${state.clock} (${state.precise})`);
      break;
    }
    await page.waitForTimeout(50);
  }

  if (!coldResult) {
    throw new Error('Cold launch did not detect interactive play button within 25s');
  }

  await page.screenshot({ path: 'evidence/derived/test_cold_dynamic_timer.png' });
  await browser.close();

  console.log('\n====================================================');
  console.log('RESULTS SUMMARY');
  console.log('====================================================');
  console.log('Warm Timer Stopped At:', warmResult.clock, '|', warmResult.precise);
  console.log('Cold Timer Stopped At:', coldResult.clock, '|', coldResult.precise);
  console.log('====================================================');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
