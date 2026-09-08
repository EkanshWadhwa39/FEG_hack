import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err));

  await page.goto('http://127.0.0.1:8090/lobby.html');
  await page.waitForTimeout(1000);

  // Check state of all cards before hover
  const initialCards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.game-card')).slice(0, 4).map(c => ({
      id: c.dataset.gameId,
      state: c.dataset.state,
      badge: c.querySelector('.card-badge')?.textContent,
      time: c.querySelector('.card-time')?.textContent
    }));
  });
  console.log('Initial cards:', initialCards);

  // Now hover Card 2
  console.log('Hovering Card 2...');
  const card2 = await page.$('[data-game-id="2"]');
  await card2.hover();

  // Watch Card 2 over 3 seconds
  for (let i = 1; i <= 6; i++) {
    await page.waitForTimeout(500);
    const card2State = await page.evaluate(() => {
      const c = document.querySelector('[data-game-id="2"]');
      return {
        state: c?.dataset.state,
        badge: c?.querySelector('.card-badge')?.textContent,
        time: c?.querySelector('.card-time')?.textContent,
        badgeClass: c?.querySelector('.card-badge')?.className
      };
    });
    console.log(`Hover +${i*500}ms:`, card2State);
  }

  await browser.close();
}
test();
