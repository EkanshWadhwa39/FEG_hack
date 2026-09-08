/**
 * Wires the non-personalised drawer and the launch transition screen.
 *
 * Everything on this surface is synthetic and labelled as such. No provider
 * request is issued from this file, and no prefetch policy lives here — the
 * drawer only reports player intent through a one-way seam.
 */

import {
  FOCUSABLE_SELECTOR,
  describeDrawerResults,
  nextRovingIndex,
  nextTrapIndex,
  prefersReducedMotion,
} from "./a11y.js";
import { DrawerView, buildDrawer, createIntentReporter } from "./drawer.js";
import { TransitionState, createTransition } from "./transition.js";
import { LimitState, createRgState } from "./rg-state.js";
import { ReviewFlag, createCounterMetrics } from "./counter-metrics.js";

/* -------------------------------------------------------------------------
 * Synthetic data. Titles are sample values; none of this is real player data.
 * ---------------------------------------------------------------------- */

const CATALOGUE = Object.freeze([
  { id: "eog", title: "Empire of Gold", provider: "Provider A" },
  { id: "ssd", title: "Savanna Sunrise Deluxe", provider: "Provider A" },
  { id: "zez", title: "Žeželj Gold", provider: "Provider B" },
  { id: "sun", title: "Sunset Reels", provider: "Provider B" },
  { id: "gld", title: "Golden Hour", provider: "Provider C" },
  { id: "cev", title: "Ćevap Fortune", provider: "Provider C" },
  { id: "riv", title: "River Drift", provider: "Provider D" },
  { id: "nig", title: "Night Market", provider: "Provider D" },
]);

const FAVOURITES = Object.freeze([
  { id: "ssd", favouritedAt: 300 },
  { id: "gld", favouritedAt: 200 },
  { id: "riv", favouritedAt: 100 },
]);

const RECENTS = Object.freeze([
  { id: "eog", lastPlayedAt: 900 },
  { id: "sun", lastPlayedAt: 700 },
  { id: "ssd", lastPlayedAt: 500 },
]);

// A synthetic session already in progress, so the RG figures are non-trivial.
const SESSION_STARTED_AT = Date.now() - 22 * 60_000;
const SYNTHETIC_RECORD = Object.freeze({
  sessionStartedAt: SESSION_STARTED_AT,
  stakedMinorUnits: 4_250,
  returnedMinorUnits: 3_100,
  limitMinorUnits: 5_000,
  baselineVelocityMinorUnitsPerMinute: 160,
});

/* ------------------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);

const trigger = $("drawer-trigger");
const drawer = $("drawer");
const search = $("drawer-search");
const tablist = drawer.querySelector('[role="tablist"]');
const tabs = [...tablist.querySelectorAll('[role="tab"]')];
const resultsList = $("drawer-results");
const emptyState = $("drawer-empty");
const drawerCount = $("drawer-count");
const pageStatus = $("page-status");
const motionState = $("motion-state");
const extendedControl = $("extended-duration");

const overlay = $("transition");
const transitionStatus = $("transition-status");
const cancelButton = $("transition-cancel");
const rgDuration = $("rg-duration");
const rgNet = $("rg-net");
const rgLimit = $("rg-limit");

const metricTime = $("metric-time");
const metricVelocity = $("metric-velocity");
const metricFlag = $("metric-flag");
const interactiveButton = $("signal-interactive");
const paintButton = $("signal-paint");
const failButton = $("signal-fail");

const readRgState = createRgState({ read: () => SYNTHETIC_RECORD });
const readCounterMetrics = createCounterMetrics({ read: () => SYNTHETIC_RECORD });

// One-way seam. A prefetch policy would consume this; nothing here reads it
// back, and nothing about it changes what the player is shown.
const intentLog = [];
const reportIntent = createIntentReporter((intent) => {
  intentLog.push(intent.gameId);
});

const transition = createTransition();

let currentView = DrawerView.FAVOURITES;
let activeResultIndex = 0;
let lastFocusedBeforeTransition = null;
let tickTimer = null;

/* ---------------------------- Drawer ---------------------------- */

