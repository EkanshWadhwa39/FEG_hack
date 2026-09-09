/**
 * Keyboard and motion primitives, kept pure so the accessibility behaviour of
 * the drawer and transition screen is unit-tested rather than click-tested.
 */

/** Elements that can hold focus inside a trapped container. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Roving-tabindex movement for a vertical list, per the WAI-ARIA authoring
 * practices. Returns the next index, or the current one for unrelated keys so
 * the caller knows not to preventDefault.
 *
 * Wraps at both ends, which keeps long game lists navigable with one key.
 */
export function nextRovingIndex(currentIndex, key, length) {
  if (!Number.isInteger(length) || length <= 0) return -1;
  const current = Number.isInteger(currentIndex)
    ? Math.min(Math.max(currentIndex, 0), length - 1)
    : 0;

  switch (key) {
    case "ArrowDown":
      return (current + 1) % length;
    case "ArrowUp":
      return (current - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return current;
  }
}

/**
 * Tab order inside a focus trap. Returns the index to move to, wrapping at
 * both ends so focus cannot escape a modal transition screen.
 */
export function nextTrapIndex(currentIndex, { shiftKey = false } = {}, length) {
  if (!Number.isInteger(length) || length <= 0) return -1;
  const current = Number.isInteger(currentIndex) ? currentIndex : -1;
  if (current < 0) return shiftKey ? length - 1 : 0;
  return shiftKey
    ? (current - 1 + length) % length
    : (current + 1) % length;
}

/**
 * Read the reduced-motion preference. A browser without matchMedia, or one
 * that throws on an unsupported query, is treated as "reduce" so the safer
 * behaviour is the fallback.
 */
export function prefersReducedMotion(matchMedia = globalThis.matchMedia) {
  if (typeof matchMedia !== "function") return true;
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return true;
  }
}

/**
 * Compose the message announced when drawer contents change. Empty states are
 * distinguished so a screen reader user learns why a list is empty rather than
 * hearing silence.
 */
export function describeDrawerResults({ view, count, emptyReason }) {
  if (count > 0) {
    const noun = count === 1 ? "game" : "games";
    return `${count} ${noun} in ${view.toLowerCase()}.`;
  }
  switch (emptyReason) {
    case "NO_FAVOURITES":
      return "No favourites yet. Add a game to favourites to see it here.";
    case "NO_RECENTS":
      return "No recently played games yet.";
    case "EMPTY_QUERY":
      return "Type to search the game list.";
    case "NO_MATCHES":
      return "No games match that search.";
    default:
      return "No games to show.";
  }
}
