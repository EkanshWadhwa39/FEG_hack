// GameRulesPanel.ts
// Owns: rules content rendering, close button, paytable, header title, footer icons.
// Called by SlotRulesLoader — does NOT import PanelModule.

// ─── Types ────────────────────────────────────────────────────────────────────
export interface PanelCache {
  commonRules: Record<string, string> | null;
  gameContent: Record<string, any> | null;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initGameRulesPanel(
  gameContent: Record<string, any>,
  commonContent: Record<string, string>,
): void {
  setupCloseButton('close_btn');
  hideElement('loading-rules');
  populateGameName();
  (window as any).getContent = (key: string): string =>
    gameContent?.[key] ?? commonContent?.[key] ?? '';
  renderElements('data-game', gameContent || {});
  renderElements('data-common', commonContent || {});
  fitAnteImageText();
}

// ─── Render helpers ───────────────────────────────────────────────────────────
function renderElements(attr: string, data: Record<string, string>) {
  document.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => {
    const key = el.getAttribute(attr)!;
    if (data[key] !== undefined) el.textContent = data[key];
  });
}

function fitAnteImageText() {
  const overflow = (el: HTMLElement) =>
    el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;

  const fitText = (
    selector: string,
    max: number,
    min: number,
    same = false
  ) => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(selector));

    const apply = (size: number) =>
      els.forEach((el) => (el.style.fontSize = `${size}px`));

    els.forEach((el) => {
      el.style.overflowWrap = 'normal';
      el.style.wordBreak = 'normal';
      if (same) el.style.whiteSpace = 'nowrap';
    });

    if (same) {
      let size = max;
      apply(size);

      while (size > min && els.some(overflow)) apply(--size);

      if (els.some(overflow)) {
        els.forEach((el) => {
          el.style.whiteSpace = 'normal';
          el.style.wordBreak = 'break-word';
        });

        while (
          size > min &&
          els.some((el) => el.scrollHeight > el.clientHeight)
        ) {
          apply(--size);
        }
      }
    } else {
      els.forEach((el) => {
        let size = max;
        el.style.fontSize = `${size}px`;

        while (size > min && overflow(el)) {
          el.style.fontSize = `${--size}px`;
        }

        if (overflow(el)) {
          el.style.overflowWrap = 'anywhere';
          el.style.wordBreak = 'break-word';
        }
      });
    }
  };

  const fit = () => {
    fitText('.ante-img-box .text', 20, 14);
    fitText('.ante-img-box .on-text, .ante-img-box .off-text', 11, 8, true);
  };

  requestAnimationFrame(fit);
  document.fonts?.ready?.then(fit);
}

function populateGameName() {
  const gameName = (window as any).getGameConfig?.()?.gameName;
  if (!gameName) return;
  document.querySelectorAll('[data-game="gameName"]').forEach((el) => {
    (el as HTMLElement).textContent = gameName;
  });
}

function hideElement(id: string) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ─── Paytable ─────────────────────────────────────────────────────────────────
function renderRows(
  container: Element,
  symbolData: number[],
  multiplier: number,
  sort: 'asc' | 'desc'
) {
  // Ensure multiplier is valid
  multiplier = Number(multiplier) || 1;

  // 🔹 Step 1: Group consecutive same values
  const groupedEntries: { value: number; start: number; end: number }[] = [];
  let currentGroup: { value: number; start: number; end: number } | null = null;

  symbolData.forEach((val, i) => {
    const value = Number(val);

    if (value <= 0) return;

    if (
      currentGroup &&
      currentGroup.value === value &&
      currentGroup.end === i - 1
    ) {
      currentGroup.end = i;
    } else {
      if (currentGroup) groupedEntries.push(currentGroup);

      currentGroup = {
        value,
        start: i,
        end: i,
      };
    }
  });

  if (currentGroup) groupedEntries.push(currentGroup);

  // 🔹 Step 2: Sort
  const validEntries =
    sort === 'asc' ? groupedEntries : groupedEntries.reverse();

  // 🔹 Step 3: Render
  const detailsContainer = container.querySelector('.item-details') || container;
  const existingRows = Array.from(detailsContainer.querySelectorAll('.level-row'));
  
  if (existingRows.length === 0) return;

  validEntries.forEach((entry, rowIndex) => {
    let row = existingRows[rowIndex] as HTMLElement;

    if (!row) {
      row = existingRows[0].cloneNode(true) as HTMLElement;
      detailsContainer.appendChild(row);
      existingRows.push(row);
    }

    const spans = row.querySelectorAll('span');
    const pointsEl = row.querySelector('.points-amount');

    const { value, start, end } = entry;

    // 🔹 Update index display (x3 / x4 → now range)
    if (spans[0]) {
      spans[0].textContent =
        start === end
          ? `${start + 1}`
          : `${start + 1}-${end + 1}`;
    }

    // 🔹 Safe currency formatting (NO NaN)
    if (pointsEl) {
      const amount = value * multiplier;

      pointsEl.textContent =
        (window as any).formatCurrency?.(amount) ??
        amount.toString();
    }

    row.style.display = '';
  });

  // Hide any extra rows that we didn't use
  for (let i = validEntries.length; i < existingRows.length; i++) {
    (existingRows[i] as HTMLElement).style.display = 'none';
  }
}

