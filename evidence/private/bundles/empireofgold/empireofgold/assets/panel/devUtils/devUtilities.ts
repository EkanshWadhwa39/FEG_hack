// export {};
// @ts-ignore: Allow global augmentation in non-module file
const link: HTMLLinkElement = document.createElement('link');
link.rel = 'stylesheet';
link.type = 'text/css';
link.href = 'assets/panel/devUtils/cheatTool.css';
document.head.appendChild(link);

// CREATE CHEAT TOOL HTML
const main: HTMLElement = document.createElement('main');
main.id = 'cheatTool-MainContainer';
main.style.display = 'none';
main.setAttribute('isMobile', 'false');

// HEADER
const header: HTMLElement = document.createElement('header');
const emptyDiv: HTMLDivElement = document.createElement('div');
const heading: HTMLDivElement = document.createElement('div');
const closeBtn: HTMLDivElement = document.createElement('div');
header.id = 'cheatHeader';
emptyDiv.id = 'headerEmptyDiv';
heading.id = 'headingTitle';
closeBtn.id = 'closeBtn';

heading.innerText = 'BONUS CHEAT';
// closeBtn.innerText = 'X';
header.append(emptyDiv, heading, closeBtn);

// CHEATS WRAPPER & CONTAINER
const cheatsWrapper: HTMLDivElement = document.createElement('div');
cheatsWrapper.id = 'cheatsWrapper';
const cheatsContainer: HTMLDivElement = document.createElement('div');
cheatsContainer.id = 'cheatsContainer';
cheatsWrapper.appendChild(cheatsContainer);

// APPEND TO MAIN CONTAINER
main.append(header, cheatsWrapper);
document.getElementById('gameStage')?.prepend(main);

// ======================
// STORE SELECTED CHEAT
// ======================
let selectedCheatKey: string | null = null;

// FALLBACK COMBINATIONS DATA
const fallbackCombinations: Record<string, number[]> = {
  NONE: [],
  'No Win': [0, 0, 0, 0, 0],
  'Small Win': [4, 2, 1, 0, 0],
  '2 oak sc': [7, 7, 0, 0, 0],
  '3 oak sc': [7, 7, 7, 0, 0],
  '4 oak sc': [7, 7, 7, 7, 0],
  '5 oak sc': [7, 7, 7, 7, 7],
  '3 oak H1': [6, 1, 40, 0, 0],
  '4 oak H1': [6, 1, 40, 9, 0],
  '5 oak H1': [6, 1, 40, 9, 25],
  '3 oak H2': [44, 40, 8, 0, 0],
  '4 oak H2': [44, 40, 8, 17, 0],
  '5 oak H2': [44, 40, 8, 17, 24],
  '3 oak H3': [12, 4, 30, 0, 0],
  '4 oak H3': [12, 4, 30, 27, 0],
  '5 oak H3': [12, 4, 30, 27, 27],
  '3 oak H4': [37, 32, 32, 0, 0],
  '4 oak H4': [37, 32, 32, 12, 0],
  '5 oak H4': [37, 32, 32, 12, 32],
  '3 oak L1': [0, 6, 5, 0, 0],
  '4 oak L1': [0, 6, 5, 2, 0],
  '5 oak L1': [0, 6, 5, 2, 42],
  '3 oak L2': [1, 14, 39, 66, 0],
  '4 oak L2': [1, 14, 39, 0, 5],
  '5 oak L2': [1, 14, 39, 0, 7],
  '3 oak L3': [13, 34, 34, 0, 70],
  '4 oak L3': [13, 34, 34, 1, 70],
  '5 oak L3': [13, 34, 34, 1, 0],
  '3 oak L4': [2, 28, 21, 0, 0],
  '4 oak L4': [2, 28, 21, 4, 0],
  '5 oak L4': [2, 28, 21, 4, 3],
  '3 oak L5': [4, 2, 1, 1, 0],
  '4 oak L5': [4, 2, 1, 5, 0],
  '5 oak L5': [4, 2, 1, 5, 7],
};

// DECLARE GLOBALS FOR WINDOW
// @ts-ignore: Allow global augmentation in non-module file
declare global {
  interface Window {
    cheatBtnClicked: (isDesktop: boolean) => void;
    fetchCheatDetails: () => void;
    playHistoryRulesSound: () => void;
    setExternalPageClosed: () => void;
  }
}

// SHOWING CHEAT TOOL
(window as any).cheatBtnClicked = (isDesktop: boolean): void => {
  if (!isDesktop) {
    main.setAttribute('isMobile', 'true');
  }
  main.style.display = 'block';
};