function renderDrawer() {
  const result = buildDrawer({
    catalogue: CATALOGUE,
    favourites: FAVOURITES,
    recents: RECENTS,
    query: search.value,
    view: currentView,
  });

  resultsList.replaceChildren(
    ...result.items.map((item, index) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.gameId = item.id;
      button.dataset.index = String(index);
      // Roving tabindex: one stop for the whole list, arrows move within it.
      button.tabIndex = index === activeResultIndex ? 0 : -1;

      const title = document.createElement("span");
      title.className = "game-title";
      title.textContent = item.title;

      const provider = document.createElement("span");
      provider.className = "game-provider";
      provider.textContent = item.provider;

      button.append(title, provider);
      button.addEventListener("click", () => openTransition(item));
      button.addEventListener("mouseenter", () => reportIntent(item.id));
      button.addEventListener("focus", () => {
        activeResultIndex = index;
        syncRovingTabindex();
      });
      li.append(button);
      return li;
    }),
  );

  if (activeResultIndex >= result.items.length) activeResultIndex = 0;
  syncRovingTabindex();

  const message = describeDrawerResults({
    view: result.view,
    count: result.items.length,
    emptyReason: result.emptyReason,
  });
  emptyState.hidden = result.items.length > 0;
  emptyState.textContent = result.items.length > 0 ? "" : message;
  drawerCount.textContent = message;
  resultsList.setAttribute("aria-labelledby", `tab-${currentView}`);
}

function resultButtons() {
  return [...resultsList.querySelectorAll("button")];
}

function syncRovingTabindex() {
  resultButtons().forEach((button, index) => {
    button.tabIndex = index === activeResultIndex ? 0 : -1;
  });
}

function selectView(view, { focusTab = false } = {}) {
  currentView = view;
  activeResultIndex = 0;
  for (const tab of tabs) {
    const selected = tab.id === `tab-${view}`;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focusTab) tab.focus();
  }
  renderDrawer();
}

function setDrawerOpen(open) {
  drawer.hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
  if (open) {
    renderDrawer();
    search.focus();
  } else {
    trigger.focus();
  }
}

trigger.addEventListener("click", () => setDrawerOpen(drawer.hidden));

search.addEventListener("input", () => {
  // Typing is an explicit search intent, so move to the search view.
  if (currentView !== DrawerView.SEARCH) selectView(DrawerView.SEARCH);
  else renderDrawer();
});

tablist.addEventListener("keydown", (event) => {
  // Reuse the vertical helper by mapping horizontal keys onto it.
  const mapped = { ArrowRight: "ArrowDown", ArrowLeft: "ArrowUp" }[event.key] ?? event.key;
  const currentIndex = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
  const nextIndex = nextRovingIndex(currentIndex, mapped, tabs.length);
  if (nextIndex === currentIndex || nextIndex < 0) return;
  event.preventDefault();
  selectView(tabs[nextIndex].id.replace("tab-", ""), { focusTab: true });
});

for (const tab of tabs) {
  tab.addEventListener("click", () => selectView(tab.id.replace("tab-", "")));
}

resultsList.addEventListener("keydown", (event) => {
  const buttons = resultButtons();
  const nextIndex = nextRovingIndex(activeResultIndex, event.key, buttons.length);
  if (nextIndex === activeResultIndex || nextIndex < 0) return;
  event.preventDefault();
  activeResultIndex = nextIndex;
  syncRovingTabindex();
  buttons[nextIndex].focus();
});

drawer.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setDrawerOpen(false);
  }
});

/* -------------------------- Transition -------------------------- */

function renderRgState() {
  const state = readRgState();
  rgDuration.textContent = state.sessionDuration;
  rgNet.textContent = state.available ? state.netPosition : "UNKNOWN";
  rgLimit.textContent = state.available ? state.limitRemaining : "UNKNOWN";
  rgLimit.dataset.limit = state.available ? state.limitState : LimitState.OK;
}

