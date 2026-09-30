// HistoryPanel.ts
// Owns: history HTML injection, tab switching, infinite scroll, fetch, resize observer.
// Does NOT import PanelModule or GameRulesPanel.

import { updateFooterIcons } from './GameRulesPanel';

let historyCommonContent: Record<string, string> = {};

export function getCommonText(key: string, fallback: string): string {

  return historyCommonContent[key] ?? fallback;
}

function getBetTypeText(type?: string): string {
  const key = (type || 'bet').trim().toLowerCase();

  const map: Record<string, string> = {
    bet: historyCommonContent.totalBetCaps,
    bb: historyCommonContent.bb,
    ante: historyCommonContent.anteText,
  };

  return (map[key] ?? key).toLocaleUpperCase();
}

// ─── Round ID copy-to-clipboard ─────────────────────────────────────────────
function roundIdCopyMarkup(roundId: string, variantClass: string): string {
  const value = roundId || '';
  const safe = value.replace(/"/g, '&quot;');

  return `<span class="round-id-copy ${variantClass}" data-round-id="${safe}" role="button" tabindex="0" aria-label="${getCommonText('copyRoundId', 'Copy round ID')}">
    <span class="round-id-copy-value">${value}</span>
    <img class="round-id-copy-icon" src="assets/history/footerIcons/copy-icon.png" alt="" />
  </span>`;
}

function fallbackCopyText(text: string, onDone: () => void): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    onDone();
  } catch (err) {
    console.error('[HistoryPanel] fallback copy failed:', err);
  }
}

function copyRoundId(text: string, targetEl: HTMLElement): void {
  if (!text) return;

  const onDone = () => {
    targetEl.classList.add('copied');
    window.setTimeout(() => targetEl.classList.remove('copied'), 1200);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onDone).catch(() => fallbackCopyText(text, onDone));
  } else {
    fallbackCopyText(text, onDone);
  }
}

export function setupRoundIdCopy(): void {
  const historyPanel = document.getElementById('historyPanel');
  if (!historyPanel) return;

  const prevClick = (historyPanel as any)._roundIdCopyClickHandler;
  if (prevClick) historyPanel.removeEventListener('click', prevClick);
  const prevKey = (historyPanel as any)._roundIdCopyKeyHandler;
  if (prevKey) historyPanel.removeEventListener('keydown', prevKey);

  const trigger = (e: Event, el: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (window as any).playHistoryRulesSound?.();
    } catch (err) {
      console.error('[HistoryPanel] round id copy sound error:', err);
    }
    copyRoundId(el.getAttribute('data-round-id') || '', el);
  };

  const clickHandler = (e: Event) => {
    const el = (e.target as HTMLElement).closest('.round-id-copy') as HTMLElement | null;
    if (el) trigger(e, el);
  };

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = (e.target as HTMLElement).closest('.round-id-copy') as HTMLElement | null;
    if (el) trigger(e, el);
  };

  (historyPanel as any)._roundIdCopyClickHandler = clickHandler;
  (historyPanel as any)._roundIdCopyKeyHandler = keyHandler;
  historyPanel.addEventListener('click', clickHandler, { passive: false });
  historyPanel.addEventListener('keydown', keyHandler);
}

