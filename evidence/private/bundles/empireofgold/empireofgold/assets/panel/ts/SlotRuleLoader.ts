// SlotRulesLoader.ts
// Replaces PanelModule. Owns: cache, panel orchestration, tab switching, cleanup.
// Imports helpers from GameRulesPanel and HistoryPanel — no PanelModule.

import {
  initGameRulesPanel,
  updatePaytable,
  updateHeaderTitle,
  updateFooterIcons,
} from './GameRulesPanel';

import {
  injectAndInitHistoryPanel,
  resetHistoryTab,
  scrollTableToTop,
  getCommonText,
} from './HistoryPanel';

// ─── Module-level state ───────────────────────────────────────────────────────
let panelLoaded = false;
let panelReady = false;
let currentTab = 'rules';
let pendingTab: string | null = null;

const cache = {
  commonRules: null as Record<string, string> | null,
  rulesHtml: null as string | null,
  rulesHtmlPromise: null as Promise<string | null> | null,
  rulesImagePreloadPromise: null as Promise<void> | null,
  gameContent: null as Record<string, any> | null,
  historyHtml: null as string | null,
  historyHtmlPromise: null as Promise<string | null> | null,
  historyPreloaded: false,
  preloadPromise: null as Promise<void> | null,
};

function getLoadingMarkup(label = 'Loading...'): string {
  return `<div style="display:flex;justify-content:center;align-items:center;height:100%;width:100%;background:rgba(0,0,0,0.95);color:#ffd700;font-size:18px;font-family:sans-serif;">${label}</div>`;
}

function fetchRulesHtml(): Promise<string | null> {
  if (cache.rulesHtml) return Promise.resolve(cache.rulesHtml);
  if (cache.rulesHtmlPromise) return cache.rulesHtmlPromise;

  const rulesPath = (window as any).getGameRulesPath?.();
  if (!rulesPath) return Promise.resolve(null);

  cache.rulesHtmlPromise = fetch(rulesPath)
    .then(r => r.text())
    .then((html) => {
      cache.rulesHtml = html;
      (window as any)._cachedRulesHtml = html;
      return html;
    })
    .catch(() => null)
    .finally(() => {
      cache.rulesHtmlPromise = null;
    });

  return cache.rulesHtmlPromise;
}

function fetchHistoryHtml(): Promise<string | null> {
  if (cache.historyHtml) return Promise.resolve(cache.historyHtml);
  if (cache.historyHtmlPromise) return cache.historyHtmlPromise;

  const historyPath = (window as any).getCommonHistoryPath?.();
  if (!historyPath) return Promise.resolve(null);

  cache.historyHtmlPromise = fetch(historyPath)
    .then(r => r.text())
    .then((html) => {
      cache.historyHtml = html;
      (window as any)._cachedHistoryHtml = html;
      return html;
    })
    .catch(() => null)
    .finally(() => {
      cache.historyHtmlPromise = null;
    });

  return cache.historyHtmlPromise;
}

function preloadRulesImages(html: string): Promise<void> {
  if (cache.rulesImagePreloadPromise) return cache.rulesImagePreloadPromise;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sources = Array.from(new Set(
    Array.from(doc.images)
      .map((img) => img.getAttribute('src'))
      .filter((src): src is string => !!src && !src.startsWith('data:')),
  ));

  cache.rulesImagePreloadPromise = Promise.all(sources.map((src) => new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      img.decode?.().then(() => resolve()).catch(() => resolve()) || resolve();
    };
    img.onerror = () => resolve();
    img.src = src;
  }))).then(() => { });

  return cache.rulesImagePreloadPromise;
}

function getRulesData(): Promise<{
  gameContent: Record<string, any>;
  commonRules: Record<string, string>;
}> {
  if (!cache.gameContent) {
    cache.gameContent = (window as any).getCachedGameContent?.() || null;
  }
  if (!cache.commonRules) {
    cache.commonRules = (window as any).getCachedCommonContent?.() || null;
  }

  const lang = (window as any).getGameLang?.() || 'en';
  const commonPath = (window as any).getCommonRulePath?.();

  return Promise.all([
    cache.gameContent
      ? Promise.resolve(cache.gameContent)
      : fetch(`assets/locale/${lang}/gameContent.json`).then(r => r.json()).catch(() => ({})),
    cache.commonRules
      ? Promise.resolve(cache.commonRules)
      : commonPath
        ? fetch(`${commonPath}commonContent.json`).then(r => r.json()).catch(() => ({}))
        : Promise.resolve({}),
  ]).then(([gameContent, commonRules]) => {
    cache.gameContent = cache.gameContent || gameContent;
    cache.commonRules = cache.commonRules || commonRules;

    return {
      gameContent: cache.gameContent || {},
      commonRules: cache.commonRules || {},
    };
  });
}

