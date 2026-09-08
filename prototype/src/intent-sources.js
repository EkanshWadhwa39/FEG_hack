/**
 * Where intent comes from, on every input device.
 *
 * The dwell tracker was built around `mouseenter`/`mouseleave` plus keyboard
 * focus. That covers desktop and assistive technology and misses the majority
 * of the audience: FEG's own telemetry puts ~72% of launches on a mobile
 * client, and **a touch screen has no hover at all**. On a phone the old wiring
 * produced exactly zero intent, so every launch took the cold path — which is
 * the honest explanation for "hover prefetch does nothing".
 *
 * Two touch signals replace hover, and they are different in kind:
 *
 *   1. **Viewport dwell.** A player scrolls a lobby, stops, and looks at what
 *      is on screen. A tile resting near the centre of a settled viewport is
 *      the touch equivalent of a pointer resting on a tile. It is a *guess*,
 *      so it feeds the same decaying dwell score and is subject to the same
 *      governor.
 *   2. **Touch-down commit.** `pointerdown` fires 80-300 ms before `click`
 *      (tap-slop resolution, scroll disambiguation, and on iOS the historical
 *      click delay). This is not a prediction: the finger is already on the
 *      tile. It has no false-positive cost worth governing against, so it goes
 *      straight to the top rung. It is a small head start, but it is free and
 *      it is certain — and it is the only speculation available to a player who
 *      taps the first thing they see.
 *
 * A commit is released on `pointercancel` and on a `pointerup` that did not
 * become a click, so a scroll that began on a tile does not leave a phantom
 * commitment behind.
 */

/** No scroll event for this long means the player has settled on something. */
export const SCROLL_SETTLE_MS = 220;

/** A tile must be at least this visible to count as looked-at. */
export const MIN_VISIBLE_RATIO = 0.6;

/**
 * Longest a settled viewport keeps crediting one tile.
 *
 * Viewport focus is a guess, and a guess does not become more true because the
 * phone was left on the table. Bounding it stops an abandoned lobby from
 * accumulating enough "dwell" to buy an engine for whatever is on screen.
 */
export const MAX_VIEWPORT_HOLD_MS = 2_500;

/**
 * Of the tiles currently on screen, which one is the player looking at?
 *
 * Nearest to the vertical centre of the viewport wins, because that is where a
 * thumb-scrolled list comes to rest. Ties break on id so the choice is stable
 * across ticks rather than flickering between two equidistant tiles.
 *
 * @param visible        `[{ gameId, top, bottom, ratio }]` in viewport coordinates
 * @param viewportHeight
 */
