import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOBBY:', msg.text()));

  await page.goto('http://127.0.0.1:8090/lobby.html');
  await page.waitForTimeout(3500); // wait for warm

  console.log('Clicking Game 1...');
  const t0 = Date.now();
  await page.click('[data-game-id="1"]');

  const frameElement = await page.waitForSelector('#frame-host iframe');
  const frame = await frameElement.contentFrame();

  frame.on('console', msg => console.log('GAME:', msg.text()));

  for (let sec = 1; sec <= 18; sec++) {
    await page.waitForTimeout(1000);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const info = await frame.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button, div, span, a'))
        .filter(el => (el.textContent && el.textContent.toLowerCase().includes('play')) || (el.className && typeof el.className === 'string' && el.className.includes('play')))
        .map(el => ({ tag: el.tagName, class: el.className, text: el.textContent.trim() }));
      const canvas = document.querySelector('canvas');
      const stage = document.getElementById('gameStage');
      return {
        hasCanvas: !!canvas,
        stageChildren: stage ? stage.children.length : 0,
        buttons: allButtons.slice(0, 5),
        bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 80)
      };
    }).catch(e => ({ error: e.message }));
    console.log(`[${elapsed}s]`, JSON.stringify(info));
  }
  await browser.close();
}

test().catch(console.error);