// ─── Preload (idle-scheduled) ─────────────────────────────────────────────────
export function preloadRulesPanel(): Promise<void> {
  if (cache.preloadPromise) return cache.preloadPromise;

  cache.preloadPromise = scheduleIdle(async () => {
    const promises: Promise<any>[] = [];

    // Get from cached content (already loaded in PRELOADER bundle)
    if (!cache.commonRules) {
      cache.commonRules = (window as any).getCachedCommonContent?.() || null;
    }
    if (!cache.gameContent) {
      cache.gameContent = (window as any).getCachedGameContent?.() || null;
    }

    promises.push(getRulesData().then(() => { }).catch(() => { }));
    promises.push(fetchRulesHtml().then((html) => (html ? preloadRulesImages(html) : undefined)));
    promises.push(fetchHistoryHtml());

    await Promise.all(promises);
  });

  return cache.preloadPromise;
}

function scheduleIdle(fn: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const run = () => fn().then(resolve).catch(resolve);
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(run, { timeout: 300 });
    } else {
      setTimeout(run, 100);
    }
  });
}

// ─── Entry points (called from game buttons) ──────────────────────────────────
export function loadGameRulesPanel(): void {
  if (panelReady && document.getElementById('gameRulesPanel')) {
    currentTab !== 'rules' ? switchTab('rules') : scrollAllPanelsToTop();
  } else if (!panelLoaded) {
    createPanel('rules');
  }
}

export function loadHistoryPanelFirst(): void {
  if (panelReady && document.getElementById('gameRulesPanel')) {
    currentTab !== 'history' ? switchTab('history') : scrollAllPanelsToTop();
  } else if (!panelLoaded) {
    createPanel('history');
  }
}

// ─── Panel creation ───────────────────────────────────────────────────────────
function createPanel(initialTab: string): void {
  const panelDiv = document.getElementById('gameRulesPanel');
  if (!panelDiv) return;

  panelLoaded = true;
  currentTab = initialTab;
  (globalThis as any)._isPanelOpen = true;
  (window as any).stopPixiApp?.();

  panelDiv.innerHTML =
    '<div style="display:flex;justify-content:center;align-items:center;width:100%;height:100%;background:rgba(0,0,0,0.8);"><img src="assets/images/loader.webp" alt="Loading" style="width:30px;height:40px;object-fit:contain;" /></div>';
  panelDiv.style.cssText = 'display: flex; flex-direction: column; z-index: 10000; overflow: hidden;';

  setupWindowFunctions();

  if (initialTab === 'history') {
    // Show history immediately; fetch/preload rules in the background
    showHistoryDirect(panelDiv);
    preloadHistoryPanel();
  } else {
    // Show rules; preload history html in background
    prefetchHistoryHtml();
    loadRulesContent(panelDiv, initialTab);
  }
}

