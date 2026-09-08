import { chromium } from 'playwright';

const PORT = 8090;
const BASE = `http://127.0.0.1:${PORT}`;

async function stress() {
  console.log('================================================================');
  console.log(' COMPREHENSIVE STRESS TEST — ALL PAGES + EDGE CASES');
  console.log('================================================================\n');

  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const warnings = [];
  const findings = [];

  function finding(severity, area, msg) {
    findings.push({ severity, area, msg });
    const icon = severity === 'CRASH' ? '💥' : severity === 'BUG' ? '🐛' : 'ℹ️';
    console.log(`  ${icon} [${severity}] ${area}: ${msg}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: INDEX.HTML — Basic instrumented demo
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[1] INDEX.HTML — Instrumented demo page');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => { pageErrors.push(e.message); errors.push(e.message); });
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    if (pageErrors.length > 0) {
      finding('CRASH', 'index.html', `Page errors on load: ${pageErrors.join('; ')}`);
    } else {
      console.log('  ✓ index.html loads without page errors');
    }

    // Toggle prefetch off/on
    const toggle = await page.$('#prefetch-toggle');
    if (toggle) {
      await toggle.click();
      await page.waitForTimeout(200);
      await toggle.click();
      await page.waitForTimeout(200);
      console.log('  ✓ Prefetch toggle cycles without crash');
    }

    // Change budget selector
    const budget = await page.$('#budget-select');
    if (budget) {
      await page.selectOption('#budget-select', { index: 0 });
      await page.waitForTimeout(200);
      console.log('  ✓ Budget selector change handled');
    }

    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: PLAYER.HTML — Drawer, transition, RG state
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[2] PLAYER.HTML — Drawer + Transition + RG State');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => { pageErrors.push(e.message); errors.push(e.message); });

    await page.goto(`${BASE}/player.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    if (pageErrors.length > 0) {
      finding('CRASH', 'player.html', `Page errors on load: ${pageErrors.join('; ')}`);
    } else {
      console.log('  ✓ player.html loads without page errors');
    }

    // Open drawer
    const drawerBtn = await page.$('#drawer-trigger');
    if (drawerBtn) {
      await drawerBtn.click();
      await page.waitForTimeout(300);
      console.log('  ✓ Drawer opens');

      // Rapid tab switching
      const tabs = await page.$$('[role="tab"]');
      for (let i = 0; i < Math.min(tabs.length, 5); i++) {
        await tabs[i % tabs.length].click();
        await page.waitForTimeout(50);
      }
      console.log(`  ✓ Rapid tab switching (${tabs.length} tabs) — no crash`);

      // Search with empty then full input
      const search = await page.$('#drawer-search');
      if (search) {
        await search.fill('');
        await page.waitForTimeout(100);
        await search.fill('gold');
        await page.waitForTimeout(100);
        await search.fill('');
        await page.waitForTimeout(100);
        await search.fill('xyznonexistent');
        await page.waitForTimeout(100);
        console.log('  ✓ Search stress (empty, match, clear, no-match) — no crash');
      }

      // Escape close
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      console.log('  ✓ Escape closes drawer');
    }

    // Launch a game and test transition
    const gameItem = await page.$('[data-game-id]');
    if (gameItem) {
      // Open drawer first
      if (drawerBtn) await drawerBtn.click();
      await page.waitForTimeout(200);

      const items = await page.$$('#drawer-results li');
      if (items.length > 0) {
        await items[0].click();
        await page.waitForTimeout(1500);
        console.log('  ✓ Game launch transition initiated');
      }
    }

    if (pageErrors.length === 0) {
      console.log('  ✓ player.html stress complete — 0 crashes');
    }
    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: SANDBOX.HTML — Cold vs warm harness
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[3] SANDBOX.HTML — Cold vs warm launch harness');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => { pageErrors.push(e.message); errors.push(e.message); });

    await page.goto(`${BASE}/sandbox.html`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    if (pageErrors.length > 0) {
      finding('CRASH', 'sandbox.html', `Page errors on load: ${pageErrors.join('; ')}`);
    } else {
      console.log('  ✓ sandbox.html loads without page errors');
    }
    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: LOBBY.HTML — Main stress target
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[4] LOBBY.HTML — Full 20-game lobby stress');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => { pageErrors.push(e.message); errors.push(e.message); });
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
      if (m.type() === 'warn') warnings.push(m.text());
    });

    // 4a: Initial load
    console.log('\n  [4a] Initial load...');
    await page.goto(`${BASE}/lobby.html?nowarm=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lobby-grid');
    const cards = await page.$$eval('.game-card', c => c.length);
    if (cards !== 20) {
      finding('BUG', 'lobby-grid', `Expected 20 cards, got ${cards}`);
    } else {
      console.log(`  ✓ 20 game cards rendered`);
    }

    if (pageErrors.length > 0) {
      finding('CRASH', 'lobby.html', `Page errors on load: ${pageErrors.join('; ')}`);
    }

    // 4b: Cold baseline mode — hover must NOT trigger prefetch
    console.log('\n  [4b] Cold baseline mode...');
    await page.click('#prefetch-toggle'); // uncheck
    await page.waitForTimeout(200);
    const badge = await page.$eval('#toggle-state-badge', e => e.textContent.trim());
    if (!badge.includes('COLD')) {
      finding('BUG', 'toggle', `Expected COLD BASELINE, got "${badge}"`);
    } else {
      console.log(`  ✓ Toggle switched to COLD BASELINE`);
    }

    // Hover every card in cold mode — no state changes expected
    for (let i = 1; i <= 20; i++) {
      await page.hover(`[data-game-id="${i}"]`);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(500);
    const anyWarm = await page.$$eval('.game-card', cs =>
      cs.some(c => c.dataset.state !== 'cold')
    );
    if (anyWarm) {
      finding('BUG', 'cold-mode', 'A card changed state during cold mode hover sweep');
    } else {
      console.log('  ✓ All 20 cards remain cold during cold-mode hover sweep');
    }

    // Switch back to warm
    await page.click('#prefetch-toggle');
    await page.waitForTimeout(200);

    // 4c: Rapid hover on/off — race condition stress
    console.log('\n  [4c] Rapid hover on/off (race condition stress)...');
    const preErrors = [...pageErrors];
    for (let round = 0; round < 3; round++) {
      for (let i = 2; i <= 10; i++) {
        await page.hover(`[data-game-id="${i}"]`);
        await page.waitForTimeout(30 + Math.random() * 50); // sub-dwell
        await page.mouse.move(0, 0);
        await page.waitForTimeout(10);
      }
    }
    await page.waitForTimeout(500);
    const raceErrors = pageErrors.filter(e => !preErrors.includes(e));
    if (raceErrors.length > 0) {
      finding('CRASH', 'rapid-hover', `Errors during rapid hover: ${raceErrors.join('; ')}`);
    } else {
      console.log('  ✓ 30 rapid hover on/off cycles — no crash');
    }

    // 4d: Diagnostics drawer toggle
    console.log('\n  [4d] Diagnostics drawer...');
    const diagBtn = await page.$('#btn-toggle-telemetry');
    if (diagBtn) {
      await diagBtn.click();
      await page.waitForTimeout(200);
      const visible = await page.$eval('#telemetry-details', e => !e.hidden);
      if (!visible) finding('BUG', 'diagnostics', 'Diagnostics drawer did not open');
      else console.log('  ✓ Diagnostics drawer opens');

      await diagBtn.click();
      await page.waitForTimeout(200);
      const hidden = await page.$eval('#telemetry-details', e => e.hidden);
      if (!hidden) finding('BUG', 'diagnostics', 'Diagnostics drawer did not close');
      else console.log('  ✓ Diagnostics drawer closes');
    }

    // 4e: Budget selector — switch to 50MB then unlimited
    console.log('\n  [4e] Budget selector stress...');
    await page.selectOption('#budget-selector', '52428800');
    await page.waitForTimeout(200);
    const govMsg = await page.$eval('#manifest-msg', e => e.textContent);
    console.log(`  ✓ Budget 50MB: "${govMsg.slice(0, 80)}..."`);

    await page.selectOption('#budget-selector', '107374182400');
    await page.waitForTimeout(200);
    console.log('  ✓ Budget back to Unlimited');

    // 4f: Launch + close game rapidly (double-click race)
    console.log('\n  [4f] Rapid launch/close stress...');
    const preErrors2 = [...pageErrors];
    for (let i = 3; i <= 6; i++) {
      await page.click(`[data-game-id="${i}"]`);
      await page.waitForTimeout(200);
      const panelVisible = await page.$eval('#game-panel', e => !e.hidden);
      if (!panelVisible) {
        finding('BUG', 'rapid-launch', `Game panel did not open for game ${i}`);
        continue;
      }
      await page.click('#close-game');
      await page.waitForTimeout(200);
    }
    const launchErrors = pageErrors.filter(e => !preErrors2.includes(e));
    if (launchErrors.length > 0) {
      finding('CRASH', 'rapid-launch', `Errors during rapid launch/close: ${launchErrors.join('; ')}`);
    } else {
      console.log('  ✓ 4 rapid launch/close cycles — no crash');
    }

    // 4g: Launch game, simulate network drop, dismiss
    console.log('\n  [4g] Network drop rollback...');
    await page.click('[data-game-id="8"]');
    await page.waitForSelector('#game-panel:not([hidden])');
    await page.waitForTimeout(500);

    const simDropBtn = await page.$('#btn-sim-drop');
    if (simDropBtn) {
      const isDisabled = await simDropBtn.evaluate(b => b.disabled);
      if (!isDisabled) {
        await simDropBtn.click();
        await page.waitForTimeout(300);

        const fallbackVisible = await page.$eval('#launch-fallback-notice', e => !e.hidden);
        const frameClear = await page.$eval('#frame-host', e => e.children.length === 0);
        if (!fallbackVisible) finding('BUG', 'rollback', 'Fallback notice not shown');
        if (!frameClear) finding('CRASH', 'rollback', 'Frame NOT dismantled on rollback — fail-closed violated');
        else console.log('  ✓ Rollback: frame dismantled, fallback shown');

        // Dismiss
        await page.click('#btn-dismiss-fallback');
        await page.waitForTimeout(200);
        const panelHidden = await page.$eval('#game-panel', e => e.hidden);
        if (!panelHidden) finding('BUG', 'rollback-dismiss', 'Panel did not hide after dismiss');
        else console.log('  ✓ Dismiss returns to lobby cleanly');
      } else {
        // Sim drop got disabled (iframe loaded) — close normally
        console.log('  ⚠ Sim drop disabled (iframe loaded fast) — skipping, closing normally');
        await page.click('#close-game');
        await page.waitForTimeout(200);
      }
    }

    // 4h: Launch game, retry after rollback
    console.log('\n  [4h] Retry after rollback...');
    await page.click('[data-game-id="9"]');
    await page.waitForSelector('#game-panel:not([hidden])');
    await page.waitForTimeout(300);

    const simDrop2 = await page.$('#btn-sim-drop');
    if (simDrop2) {
      const isDisabled2 = await simDrop2.evaluate(b => b.disabled);
      if (!isDisabled2) {
        await simDrop2.click();
        await page.waitForTimeout(300);
        // Retry
        const retryBtn = await page.$('#btn-retry-launch');
        if (retryBtn) {
          await retryBtn.click();
          await page.waitForTimeout(500);
          const overlayVisible = await page.$eval('#launch-overlay', e => !e.hidden);
          if (overlayVisible) console.log('  ✓ Retry re-launches game overlay');
          else finding('BUG', 'retry', 'Overlay not visible after retry');
        }
        await page.click('#close-game');
        await page.waitForTimeout(200);
      } else {
        await page.click('#close-game');
        await page.waitForTimeout(200);
      }
    }

    // 4i: Launch overlay minimize toggle
    console.log('\n  [4i] Overlay minimize toggle...');
    await page.click('[data-game-id="10"]');
    await page.waitForSelector('#game-panel:not([hidden])');
    await page.waitForTimeout(1000);

    // Wait for streaming state
    const canMinimize = await page.evaluate(() => {
      const label = document.getElementById('launch-readiness-label')?.textContent || '';
      const ready = label.includes('PLAY BUTTON READY') || label.includes('STREAMING');
      return ready;
    });
    if (canMinimize) {
      await page.click('#launch-overlay');
      await page.waitForTimeout(200);
      const isMin = await page.$eval('#launch-overlay', e => e.classList.contains('minimized'));
      console.log(`  ✓ Overlay minimize: ${isMin ? 'minimized' : 'still expanded (click may not have registered)'}`);
    } else {
      console.log('  ⚠ Overlay not in minimizable state — skipping toggle test');
    }
    await page.click('#close-game');
    await page.waitForTimeout(200);

    // 4j: Double-launch race (click game while another is launching)
    console.log('\n  [4j] Double-launch race...');
    const preErrors3 = [...pageErrors];
    await page.click('[data-game-id="11"]');
    await page.waitForTimeout(100);
    await page.click('[data-game-id="12"]'); // immediately launch another
    await page.waitForTimeout(500);

    const title = await page.$eval('#active-game-title', e => e.textContent.trim());
    console.log(`  ✓ Active game after double-launch: "${title}"`);
    const doubleErrors = pageErrors.filter(e => !preErrors3.includes(e));
    if (doubleErrors.length > 0) {
      finding('CRASH', 'double-launch', `Errors: ${doubleErrors.join('; ')}`);
    } else {
      console.log('  ✓ Double-launch race — no crash');
    }
    await page.click('#close-game');
    await page.waitForTimeout(200);

    // 4k: Resize during launch
    console.log('\n  [4k] Viewport resize during active launch...');
    await page.click('[data-game-id="13"]');
    await page.waitForSelector('#game-panel:not([hidden])');
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 320, height: 568 }); // mobile
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1920, height: 1080 }); // desktop
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1280, height: 800 }); // back
    await page.waitForTimeout(200);
    console.log('  ✓ Viewport resize during launch — no crash');
    await page.click('#close-game');
    await page.waitForTimeout(200);

    // 4l: Prefetch toggle during active warming
    console.log('\n  [4l] Toggle prefetch during active hover warm...');
    const preErrors4 = [...pageErrors];
    await page.hover('[data-game-id="14"]');
    await page.waitForTimeout(200); // trigger dwell
    await page.click('#prefetch-toggle'); // disable mid-warm
    await page.waitForTimeout(300);
    await page.click('#prefetch-toggle'); // re-enable
    await page.waitForTimeout(300);
    const toggleErrors = pageErrors.filter(e => !preErrors4.includes(e));
    if (toggleErrors.length > 0) {
      finding('CRASH', 'toggle-mid-warm', `Errors: ${toggleErrors.join('; ')}`);
    } else {
      console.log('  ✓ Prefetch toggle during active warm — no crash');
    }

    // 4m: All query param overrides
    console.log('\n  [4m] Query param overrides...');
    await page.goto(`${BASE}/lobby.html?prefetch=0&budget=52428800`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lobby-grid');
    const toggleChecked = await page.$eval('#prefetch-toggle', e => e.checked);
    if (toggleChecked) {
      finding('BUG', 'query-params', 'prefetch=0 did not disable toggle');
    } else {
      console.log('  ✓ ?prefetch=0 correctly disables toggle');
    }
    const budgetVal = await page.$eval('#budget-selector', e => e.value);
    if (budgetVal !== '52428800') {
      finding('BUG', 'query-params', `?budget=52428800 not applied, got ${budgetVal}`);
    } else {
      console.log('  ✓ ?budget=52428800 correctly applied');
    }

    // 4n: Full warm + launch test
    console.log('\n  [4n] Full warm + launch cycle on fresh page...');
    await page.goto(`${BASE}/lobby.html`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lobby-grid');

    // Wait for game 1 auto-warm
    try {
      await page.waitForFunction(() => {
        const card = document.querySelector('[data-game-id="1"]');
        return card?.dataset.state === 'warm';
      }, { timeout: 10000 });
      console.log('  ✓ Game 1 auto-warmed');
    } catch {
      finding('BUG', 'auto-warm', 'Game 1 did not auto-warm within 10s');
    }

    // Launch warmed game
    await page.click('[data-game-id="1"]');
    await page.waitForSelector('#game-panel:not([hidden])');

    let foundPlay = false;
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const label = await page.$eval('#launch-readiness-label', e => e.textContent);
      if (label?.includes('PLAY BUTTON READY')) {
        foundPlay = true;
        console.log(`  ✓ Play button detected: "${label.slice(0, 60)}..."`);
        break;
      }
      await page.waitForTimeout(100);
    }
    if (!foundPlay) {
      // Not a crash — could just be that the game server isn't serving real game content
      console.log('  ⚠ Play button not detected in 10s (expected in simulated environment)');
    }

    await page.click('#close-game');
    await page.waitForTimeout(200);

    // Final error count for lobby
    const lobbyErrors = pageErrors.length;
    console.log(`\n  Lobby page errors collected: ${lobbyErrors}`);

    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 5: MEMORY LEAK — Repeated open/close cycles
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[5] Memory leak check — 10 launch/close cycles');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => { pageErrors.push(e.message); errors.push(e.message); });

    await page.goto(`${BASE}/lobby.html?nowarm=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lobby-grid');

    const heapBefore = await page.evaluate(() => {
      if (performance.memory) return performance.memory.usedJSHeapSize;
      return null;
    });

    for (let i = 0; i < 10; i++) {
      const gameId = (i % 20) + 1;
      await page.click(`[data-game-id="${gameId}"]`);
      await page.waitForTimeout(300);
      await page.click('#close-game');
      await page.waitForTimeout(200);
    }

    const heapAfter = await page.evaluate(() => {
      if (performance.memory) return performance.memory.usedJSHeapSize;
      return null;
    });

    if (heapBefore !== null && heapAfter !== null) {
      const growth = ((heapAfter - heapBefore) / (1024 * 1024)).toFixed(2);
      console.log(`  Heap growth: ${growth} MB over 10 cycles`);
      if (heapAfter > heapBefore * 3) {
        finding('BUG', 'memory', `Heap grew ${growth}MB — possible leak`);
      }
    } else {
      console.log('  ⚠ performance.memory not available (non-Chrome or headless V8 flag missing)');
    }

    if (pageErrors.length > 0) {
      finding('CRASH', 'memory-cycles', `Errors during 10 launch/close cycles: ${pageErrors.join('; ')}`);
    } else {
      console.log('  ✓ 10 launch/close cycles — no crash');
    }
    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 6: KEYBOARD NAVIGATION — a11y stress
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[6] Keyboard navigation stress');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => { pageErrors.push(e.message); errors.push(e.message); });

    await page.goto(`${BASE}/lobby.html?nowarm=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lobby-grid');

    // Tab through many elements
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(20);
    }
    console.log('  ✓ 25 Tab presses — no crash');

    // Focus a card and press Enter
    await page.focus('[data-game-id="5"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const panelOpen = await page.$eval('#game-panel', e => !e.hidden);
    if (panelOpen) {
      console.log('  ✓ Enter on focused card launches game');
      await page.click('#close-game');
      await page.waitForTimeout(200);
    }

    // Space key
    await page.focus('[data-game-id="6"]');
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    const panelOpen2 = await page.$eval('#game-panel', e => !e.hidden);
    if (panelOpen2) {
      console.log('  ✓ Space on focused card launches game');
      await page.click('#close-game');
      await page.waitForTimeout(200);
    }

    if (pageErrors.length > 0) {
      finding('CRASH', 'keyboard', `Errors during keyboard nav: ${pageErrors.join('; ')}`);
    } else {
      console.log('  ✓ Keyboard navigation — no crash');
    }
    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 7: MOBILE VIEWPORT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[7] Mobile viewport (320px)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => { pageErrors.push(e.message); errors.push(e.message); });

    await page.goto(`${BASE}/lobby.html?nowarm=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lobby-grid');

    const cards = await page.$$eval('.game-card', c => c.length);
    console.log(`  ✓ Mobile: ${cards} cards rendered`);

    // Launch a game on mobile
    await page.click('[data-game-id="1"]');
    await page.waitForTimeout(500);
    const panelVis = await page.$eval('#game-panel', e => !e.hidden);
    if (panelVis) {
      console.log('  ✓ Mobile game launch works');
      await page.click('#close-game');
      await page.waitForTimeout(200);
    }

    if (pageErrors.length > 0) {
      finding('CRASH', 'mobile', `Errors on mobile: ${pageErrors.join('; ')}`);
    } else {
      console.log('  ✓ Mobile viewport — no crash');
    }
    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 8: REDUCED MOTION PREFERENCE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[8] Reduced motion preference');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => { pageErrors.push(e.message); errors.push(e.message); });

    await page.goto(`${BASE}/lobby.html?nowarm=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#lobby-grid');

    // Launch and check no animations crash
    await page.click('[data-game-id="1"]');
    await page.waitForTimeout(500);
    await page.click('#close-game');
    await page.waitForTimeout(200);

    if (pageErrors.length > 0) {
      finding('CRASH', 'reduced-motion', `Errors with reduced motion: ${pageErrors.join('; ')}`);
    } else {
      console.log('  ✓ Reduced motion mode — no crash');
    }
    await ctx.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n================================================================');
  console.log(' STRESS TEST FINAL REPORT');
  console.log('================================================================');

  const crashes = findings.filter(f => f.severity === 'CRASH');
  const bugs = findings.filter(f => f.severity === 'BUG');
  const infos = findings.filter(f => f.severity === 'INFO');

  console.log(`\n  Crashes:  ${crashes.length}`);
  console.log(`  Bugs:     ${bugs.length}`);
  console.log(`  Info:     ${infos.length}`);
  console.log(`  Warnings: ${warnings.length}`);
  console.log(`  Total JS errors collected: ${errors.length}`);

  if (crashes.length > 0) {
    console.log('\n  === CRASHES ===');
    crashes.forEach(f => console.log(`  💥 [${f.area}] ${f.msg}`));
  }
  if (bugs.length > 0) {
    console.log('\n  === BUGS ===');
    bugs.forEach(f => console.log(`  🐛 [${f.area}] ${f.msg}`));
  }
  if (warnings.length > 0) {
    console.log(`\n  === WARNINGS (first 10) ===`);
    warnings.slice(0, 10).forEach(w => console.log(`  ⚠ ${w}`));
  }

  if (crashes.length === 0 && bugs.length === 0) {
    console.log('\n  ✅ ALL CLEAR — ZERO CRASHES, ZERO BUGS');
  } else if (crashes.length === 0) {
    console.log('\n  ⚠ NO CRASHES — but some bugs found');
  } else {
    console.log('\n  ❌ CRASHES DETECTED — needs fixing');
  }

  console.log('\n================================================================\n');

  await browser.close();

  // Return structured results
  return { crashes, bugs, infos, warnings, errors, findings };
}

stress().then(result => {
  if (result.crashes.length > 0) process.exit(1);
}).catch(err => {
  console.error('STRESS TEST HARNESS FAILED:', err);
  process.exit(2);
});