function renderCounterMetrics() {
  const metrics = readCounterMetrics();
  metricTime.textContent = metrics.timeOnDevice;
  metricVelocity.textContent = metrics.stakeVelocityPerMinute == null
    ? "UNKNOWN"
    : `${(metrics.stakeVelocityPerMinute / 100).toFixed(2)} €`;
  metricFlag.textContent = metrics.reviewFlag;
  metricFlag.dataset.flag = metrics.reviewFlag ?? ReviewFlag.UNKNOWN;
}

function setDemoControlsEnabled(enabled) {
  for (const button of [interactiveButton, paintButton, failButton]) {
    button.disabled = !enabled;
  }
}

function openTransition(item) {
  lastFocusedBeforeTransition = document.activeElement;
  transition.open();
  overlay.hidden = false;
  transitionStatus.textContent =
    `Opening ${item.title}. Waiting for the game to accept input. SIMULATED.`;
  cancelButton.textContent = "Cancel and return to lobby";
  renderRgState();
  setDemoControlsEnabled(true);
  cancelButton.focus();

  // The clock keeps running while the screen is up, so the session figures
  // stay truthful rather than freezing at the moment of launch.
  tickTimer = globalThis.setInterval(() => {
    renderRgState();
    renderCounterMetrics();
  }, 1_000);
}

function closeTransition({ announce }) {
  overlay.hidden = true;
  setDemoControlsEnabled(false);
  if (tickTimer != null) {
    globalThis.clearInterval(tickTimer);
    tickTimer = null;
  }
  pageStatus.textContent = announce;
  const target = lastFocusedBeforeTransition ?? trigger;
  if (typeof target.focus === "function") target.focus();
  lastFocusedBeforeTransition = null;
  transition.reset();
}

transition.subscribe((snapshot) => {
  if (snapshot.state === TransitionState.CLEARED) {
    // In production, focus would move to the game surface here.
    closeTransition({ announce: "Game ready and accepting input. SIMULATED." });
  }
  if (snapshot.state === TransitionState.FAILED) {
    transitionStatus.textContent =
      `Could not open the game (${snapshot.failureReason}). Nothing was started. SIMULATED.`;
    cancelButton.textContent = "Return to lobby";
    cancelButton.focus();
  }
});

cancelButton.addEventListener("click", () => {
  const { state } = transition.getState();
  if (state === TransitionState.VISIBLE) transition.fail("CANCELLED_BY_PLAYER");
  closeTransition({ announce: "Launch cancelled. You are back in the lobby." });
});

// Focus trap: a modal transition must not leak focus to the page behind it.
overlay.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelButton.click();
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = [...overlay.querySelectorAll(FOCUSABLE_SELECTOR)];
  if (focusable.length === 0) return;
  const currentIndex = focusable.indexOf(document.activeElement);
  const nextIndex = nextTrapIndex(currentIndex, { shiftKey: event.shiftKey }, focusable.length);
  event.preventDefault();
  focusable[nextIndex].focus();
});

/* ------------------------ Demo-only signals ---------------------- */

interactiveButton.addEventListener("click", () => {
  transition.signalInteractive("INPUT_ACCEPTED");
  const snapshot = transition.getState();
  if (snapshot.state === TransitionState.VISIBLE) {
    // Held deliberately so the announcement is not cut off.
    transitionStatus.textContent =
      "Game is accepting input. Holding briefly so this can be announced. SIMULATED.";
  }
});

paintButton.addEventListener("click", () => {
  transition.notifyFirstPaint();
  transitionStatus.textContent =
    "First paint received. That is not readiness, so the screen stays. SIMULATED.";
});

failButton.addEventListener("click", () => transition.fail("NETWORK_LOST"));

/* --------------------------- Preferences ------------------------- */

extendedControl.addEventListener("change", () => {
  transition.setExtendedDuration(extendedControl.checked);
});

const reduced = prefersReducedMotion();
motionState.textContent = reduced
  ? "Reduced motion is on: the launch indicator does not animate."
  : "Reduced motion is off: the launch indicator animates.";
// A browser that prefers reduced motion also gets the longer announcement
// window by default, since both preferences point at needing more time.
if (reduced) {
  extendedControl.checked = true;
  transition.setExtendedDuration(true);
}

renderCounterMetrics();
renderDrawer();