// ─── Game Image Configuration ───────────────────────────────────────────────────
const normalizeGameName = (str: string) =>
  (str || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const GAME_IMAGES: Record<string, string> = {
  'Royale 81': 'assets/history/gameIcons/Royale_81.jpg',
  'Sweet Salon': 'assets/history/gameIcons/Seet_salon.jpg',
  'Empire of Gold': 'assets/history/gameIcons/empier_of_gold.jpg',
  'Empire of Gold: New Conquest': 'assets/history/gameIcons/EOG_NC.jpg',
  'Frosted Market Bonanza': 'assets/history/gameIcons/Frosted_market.jpg',
  'Book of Storms': 'assets/history/gameIcons/BookOfSTorm.jpg',
  'Book of Storms Lightning win': 'assets/history/gameIcons/BookOfSTorm_LW.jpg',
  'Meow Meow Meow': 'assets/history/gameIcons/meow_meow_meow.png',
};

const NORMALIZED_GAME_IMAGES = Object.fromEntries(
  Object.entries(GAME_IMAGES).map(([key, value]) => [
    normalizeGameName(key),
    value,
  ])
);

// ─── Orientation guard (shared across the module) ─────────────────────────────
let _isOrientationChanging = false;
let _orientationTimeout: number | null = null;

function setOrientationChanging(val: boolean) {
  _isOrientationChanging = val;
  if (_orientationTimeout) {
    clearTimeout(_orientationTimeout);
    _orientationTimeout = null;
  }
  if (val) {
    _orientationTimeout = window.setTimeout(() => {
      _isOrientationChanging = false;
      _orientationTimeout = null;
    }, 1000);
  }
}

window.addEventListener('orientationchange', () => setOrientationChanging(true));
window.addEventListener('resize', () => setOrientationChanging(true));

/** Exposed so SlotRulesLoader can query it. */
export function isOrientationChanging(): boolean {
  return _isOrientationChanging;
}

// ─── Public: scroll helper ────────────────────────────────────────────────────
export function scrollTableToTop(): void {
  try {
    window.scrollTo(0, 0);
    ['historyPanel', 'bettingOverlay', 'tableBody'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.scrollTop = 0;
    });
    ['.tab-content-section', '.table-container'].forEach((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) el.scrollTop = 0;
    });
  } catch (err) {
    console.error('[HistoryPanel] scrollTableToTop error:', err);
  }
}

// ─── Public: reset tab UI to first tab ───────────────────────────────────────
export function resetHistoryTab(): void {
  const historyPanel = document.getElementById('historyPanel');
  if (!historyPanel) return;
  const tabButtons = historyPanel.querySelectorAll('.tab-button');
  tabButtons.forEach((t) => t.classList.remove('active'));
  historyPanel.querySelector('.tab-button[data-tab="bh"]')?.classList.add('active');
  updateHistoryTabIcons(tabButtons);
}

// ─── Public: inject HTML and wire up the panel ───────────────────────────────
/**
 * Injects the pre-fetched history HTML into #historyPanel, populates dynamic
 * content, and wires up all event handlers.
 *
 * @param html           Raw HTML string from historyV2.html
 * @param cache          { commonRules, gameContent } from SlotRulesLoader's cache
 * @param hideRulesPanel Callback to hide #gameRulesPanel (supplied by loader)
 * @param isPreload      When true, skip fetch + scroll + icon update
 */
export function injectAndInitHistoryPanel(
  html: string,
  cache: { commonRules: Record<string, string> | null; gameContent: Record<string, any> | null },
  hideRulesPanel: () => void,
  isPreload: boolean = false,
): void {
  const historyDiv = document.getElementById('historyPanel');
  if (!historyDiv) {
    console.error('[HistoryPanel] #historyPanel element not found');
    return;
  }

  try {
    // Use faster innerHTML injection
    historyDiv.innerHTML = html;
  } catch (e: any) {
    console.error('[HistoryPanel] Failed to set innerHTML:', e?.message ?? e);
    return;
  }

  // Batch DOM operations
  const fragment = document.createDocumentFragment();

  // Populate game name
  const gameName = (window as any).getGameConfig?.()?.gameName;
  if (gameName) {
    historyDiv.querySelectorAll('[data-game="gameName"]').forEach((el) => {
      (el as HTMLElement).textContent = gameName;
    });
  }

  // Populate common content
  if (cache.commonRules) {
    historyCommonContent = cache.commonRules;
    historyDiv.querySelectorAll<HTMLElement>('[data-common]').forEach((el) => {
      const key = el.getAttribute('data-common')!;
      if (cache.commonRules![key] !== undefined) el.textContent = cache.commonRules![key];
    });
  }

  hideRulesPanel();

  // Use requestAnimationFrame for smooth UI updates
  requestAnimationFrame(() => {
    setupHistoryCloseButton();
    setupHistoryFooterButtons();
    setupHistoryTabs();
    setupRoundIdCopy();

    if (!(window as any).historyFetchInitialized) {
      initHistoryFetch();
    }

    if (!isPreload) {
      // Batch these operations for better performance
      requestAnimationFrame(() => {
        scrollTableToTop();
        updateFooterIcons('history');
        (window as any).fetchHistoryData?.('bh', 1, false);
      });
    }
  });
}

