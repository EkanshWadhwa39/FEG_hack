/**
 * Progressive rendering for the games grid.
 *
 * The lobby shell and the tile grid appear immediately; each tile's content
 * fills in as it arrives. The player sees structure instantly instead of a
 * blank rectangle, which is the "perceived loading" the brief asks for.
 *
 * The line this module does not cross: a placeholder shows that *something is
 * coming*, never a value. No fabricated title, thumbnail, jackpot, balance, or
 * count is ever rendered. Showing invented figures in a gambling product is a
 * data-integrity problem, not a loading optimisation.
 *
 * Accessibility, because skeleton screens are usually hostile to it:
 *   - Placeholders are decorative and must be hidden from assistive tech, or a
 *     screen reader announces "loading" once per tile, forty times.
 *   - The container is marked busy while incomplete, so AT knows the region is
 *     still changing rather than silently reading a half-built list.
 *   - Exactly one announcement is emitted when loading settles, carrying the
 *     real count.
 */

export const LoadPhase = Object.freeze({
  SHELL: "SHELL",
  PARTIAL: "PARTIAL",
  COMPLETE: "COMPLETE",
  EMPTY: "EMPTY",
});

/** Never draw more placeholders than a viewport can plausibly show. */
export const MAX_PLACEHOLDERS = 24;

function requireCount(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return value;
}

/**
 * Decide what the grid should render right now.
 *
 * @param expectedCount how many tiles we expect in total, if known
 * @param items         the tiles whose content has actually arrived
 * @param settled       true once loading finished, however many arrived
 */
export function planProgressiveRender({
  expectedCount = 0,
  items = [],
  settled = false,
  maxPlaceholders = MAX_PLACEHOLDERS,
} = {}) {
  requireCount(expectedCount, "expectedCount");
  requireCount(maxPlaceholders, "maxPlaceholders");
  if (!Array.isArray(items)) throw new TypeError("items must be an array");

  const loaded = items.length;

  if (settled) {
    return frozen({
      phase: loaded === 0 ? LoadPhase.EMPTY : LoadPhase.COMPLETE,
      items,
      placeholders: 0,
      ariaBusy: false,
      announcement: loaded === 0
        ? "No games to show."
        : `${loaded} ${loaded === 1 ? "game" : "games"} loaded.`,
    });
  }

  const remaining = Math.max(0, expectedCount - loaded);
  return frozen({
    phase: loaded === 0 ? LoadPhase.SHELL : LoadPhase.PARTIAL,
    items,
    placeholders: Math.min(remaining, maxPlaceholders),
    ariaBusy: true,
    // Silence while loading: the busy state carries the meaning, and repeating
    // a count on every arrival would flood a screen reader.
    announcement: null,
  });
}

function frozen(value) {
  return Object.freeze({ ...value, items: Object.freeze([...value.items]) });
}

/**
 * Render a grid into `container` from a plan.
 *
 * `renderItem` builds one real tile. Placeholders are created here so they are
 * consistently inert and consistently hidden from assistive technology.
 */
export function applyProgressiveRender(container, plan, renderItem, {
  documentImpl = globalThis.document,
} = {}) {
  if (container == null || typeof container.replaceChildren !== "function") {
    throw new TypeError("container must be an element");
  }
  if (typeof renderItem !== "function") {
    throw new TypeError("renderItem must be a function");
  }

  const nodes = plan.items.map((item, index) => renderItem(item, index));
  for (let i = 0; i < plan.placeholders; i += 1) {
    const placeholder = documentImpl.createElement("li");
    placeholder.className = "tile-placeholder";
    // Decorative: it conveys "more is coming", which ariaBusy already says.
    placeholder.setAttribute("aria-hidden", "true");
    nodes.push(placeholder);
  }

  container.replaceChildren(...nodes);
  container.setAttribute("aria-busy", String(plan.ariaBusy));
  return plan;
}