// ─── Rules panel loading ──────────────────────────────────────────────────────
function loadRulesContent(panelDiv: HTMLElement, initialTab: string) {
  const injectHtml = (
    html: string,
    gameData: Record<string, any>,
    commonData: Record<string, string>,
  ) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    Array.from(doc.images).forEach((img) => {
      img.decoding = 'async';
      img.loading = 'eager';
    });
    const overlay = doc.querySelector('.betting-overlay');
    if (overlay) {
      panelDiv.innerHTML = '';
      panelDiv.appendChild(overlay);
    }


    setupFooterButtons();

    initGameRulesPanel(gameData, commonData);
    panelReady = true;

    applyMappings([
      { id: 'game-version', fn: (window as any).getGameVersion },
      { id: 'rtp-value', fn: (window as any).getRtpValue },
      { id: 'min-bet', fn: (window as any).getMinBet },
      { id: 'max-bet', fn: (window as any).getMaxBet },
      { 
        id: 'bb-max-bet', 
        fn: (window as any).getBBMaxBet,
        condition: () => {
          const bbMaxBet = (window as any).getGameInitData?.()?.playerInfo?.bbMaxBet;
          return bbMaxBet !== undefined && bbMaxBet !== null && bbMaxBet > 0;
        }
      },
      { id: 'max-win', fn: (window as any).getMaxPayout },
    ]);
    getbbRTP();

    const targetTab = pendingTab || initialTab || 'rules';
    pendingTab = null;

    if (targetTab === 'history') {
      switchTab('history');
    } else {
      showPanel('gameRulesPanel');
      hidePanel('historyPanel');
      toggleElement('lower_container', targetTab === 'rules');
      toggleElement('pay_table', targetTab === 'paytable');
      updateFooterIcons(targetTab);
      updateHeaderTitle(targetTab, cache.commonRules);
      if (targetTab === 'paytable') updatePaytable();
      scrollAllPanelsToTop();
      preloadHistoryPanel();
    }
  };

  const htmlPromise = fetchRulesHtml().then((html) => {
    if (!html) throw new Error('[SlotRulesLoader] getGameRulesPath not defined');
    return html;
  });

  Promise.all([htmlPromise, getRulesData()])
    .then(([html, data]) => {
      preloadRulesImages(html);
      injectHtml(html, data.gameContent, data.commonRules);
    })
    .catch(err => {
      console.error('[SlotRulesLoader] Error loading rules panel:', err);
      panelLoaded = false;
    });
}

// ─── History panel loading ────────────────────────────────────────────────────
/** Fetch and cache the history HTML (fire-and-forget). */
function prefetchHistoryHtml(): Promise<void> {
  return fetchHistoryHtml().then(() => { });
}

/** Called when history is the FIRST tab shown (no rules panel yet). */
function showHistoryDirect(panelDiv: HTMLElement) {
  panelReady = true;
  const historyDiv = document.getElementById('historyPanel');
  if (!historyDiv) { console.error('[SlotRulesLoader] #historyPanel not found'); return; }

  historyDiv.style.cssText = 'display:flex;flex-direction:column;z-index:10001;overflow:hidden;';
  if (!historyDiv.innerHTML) {
    historyDiv.innerHTML = getLoadingMarkup();
  }

  const doInject = () => {
    if (!cache.historyHtml) { console.error('[SlotRulesLoader] History HTML still not loaded'); return; }
    injectAndInitHistoryPanel(
      cache.historyHtml,
      { commonRules: cache.commonRules, gameContent: cache.gameContent },
      () => { },           // no rules panel to hide yet
      false,
    );
  };

  // Ensure both the HTML and commonRules are ready before injecting —
  // commonRules populates footer text; if null, [data-common] elements are skipped.
  const htmlReady = cache.historyHtml ? Promise.resolve() : prefetchHistoryHtml();
  const commonReady = cache.commonRules ? Promise.resolve() : fetchCommonRules();

  Promise.all([htmlReady, commonReady]).then(doInject);
}

function applyMappings(mappings: { id: string; fn?: () => string; condition?: () => boolean }[]) {
  mappings.forEach(({ id, fn, condition }) => {
    const el = document.getElementById(id);
    if (!el) return;

    if (condition) {
      if (!condition()) {
        el.style.display = 'none';
        return;
      } else {
        el.style.display = ''; // reset to default
      }
    }

    const value = fn?.() ?? '';
    el.textContent = el.textContent?.replaceAll('{{text1}}', value) || '';
  });
}

function getbbRTP() {
  const bbRtpData = (window as any).getBBRtp?.();
  if (bbRtpData && cache.commonRules?.bbRTP) {
    const dataLength = Array.isArray(bbRtpData) ? bbRtpData.length : Object.keys(bbRtpData).length;

    for (let i = 1; i <= dataLength; i++) {
      const bbRtpEl = document.getElementById(`bb-rtp-${i}`);
      if (bbRtpEl) {
        const item = Array.isArray(bbRtpData) ? bbRtpData[i - 1] : bbRtpData;
        bbRtpEl.textContent = cache.commonRules.bbRTP
          .replace('{{text1}}', item.name || '')
          .replace('{{text2}}', item.rtp);
        bbRtpEl.style.display = 'list-item';
      }
    }
  }
}