export function selectViewportFocus(visible, viewportHeight, {
  minVisibleRatio = MIN_VISIBLE_RATIO,
} = {}) {
  if (!Array.isArray(visible) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return null;
  }
  const centre = viewportHeight / 2;

  let best = null;
  let bestDistance = Infinity;
  for (const entry of visible) {
    if (typeof entry?.gameId !== "string" || entry.gameId.length === 0) continue;
    if (!Number.isFinite(entry.top) || !Number.isFinite(entry.bottom)) continue;
    if (!Number.isFinite(entry.ratio) || entry.ratio < minVisibleRatio) continue;

    const distance = Math.abs((entry.top + entry.bottom) / 2 - centre);
    if (distance < bestDistance
      || (distance === bestDistance && best != null && entry.gameId < best)) {
      best = entry.gameId;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Attach every intent source to one tile.
 *
 * Pointer, keyboard and touch are credited through the same dwell tracker, so a
 * keyboard or switch-device user gets exactly the same faster launch as a mouse
 * user. Returns a detach function.
 *
 * @param element    the tile's button
 * @param gameId
 * @param dwell      a `createDwellTracker()` instance
 * @param onCommit   called with the game id on `pointerdown`
 * @param onRelease  called with the game id when a commit did not become a click
 */
export function attachTileIntent({ element, gameId, dwell, onCommit, onRelease } = {}) {
  if (element == null || typeof element.addEventListener !== "function") {
    throw new TypeError("element must be an event target");
  }
  if (typeof gameId !== "string" || gameId.length === 0) {
    throw new TypeError("gameId must be a non-empty string");
  }
  if (typeof dwell?.enter !== "function" || typeof dwell?.leave !== "function") {
    throw new TypeError("dwell must be a dwell tracker");
  }
  const commit = typeof onCommit === "function" ? onCommit : () => {};
  const release = typeof onRelease === "function" ? onRelease : () => {};

  const enter = () => dwell.enter(gameId);
  const leave = () => dwell.leave(gameId);
  const down = (event) => {
    // A mouse press is already covered by hover dwell; this rung exists for the
    // devices that never produced a hover in the first place.
    if (event?.pointerType === "mouse") return;
    dwell.enter(gameId);
    commit(gameId);
  };
  const up = () => release(gameId);

  const listeners = [
    ["mouseenter", enter],
    ["mouseleave", leave],
    ["focus", enter],
    ["blur", leave],
    ["pointerdown", down],
    ["pointercancel", up],
    ["pointerleave", up],
  ];
  for (const [type, handler] of listeners) element.addEventListener(type, handler);

  return () => {
    for (const [type, handler] of listeners) element.removeEventListener(type, handler);
  };
}

/**
 * Turn "the list stopped scrolling and this tile is in the middle" into dwell.
 *
 * Deliberately edge-triggered: dwell is credited only while the viewport is
 * settled, so a fast flick through forty tiles credits none of them. That
 * matches the pointer rule, where a cursor crossing a tile is travel and not
 * interest.
 */
export function createViewportDwell({
  dwell,
  readVisibleTiles,
  viewportHeight = () => globalThis.innerHeight,
  settleMs = SCROLL_SETTLE_MS,
  maxHoldMs = MAX_VIEWPORT_HOLD_MS,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
} = {}) {
  if (typeof dwell?.enter !== "function") throw new TypeError("dwell must be a dwell tracker");
  if (typeof readVisibleTiles !== "function") {
    throw new TypeError("readVisibleTiles must be a function");
  }
  if (!Number.isFinite(maxHoldMs) || maxHoldMs <= 0) {
    throw new RangeError("maxHoldMs must be a positive finite number");
  }

  let settleTimer = null;
  let holdTimer = null;
  let focused = null;

  function release() {
    if (holdTimer != null) {
      clearTimeoutImpl(holdTimer);
      holdTimer = null;
    }
    if (focused != null) {
      dwell.leave(focused);
      focused = null;
    }
  }

  function settle() {
    const height = typeof viewportHeight === "function" ? viewportHeight() : viewportHeight;
    const next = selectViewportFocus(readVisibleTiles(), height);
    if (next === focused) return;
    release();
    focused = next;
    if (focused == null) return;
    dwell.enter(focused);
    // A tile sitting in a settled viewport is weak evidence that does not get
    // stronger the longer nobody touches the phone. Without this bound, an
    // abandoned lobby accumulates unlimited "intent" for whatever happens to be
    // on screen and eventually buys it a whole engine.
    holdTimer = setTimeoutImpl(release, maxHoldMs);
  }

  return Object.freeze({
    /** Call on every scroll event. Cheap: it only resets a timer. */
    onScroll() {
      // Scrolling means the player has not settled yet, so any tile that was
      // being credited stops being credited now.
      release();
      if (settleTimer != null) clearTimeoutImpl(settleTimer);
      settleTimer = setTimeoutImpl(() => {
        settleTimer = null;
        settle();
      }, settleMs);
    },

    /** Force an evaluation, e.g. after the grid first renders. */
    settle,

    focused: () => focused,

    stop() {
      if (settleTimer != null) clearTimeoutImpl(settleTimer);
      settleTimer = null;
      release();
    },
  });
}