/**
 * High-level convenience used by SlotRulesLoader when the HTML is already
 * cached and it wants to show the history panel.
 */
export function createHistoryPanel(
  html: string,
  cache: { commonRules: Record<string, string> | null; gameContent: Record<string, any> | null },
  hideRulesPanel: () => void,
  isPreload: boolean = false,
): void {
  const historyDiv = document.getElementById('historyPanel');
  if (!historyDiv) return;

  historyDiv.style.cssText = 'display:flex;flex-direction:column;z-index:10001;overflow:hidden;opacity:0;transform:translateY(20px);transition:opacity 0.3s ease,transform 0.3s ease;';

  injectAndInitHistoryPanel(html, cache, hideRulesPanel, isPreload);

  // Add smooth entrance animation
  requestAnimationFrame(() => {
    historyDiv.style.opacity = '1';
    historyDiv.style.transform = 'translateY(0)';
    historyDiv.classList.add('panel-fade-in');
  });
}

// ─── Internal: event handlers ─────────────────────────────────────────────────
function setupHistoryCloseButton() {
  const closeBtn = document.getElementById('h-close_btn');
  if (!closeBtn) return;

  const prev = (closeBtn as any)._closeHandler;
  if (prev) closeBtn.removeEventListener('click', prev);
  const prevReset = (closeBtn as any)._resetGuard;
  if (prevReset) {
    closeBtn.removeEventListener('pointerup', prevReset);
    closeBtn.removeEventListener('pointercancel', prevReset);
  }

  let isClosing = false;

  const handler = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    if (isClosing || (window as any)._panelCleanupInProgress) return;
    isClosing = true;
    try {
      (window as any).playHistoryRulesSound?.();
      (window as any).gameRulesCloseBtnClicked?.();
    } catch (err) {
      console.error('[HistoryPanel] close error:', err);
    }
  };

  const resetGuard = () => { isClosing = false; };

  (closeBtn as any)._closeHandler = handler;
  (closeBtn as any)._resetGuard = resetGuard;
  closeBtn.addEventListener('click', handler, true);
  closeBtn.addEventListener('pointerup', resetGuard, { passive: true });
  closeBtn.addEventListener('pointercancel', resetGuard, { passive: true });
  closeBtn.style.pointerEvents = 'auto';
}

function updateHistoryTabIcons(tabButtons: NodeListOf<Element> | Element[]): void {
  tabButtons.forEach((btn) => {
    const img = btn.querySelector<HTMLImageElement>('.tab-icon');
    if (!img) return;

    const isActive = btn.classList.contains('active');
    const src = img.getAttribute('src') || '';
    if (isActive && src.includes('-inactive')) {
      img.setAttribute('src', src.replace('-inactive', '-active'));
    } else if (!isActive && src.includes('-active')) {
      img.setAttribute('src', src.replace('-active', '-inactive'));
    }
  });
}

export function setupHistoryTabs(): void {
  const historyPanel = document.getElementById('historyPanel');
  if (!historyPanel) return;

  const tabButtons = historyPanel.querySelectorAll('.tab-button');
  updateHistoryTabIcons(tabButtons);

  tabButtons.forEach((btn) => {
    const prev = (btn as any)._tabClickHandler;
    if (prev) btn.removeEventListener('click', prev);

    const handler = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if ((window as any)._panelCleanupInProgress) return;

      try {
        (window as any).playHistoryRulesSound?.();
        tabButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        updateHistoryTabIcons(tabButtons);
        const type = btn.getAttribute('data-tab') || 'bh';
        scrollTableToTop();
        (window as any).fetchHistoryData?.(type, 1, false);
      } catch (err) {
        console.error('[HistoryPanel] tab click error:', err);
      }
    };

    (btn as any)._tabClickHandler = handler;
    btn.addEventListener('click', handler, { passive: false });
  });
}