/** Fetch and cache commonContent.json if not already loaded. */
function fetchCommonRules(): Promise<void> {
  // Get from cached content first
  if (!cache.commonRules) {
    cache.commonRules = (window as any).getCachedCommonContent?.() || null;
  }
  if (cache.commonRules) return Promise.resolve();

  const commonPath = (window as any).getCommonRulePath?.();
  if (!commonPath) return Promise.resolve();
  return fetch(`${commonPath}commonContent.json`)
    .then(r => r.json())
    .then(d => { cache.commonRules = cache.commonRules || d; })
    .catch(() => { });
}

/** Show history panel when rules panel is already present (tab switch). */
function loadHistoryPanel() {
  const historyPanel = document.getElementById('historyPanel');
  if (!historyPanel) return;

  if (!historyPanel.innerHTML) {
    if (cache.historyHtml) {
      injectAndInitHistoryPanel(
        cache.historyHtml,
        { commonRules: cache.commonRules, gameContent: cache.gameContent },
        () => hidePanel('gameRulesPanel'),
        false,
      );
    } else {
      prefetchHistoryHtml().then(() => {
        if (!cache.historyHtml) return;
        injectAndInitHistoryPanel(
          cache.historyHtml,
          { commonRules: cache.commonRules, gameContent: cache.gameContent },
          () => hidePanel('gameRulesPanel'),
          false,
        );
      });
    }
  } else {
    hidePanel('gameRulesPanel');
    showPanel('historyPanel');
    resetHistoryTab();
    scrollAllPanelsToTop();
    updateFooterIcons('history');
    (window as any).fetchHistoryData?.('bh', 1, true);
  }
}

/** Idle-preload history HTML after rules panel is ready. */
function preloadHistoryPanel() {
  if (cache.historyPreloaded) return;
  cache.historyPreloaded = true;

  const doPreload = () => {
    const historyPanel = document.getElementById('historyPanel');
    if (historyPanel && !historyPanel.innerHTML && cache.historyHtml) {
      injectAndInitHistoryPanel(
        cache.historyHtml,
        { commonRules: cache.commonRules, gameContent: cache.gameContent },
        () => { },
        true,             // isPreload — no fetch, no scroll, no icon update
      );
      hidePanel('historyPanel');
    }
  };

  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(
      () => prefetchHistoryHtml().then(doPreload),
      { timeout: 200 },
    );
  } else {
    setTimeout(() => prefetchHistoryHtml().then(doPreload), 200);
  }
}

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(section: string) {
  if ((window as any)._panelCleanupInProgress) return;

  if (section === currentTab) { scrollAllPanelsToTop(); return; }
  currentTab = section;

  (window as any).postActivityEvent?.('ingame_casino_info_screen', { value: section });

  updateFooterIcons(section);
  updateHeaderTitle(section, cache.commonRules);

  if (section === 'history') {
    loadHistoryPanel();
    return;
  }

  // Rules / paytable — ensure the rules panel has been populated.
  // This handles the history-first flow where loadRulesContent was never called.
  const panelDiv = document.getElementById('gameRulesPanel');
  const hasRulesContent = panelDiv && panelDiv.querySelector('.betting-overlay');

  if (!hasRulesContent && panelDiv) {
    // Load rules HTML into the panel, then reveal the right section.
    // Store the target section so afterContent can pick it up via pendingTab.
    pendingTab = section;
    loadRulesContent(panelDiv, section);
    // hidePanel('historyPanel');
    // DON'T hide history panel yet - wait until rules content is loaded
    return;
  }

  showPanel('gameRulesPanel');
  hidePanel('historyPanel');
  toggleElement('lower_container', section === 'rules');
  toggleElement('pay_table', section === 'paytable');

  if (section === 'paytable') updatePaytable();
  scrollAllPanelsToTop();
}

// ─── Footer button wiring (rules panel) ───────────────────────────────────────
function setupFooterButtons() {
  document.querySelectorAll('.footer-item').forEach((item) => {
    const prev = (item as any)._footerClickHandler;
    if (prev) item.removeEventListener('click', prev);

    const handler = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if ((window as any)._panelCleanupInProgress) return;

      const section = (item as HTMLElement).getAttribute('data-section');
      if (section) {
        (window as any).playHistoryRulesSound?.();
        if (!panelReady) pendingTab = section;
        switchTab(section);
      }
    };

    (item as any)._footerClickHandler = handler;
    item.addEventListener('click', handler, { passive: false });
  });
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────
function showPanel(id: string) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'flex'; el.style.overflow = 'hidden'; }
}