export function updatePaytable(): void {
  try {
    const gameInitData = (window as any).getGameInitData?.();
    if (!gameInitData?.gameInfo?.payTable) return;

    const paytable = gameInitData.gameInfo.payTable;
    const multiplier = (window as any).getTotalCredit?.() || 1;
    const symbols: string[] = (window as any).getPaytableSymbols?.() || [];

    if (!symbols.length) return;

    // SC (scatter)
    const scItem = document.querySelector('.sc-treasure-item');
    const scKey = paytable['SC'] ? 'SC' : (paytable['WD'] ? 'WD' : null);
    if (scItem && scKey) {
      renderRows(scItem, paytable[scKey], multiplier, 'desc');
    }

    // Normal symbols
    const treasureItems = document.querySelectorAll('.treasure-item');

    treasureItems.forEach((item, index) => {
      const el = item as HTMLElement;
      const symbolKey = el.dataset.symbol || symbols[index];
      const symbolData: number[] = paytable[symbolKey];

      if (!Array.isArray(symbolData)) return;

      renderRows(item, symbolData, multiplier, 'desc');
    });

  } catch (err) {
    console.error('[GameRulesPanel] updatePaytable error:', err);
  }
}

// ─── Header title ─────────────────────────────────────────────────────────────
export function updateHeaderTitle(
  section: string,
  commonRules: Record<string, string> | null,
): void {
  const headerTitle = document.getElementById('rules-heading');
  if (!headerTitle) return;

  const attrMap: Record<string, string> = { paytable: 'paytable', rules: 'rules', history: 'history' };
  const dataAttr = attrMap[section];
  if (!dataAttr) return;

  headerTitle.setAttribute('data-common', dataAttr);
  if (commonRules?.[dataAttr]) headerTitle.textContent = commonRules[dataAttr];
}

// ─── Footer icons ─────────────────────────────────────────────────────────────
export function updateFooterIcons(activeTab: string): void {
  document.querySelectorAll<HTMLElement>('.footer-item').forEach((item) => {
    const section = item.dataset.section;
    if (!section) return;

    const isActive = section === activeTab;
    item.classList.toggle('active', isActive);

    const img = item.querySelector<HTMLImageElement>('.footer-icon');
    if (!img) return;

    const src = img.src;
    if (isActive && src.includes('Inactive')) {
      img.src = src.replace('Inactive', 'Active');
    } else if (!isActive && src.includes('Active')) {
      img.src = src.replace('Active', 'Inactive');
    }
  });
}

// ─── Close button ─────────────────────────────────────────────────────────────
/**
 * Sets up the rules-panel close button.
 * Uses a simple boolean guard reset via pointerup/pointercancel — no setTimeout.
 */
export function setupCloseButton(id: string): void {
  const closeBtn = document.getElementById(id);
  if (!closeBtn) return;

  // Remove any stale handler
  const prev = (closeBtn as any)._closeHandler;
  if (prev) closeBtn.removeEventListener('click', prev, true);
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
      console.error('[GameRulesPanel] close error:', err);
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