export function setupHistoryFooterButtons(): void {
  const historyPanel = document.getElementById('historyPanel');
  if (!historyPanel) return;

  historyPanel.querySelectorAll('.footer-item').forEach((item) => {
    const prev = (item as any)._footerClickHandler;
    if (prev) item.removeEventListener('click', prev);

    const handler = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if ((window as any)._panelCleanupInProgress) return;

      try {
        (window as any).playHistoryRulesSound?.();
        const section = item.getAttribute('data-section');
        if (section) (window as any).switchTab?.(section);
      } catch (err) {
        console.error('[HistoryPanel] footer click error:', err);
      }
    };

    (item as any)._footerClickHandler = handler;
    item.addEventListener('click', handler, { passive: false });
  });
}

// ─── Internal: fetch engine ───────────────────────────────────────────────────
/**
 * Initialises `window.fetchHistoryData` and the infinite-scroll machinery.
 * Idempotent — bails if `historyFetchInitialized` is already true.
 */
export function initHistoryFetch(): void {
  if ((window as any).historyFetchInitialized) return;
  (window as any).historyFetchInitialized = true;

  let currentPage = 1;
  let currentType = 'bh';
  let isLoading = false;
  let hasMore = true;
  let cachedByType: Record<string, any[]> = {};

  // Layout-shift timestamp — suppresses phantom IntersectionObserver triggers
  let lastLayoutShift = 0;
  const onLayoutShift = () => { lastLayoutShift = Date.now(); };
  window.addEventListener('orientationchange', onLayoutShift, { passive: true });
  window.addEventListener('resize', onLayoutShift, { passive: true });

  // ── ResizeObserver (scroll-to-top on reflow, no API calls) ────────────────
  let resizeObserver: ResizeObserver | null = null;

  function attachResizeObserver() {
    if (resizeObserver) return;
    const container = document.querySelector('.table-container');
    if (!container) return;
    resizeObserver = new ResizeObserver(() => {
      if ((window as any)._panelCleanupInProgress) return;  // ← add this guard

      lastLayoutShift = Date.now();
      scrollTableToTop();
    });
    resizeObserver.observe(container);
    (window as any).historyResizeObserver = resizeObserver;
  }

  function detachResizeObserver() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    (window as any).historyResizeObserver = null;
  }

  (window as any)._detachHistoryResizeObserver = detachResizeObserver;

  // ── HTTP fetch ────────────────────────────────────────────────────────────
  async function fetchHistory(type: string, pageNo: number): Promise<any> {
    const url = (window as any).getHistoryURL?.() || '';
    const token = (window as any).getToken?.() || '';
    const apiUrl = `${url}?type=${type}&pageSize=50&pageNo=${pageNo}&sortBy=endTime&sortDirection=-1`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // Reduced timeout

    try {
      const res = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  // ── Row builder ───────────────────────────────────────────────────────────
  function createRow(b: any, fmt: (amt: number) => string, token: string, extURL: string, lang: string): string {

    let finalURL = extURL;
    if (finalURL) {
      const separator = finalURL.indexOf('?') !== -1 ? '&' : '?';
      finalURL = `${finalURL}${separator}token=${encodeURIComponent(token)}&language=${encodeURIComponent(lang)}&roundId=${encodeURIComponent(b.roundId)}`;
    }

    const openApp = `window.open('${finalURL}', '_blank')`;
    const winStatus = b.winAmount > 0 ? 'win' : 'loss';
    const betTypeText = getBetTypeText(b.betType);

    const normalizedName = normalizeGameName(b.gameName);
    const imageSrc = NORMALIZED_GAME_IMAGES[normalizedName];

    const gameIcon = imageSrc
      ? `<div class="game-icon"><img src="${imageSrc}" alt="${b.gameName}" /></div>`
      : `<div class="game-icon"><span>${(b.gameName || '').slice(0, 2).toUpperCase()}</span></div>`;

    return `
      <div class="bet-row">
        <div class="game-column">
          ${gameIcon}
          <div class="game-details">
            <div class="game-name">${b.gameName || ''}</div>
            <div class="game-time">${new Date(b.endTime).toLocaleString()}</div>
          </div>
        </div>

        <div class="portrait-card">
          <div class="portrait-top-row">
            <div class="portrait-icon-col">${gameIcon}</div>
            <div class="portrait-top-right">
              <span class="portrait-win-text">${getCommonText('win_heading', 'Win')}:</span>
              <div class="portrait-win-amount win-amount ${b.winAmount > 0 ? 'positive' : 'zero'}">${fmt(b.winAmount)}</div>
              <button class="action-button" onclick="window.playHistoryRulesSound?.(); ${openApp}">›</button>
            </div>
          </div>

          <div class="portrait-details">
            <div class="game-name">${b.gameName || ''}</div>
            <div class="game-time">${new Date(b.endTime).toLocaleString()}</div>
            <div class="portrait-round-id">
              <span class="portrait-bet-text">${getCommonText('roundId', 'Round ID')}:</span>
              ${roundIdCopyMarkup(b.roundId, 'portrait-round-id-value')}
            </div>
              <span class="portrait-bet-text">${getCommonText('type', 'Type')}: ${betTypeText}</span>
              <span class="portrait-bet-text">${getCommonText('betAmount', 'Bet Amount')}: ${fmt(b.betAmount)}</span>
          </div>
        </div>



        <div class="bet-type block-desktop-only"><span class="type-badge">${betTypeText}</span></div>
        <div class="amount-column bet-amount block-desktop-only">${fmt(b.betAmount)}</div>
        <div class="amount-column win-amount ${b.winAmount > 0 ? 'positive' : 'zero'} block-desktop-only">${fmt(b.winAmount)}</div>
        <div class="round-id block-desktop-only">${roundIdCopyMarkup(b.roundId, '')}</div>

        <div class="actions-column">
          <button class="action-button" onclick="window.playHistoryRulesSound?.(); ${openApp}">›</button>
        </div>
      </div>`;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function appendRows(data: any[], append: boolean, type: string) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    if (!data?.length) {
      if (!append)
        tbody.innerHTML = `<div style="text-align:center;padding:60px;color:#ffd700;">${getCommonText('noHistoryFound', 'No History Found')}</div>`;
      hasMore = false;
      return;
    }

    if (!cachedByType[type]) cachedByType[type] = [];
    cachedByType[type] = append ? [...cachedByType[type], ...data] : [...data];

    const formatters: Record<string, (amt: number) => string> = {};
    const lang = (window as any).getGameLang?.() || 'en';

    const getFmt = (currencyCode: string) => {
      const currency = currencyCode || 'EUR';
      if (!formatters[currency]) {
        if (typeof Intl !== 'undefined') {
          const formatter = new Intl.NumberFormat(lang, {
            style: 'currency',
            currencyDisplay: 'symbol',
            currency: currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
            useGrouping: true,
            roundingMode: 'trunc',
          } as any);
          formatters[currency] = (amt: number) => formatter.format(amt || 0);
        } else {
          formatters[currency] = (amt: number) => `${currency}${amt || 0}`;
        }
      }
      return formatters[currency];
    };

    // Use DocumentFragment for better performance with batched DOM updates
    const fragment = document.createDocumentFragment();
    const tempDiv = document.createElement('div');

    // Batch create all rows at once
    const token = (window as any).getToken?.() || '';
    const extURL = (window as any).getExternalHistoryURL?.() || '';

    const rowsHTML = data.map(b => createRow(b, getFmt(b.currencyCode), token, extURL, lang)).join('');
    tempDiv.innerHTML = rowsHTML;

    // Move all nodes to fragment in one operation
    while (tempDiv.firstChild) {
      fragment.appendChild(tempDiv.firstChild);
    }

    // Single DOM update
    requestAnimationFrame(() => {
      if (append) {
        tbody.appendChild(fragment);
      } else {
        tbody.innerHTML = '';
        tbody.appendChild(fragment);
      }
    });

    hasMore = data.length >= 50;
  }

  // ── Infinite scroll ───────────────────────────────────────────────────────
  function setupInfiniteScroll() {
    const existing = (window as any).historyObserver as IntersectionObserver | undefined;
    if (existing) { existing.disconnect(); (window as any).historyObserver = null; }

    const container = document.querySelector('.table-container');
    if (!container) return;

    document.getElementById('scroll-sentinel')?.remove();

    const observer = new IntersectionObserver(
      (entries) => {
        if ((window as any)._panelCleanupInProgress) return;
        if (Date.now() - lastLayoutShift < 500) return;
        if (entries[0].isIntersecting && !isLoading && hasMore) loadMore();
      },
      { threshold: 0.1 },
    );
    (window as any).historyObserver = observer;

    const sentinel = document.createElement('div');
    sentinel.id = 'scroll-sentinel';
    sentinel.style.height = '1px';
    container.appendChild(sentinel);
    observer.observe(sentinel);

    attachResizeObserver();
  }

  async function loadMore() {
    if (isLoading || !hasMore || (window as any)._panelCleanupInProgress) return;
    if (Date.now() - lastLayoutShift < 500) return;

    const requestType = currentType;
    isLoading = true;
    currentPage++;

    try {
      const res = await fetchHistory(requestType, currentPage);
      if (res?.data && !(window as any)._panelCleanupInProgress && requestType === currentType) {
        appendRows(res.data, true, requestType);
      }
    } catch (err) {
      if (requestType === currentType) {
        console.error('[HistoryPanel] loadMore error:', err);
        currentPage--;
      }
    } finally {
      isLoading = false;
    }
  }

  // ── Public API exposed on window ──────────────────────────────────────────
  (window as any).fetchHistoryData = async (
    type: string = 'bh',
    pageNo: number = 1,
    useCache: boolean = true,
  ) => {
    if ((window as any)._panelCleanupInProgress) return;

    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    // Same tab already loading → just pin scroll
    if (isLoading && type === currentType) { scrollTableToTop(); return; }

    // Disconnect observer while rebuilding
    const obs = (window as any).historyObserver as IntersectionObserver | undefined;
    if (obs) { obs.disconnect(); (window as any).historyObserver = null; }

    currentType = type;

    // Force cache during any layout reflow
    if (_isOrientationChanging || Date.now() - lastLayoutShift < 500) useCache = true;

    const typeCache = cachedByType[type] || [];

    if (useCache && typeCache.length > 0) {
      tbody.innerHTML = '';
      appendRows([...typeCache], false, type);
      scrollTableToTop();
      setupInfiniteScroll();
      return;
    }

    if (_isOrientationChanging) return;

    // Full fetch
    currentPage = 1;
    hasMore = true;
    isLoading = true;
    cachedByType[type] = [];

    tbody.innerHTML = `<div style="text-align:center;padding:40px;color:#ffd700;">${getCommonText('loading', 'Loading...')}</div>`;
    scrollTableToTop();

    try {
      const res = await fetchHistory(type, 1);
      if ((window as any)._panelCleanupInProgress || type !== currentType) return;
      if (!res?.data) throw new Error('No data');

      appendRows(res.data, false, type);
      scrollTableToTop();
      setupInfiniteScroll();
    } catch (err) {
      if ((window as any)._panelCleanupInProgress || type !== currentType) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort')) return;
      console.error('[HistoryPanel] fetchHistoryData error for type', type, ':', err);
      tbody.innerHTML = `<div style="text-align:center;padding:40px;color:red;">${getCommonText('errorLoading', 'Error Loading History')}</div>`;
    } finally {
      isLoading = false;
    }
  };

  // No-op kept for backwards compatibility with any external callers
  (window as any).preloadHistoryTabs = () => { };
}