function hidePanel(id: string) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function toggleElement(id: string, show: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = show ? 'block' : 'none';
  if (show) {
    el.scrollTop = 0;
    requestAnimationFrame(() => { el.scrollTop = 0; });
  }
}

function scrollAllPanelsToTop() {
  window.scrollTo(0, 0);
  ['gameRulesPanel', 'lower', 'historyPanel', 'lower_container', 'pay_table'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.scrollTop = 0;
  });
  const overlay = document.querySelector('.betting-overlay') as HTMLElement | null;
  if (overlay) overlay.scrollTop = 0;
  scrollTableToTop();
}

// ─── Window API surface ───────────────────────────────────────────────────────
function setupWindowFunctions() {
  (window as any).getFormattedAmount = (amt: number) => `₹${amt.toLocaleString('en-IN')}`;
  (window as any).gameRulesCloseBtnClicked = () => {
    cleanupPanels();
    (window as any).setExternalPageClosed?.();
  };
  (window as any).loadHistoryPanel = loadHistoryPanel;
  (window as any).loadGameRulesPanel = () => switchTab('rules');
  (window as any).updateFooterIcons = updateFooterIcons;
  (window as any).switchTab = switchTab;
  (window as any).loadHistoryPanelFirst = loadHistoryPanelFirst;
  (window as any).scrollAllPanelsToTop = scrollAllPanelsToTop;

  if (!(window as any)._panelErrorHandlerAdded) {
    (window as any)._panelErrorHandlerAdded = true;
    window.addEventListener('error', (event) => {
      if (event.message?.toLowerCase().includes('panel') || event.message?.toLowerCase().includes('history')) {
        console.error('[SlotRulesLoader] Global error:', event.message);
        event.preventDefault();
      }
    });
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
function cleanupPanels() {
  (globalThis as any)._isPanelOpen = false;
  (window as any)._panelCleanupInProgress = true;  // ← must stay first
  pendingTab = null;

  // 1. Detach ResizeObserver BEFORE touching innerHTML
  (window as any)._detachHistoryResizeObserver?.();

  // 2. Disconnect IntersectionObserver
  if ((window as any).historyObserver) {
    try { (window as any).historyObserver.disconnect(); } catch (_) { }
    (window as any).historyObserver = null;
  }
  document.getElementById('scroll-sentinel')?.remove();

  // 3. Remove all event listeners
  const closeBtn = document.getElementById('close_btn');
  if (closeBtn) {
    const h = (closeBtn as any)._closeHandler;
    if (h) { closeBtn.removeEventListener('click', h, true); delete (closeBtn as any)._closeHandler; }
  }
  const hCloseBtn = document.getElementById('h-close_btn');
  if (hCloseBtn) {
    const h = (hCloseBtn as any)._closeHandler;
    if (h) { hCloseBtn.removeEventListener('click', h, true); delete (hCloseBtn as any)._closeHandler; }
  }

  [document.getElementById('gameRulesPanel'), document.getElementById('historyPanel')]
    .forEach((panel) => {
      if (!panel) return;
      panel.querySelectorAll('.footer-item').forEach((item) => {
        const h = (item as any)._footerClickHandler;
        if (h) { item.removeEventListener('click', h); delete (item as any)._footerClickHandler; }
      });
    });

  const hp = document.getElementById('historyPanel');
  if (hp) {
    hp.querySelectorAll('.tab-button').forEach((btn) => {
      const h = (btn as any)._tabClickHandler;
      if (h) { btn.removeEventListener('click', h); delete (btn as any)._tabClickHandler; }
    });
  }

  // 4. Tear down DOM
  const gp = document.getElementById('gameRulesPanel');
  if (gp) { gp.style.display = 'none'; gp.innerHTML = ''; }
  if (hp) { hp.style.display = 'none'; hp.innerHTML = ''; }

  (window as any).historyFetchInitialized = false;
  (window as any).fetchHistoryData = null;
  panelReady = false;
  panelLoaded = false;
  cache.historyPreloaded = false;

  // 5. Start Pixi AFTER DOM is clean, clear cleanup flag first
  (window as any)._panelCleanupInProgress = false;
  (window as any).startPixiApp?.();   // ← moved here, after teardown


  window.dispatchEvent(new Event('resize'));
}
