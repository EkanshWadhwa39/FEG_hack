// Make this file a module so global augmentations are allowed
export {};
declare global {
  interface Window {
    cheatBtnClicked: (isDesktop: boolean) => void;
    fetchCheatDetails: () => void;
  }
}

// Adding CSS
const link: HTMLLinkElement = document.createElement('link');
link.rel = 'stylesheet';
link.type = 'text/css';
link.href = 'gameassets/1.04/panel/cheatTool/style.css';

document.getElementsByTagName('HEAD')[0].appendChild(link);

// Creating HTML
const main: HTMLElement = document.createElement('main');
main.id = "cheatTool-MainContainer";
main.style.display = "none";
main.setAttribute("isMobile", "false");

const header: HTMLElement = document.createElement('header');
const emptyDiv: HTMLDivElement = document.createElement('div');
const heading: HTMLDivElement = document.createElement('div');
const closeBtn: HTMLDivElement = document.createElement('div');
const closeBtnImg: HTMLImageElement = document.createElement('img');
closeBtn.append(closeBtnImg);
header.id = "cheatHeader";
emptyDiv.id = "headerEmptyDiv";
heading.id = "headingTitle";
closeBtn.id = "closeBtn";

heading.innerText = "BONUS CHEAT";
closeBtnImg.src = "gameassets/1.04/images/rulesCloseBtn.png";
header.append(emptyDiv, heading, closeBtn);

const cheatsWrapper: HTMLDivElement = document.createElement('div');
cheatsWrapper.id = "cheatsWrapper";
const cheatsContainer: HTMLDivElement = document.createElement('div');
cheatsContainer.id = "cheatsContainer";
cheatsWrapper.appendChild(cheatsContainer);

main.append(header, cheatsWrapper);
document.getElementById('gameStage')?.prepend(main);

// ✅ Define window functions
window.cheatBtnClicked = (isDesktop: boolean): void => {
  if (!isDesktop) {
    main.setAttribute("isMobile", "true");
  }
  main.style.display = 'block';
};

// Load cheat tool data after init response
window.fetchCheatDetails = (): void => {
  fetch("/src/slots/aztec/panel/cheat.json")
    .then((res: Response) => res.json())
    .then((data: Record<string, any>) => {
      for (const key in data) {
        const cheatDiv: HTMLDivElement = document.createElement('div');
        cheatDiv.className = "cheatDiv";
        cheatDiv.innerText = key;

        const cheat = data[key];
        cheatDiv.onclick = (e: MouseEvent) => cheatSelect(e, cheat);
        cheatDiv.onmouseenter = onEnter;
        cheatDiv.onmouseleave = onLeave;
        cheatsContainer.appendChild(cheatDiv);
      }
    });
};

// Functionality
closeBtn.onclick = closeCheatWindow;

function closeCheatWindow(): void {
  main.style.display = "none";
}

function onEnter(e: MouseEvent): void {
  (e.currentTarget as HTMLElement).style.background = "rgba(81,81,81,0.5)";
}

function onLeave(e: MouseEvent): void {
  (e.currentTarget as HTMLElement).style.background = "rgba(0, 0, 0, 0.5)";
}

function cheatSelect(e: MouseEvent, cheat: any): void {
  const cheatDivs: HTMLCollectionOf<Element> = document.getElementsByClassName("cheatDiv");
  Array.from(cheatDivs).forEach((element: Element) => {
    const htmlElement = element as HTMLElement;
    htmlElement.style.background = "rgba(0, 0, 0, 0.5)";
    htmlElement.style.color = "white";
    htmlElement.onmouseenter = onEnter;
    htmlElement.onmouseleave = onLeave;
  });

  const currentTarget = e.currentTarget as HTMLElement;
  currentTarget.onmouseenter = null;
  currentTarget.onmouseleave = null;
  currentTarget.style.background = "#FFCA0D";
  currentTarget.style.color = "black";

  if (cheat === "NONE") {
    (window as any).setCheatValue(undefined);
  } else {
    (window as any).setCheatValue(cheat);
  }

  setTimeout(() => { closeCheatWindow(); }, 10);
}