// FETCH CHEAT DETAILS
(window as any).fetchCheatDetails = (): void => {
  cheatsContainer.innerHTML = '';

  fetch((window as any).getCheatPath?.())
    .then((res: Response) => {
      if (!res.ok) throw new Error('Failed to fetch JSON');
      return res.json();
    })
    .then((data: Record<string, number[]>) => {
      renderCheatButtons(data);
    })
    .catch((err: Error) => {
      console.warn('⚠️ cheat.json failed, using fallback:', err.message);
      renderCheatButtons(fallbackCombinations);
    });
};

// EVENT HANDLERS
closeBtn.onclick = closeCheatWindow;

function closeCheatWindow(): void {
  (window as any).playHistoryRulesSound();
  main.style.display = 'none';
  const closeBtnEl = document.getElementById('closeBtn');
  closeBtnEl?.classList.remove('tapped');
  (window as any).setExternalPageClosed();

}

function onEnter(e: MouseEvent): void {
  (e.currentTarget as HTMLElement).style.background = 'rgba(81,81,81,0.5)';
}

function onLeave(e: MouseEvent): void {
  (e.currentTarget as HTMLElement).style.background = 'rgba(0, 0, 0, 0.5)';
}

// CATEGORY CLASS FUNCTION
function getCategoryClass(key: string): string {
  if (key === 'No Win') return 'no-win';
  if (key === 'Small Win') return 'small-win';
  if (key.includes('oak sc')) return 'oak';
  if (key.includes('H')) return 'h-series';
  if (key.includes('L')) return 'l-series';
  return '';
}

const closeBtnEl = document.getElementById('closeBtn');

// For mobile/touch devices, simulate rotation
closeBtnEl?.addEventListener(
  'touchend',
  () => {
    closeBtnEl.classList.add('tapped');
    closeCheatWindow();
  },
  { passive: true },
);

// CHEAT SELECT FUNCTION (UNIFIED)
function cheatSelect(e: Event, cheat: number[] | string): void {
  // Prevent default behavior for touch devices
  if (e.type === 'touchstart') {
    e.preventDefault();
  }

  // Reset all buttons
  const cheatDivs: HTMLCollectionOf<Element> = document.getElementsByClassName('cheatDiv');
  Array.from(cheatDivs).forEach((element: Element) => {
    const htmlElement = element as HTMLElement;
    htmlElement.classList.remove('active');
    htmlElement.onmouseenter = onEnter;
    htmlElement.onmouseleave = onLeave;
  });

  // Style the selected button
  const selectedDiv = e.currentTarget as HTMLElement;
  selectedDiv.onmouseenter = null;
  selectedDiv.onmouseleave = null;
  selectedDiv.classList.add('active');

  // Store selected cheat key
  selectedCheatKey = selectedDiv.innerText;

  // Set the cheat value
  if (cheat === 'NONE') {
    (window as any).setCheatValue(undefined);
  } else {
    (window as any).setCheatValue(cheat);
  }

  // Close the window after a short delay
  setTimeout(() => {
    closeCheatWindow();
  }, 10);
}

// RENDER CHEAT BUTTONS (UPDATED)
function renderCheatButtons(data: Record<string, number[]>): void {
  cheatsContainer.innerHTML = ''; // Clear container
  const keys: string[] = Object.keys(data);

  keys.forEach((key: string, index: number) => {
    const cheatDiv: HTMLDivElement = document.createElement('div');
    cheatDiv.className = 'cheatDiv ' + getCategoryClass(key);
    cheatDiv.style.setProperty('--delay', index * 0.01 + 's'); // stagger animation
    cheatDiv.innerText = key;

    // Restore active state if this was previously selected
    if (selectedCheatKey === key) {
      cheatDiv.classList.add('active');
    }

    const cheatValues: number[] = data[key];

    // Variables to track touch interaction
    let touchStartTime: number = 0;
    let touchStartX: number = 0;
    let touchStartY: number = 0;

    // Add touch events to detect taps (not scrolls)
    cheatDiv.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        touchStartTime = Date.now();
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      },
      { passive: true },
    );

    cheatDiv.addEventListener(
      'touchend',
      (e: TouchEvent) => {
        const touchEndTime: number = Date.now();
        const touchDuration: number = touchEndTime - touchStartTime;

        // Calculate distance moved
        const touchEndX: number = e.changedTouches[0].clientX;
        const touchEndY: number = e.changedTouches[0].clientY;
        const deltaX: number = Math.abs(touchEndX - touchStartX);
        const deltaY: number = Math.abs(touchEndY - touchStartY);

        // Only trigger if it's a tap (short duration and small movement)
        if (touchDuration < 300 && deltaX < 10 && deltaY < 10) {
          e.preventDefault();
          (window as any).playHistoryRulesSound();
          cheatSelect(e, cheatValues);
        }
      },
      { passive: false },
    );

    // Add click event for mouse devices
    cheatDiv.addEventListener('click', (e: MouseEvent) => {
      (window as any).playHistoryRulesSound();
      cheatSelect(e, cheatValues);
    });

    cheatsContainer.appendChild(cheatDiv);
  });
}
