/**
 * Non-personalised game drawer.
 *
 * Compliance rule this module enforces, from AGENTS.md and the EU AI Act
 * guidance: predictor or recommendation output drives the cache only and must
 * never reach what the player sees. The drawer therefore offers exactly three
 * player-controlled views — favourites, recents, and search — and no ranked,
 * scored, or "picked for you" ordering exists anywhere in this file.
 *
 * The rule is enforced two ways rather than by convention:
 *   1. Items are projected onto a whitelist, so an upstream scoring field
 *      cannot reach the DOM even if one is present.
 *   2. Known predictor field names throw, so a future caller that tries to
 *      feed rankings into the drawer fails loudly instead of silently.
 */

export const DrawerView = Object.freeze({
  FAVOURITES: "FAVOURITES",
  RECENTS: "RECENTS",
  SEARCH: "SEARCH",
});

/** The only fields allowed to reach the rendered drawer. */
export const PLAYER_VISIBLE_FIELDS = Object.freeze(["id", "title", "provider"]);

/**
 * Field names that would indicate prediction output leaking into the player
 * view. Presence of any of these is a hard error.
 */
export const FORBIDDEN_FIELDS = Object.freeze([
  "score",
  "rank",
  "ranking",
  "predicted",
  "prediction",
  "recommendation",
  "recommended",
  "affinity",
  "propensity",
  "warmScore",
  "prefetchScore",
  "popularity",
  "personalised",
  "personalized",
]);

const forbidden = new Set(FORBIDDEN_FIELDS);

/**
 * Fold case and Croatian diacritics so a PSK player searching "zezel" finds
 * "Žeželj". Combining marks are stripped after NFD; đ/Đ do not decompose and
 * are mapped explicitly.
 */
export function normalizeSearchText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

function assertNoPredictorSignal(item, index) {
  for (const key of Object.keys(item)) {
    if (forbidden.has(key)) {
      throw new RangeError(
        `catalogue item ${index} carries predictor field "${key}"; `
        + "prediction output must never reach the player-visible drawer",
      );
    }
  }
}

/** Project onto the whitelist so nothing else can be rendered. */
function toPlayerVisible(item, index) {
  assertNoPredictorSignal(item, index);
  if (typeof item.id !== "string" || item.id.length === 0) {
    throw new TypeError(`catalogue item ${index} requires a non-empty id`);
  }
  if (typeof item.title !== "string" || item.title.length === 0) {
    throw new TypeError(`catalogue item ${index} requires a non-empty title`);
  }
  return Object.freeze({
    id: item.id,
    title: item.title,
    provider: typeof item.provider === "string" ? item.provider : "",
  });
}

function requireArray(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

/**
 * Build the drawer contents for one player-selected view.
 *
 * Ordering is deterministic and explainable in every view:
 *   FAVOURITES — the player's own most-recently-favourited first.
 *   RECENTS    — the player's own most-recently-played first.
 *   SEARCH     — text relevance only: title-prefix matches, then any
 *                substring match, alphabetical within each group.
 *
 * None of these consult a model, a score, or another player's behaviour.
 */
export function buildDrawer({
  catalogue = [],
  favourites = [],
  recents = [],
  query = "",
  view = DrawerView.FAVOURITES,
} = {}) {
  if (!Object.hasOwn(DrawerView, view)) {
    throw new RangeError(`unsupported drawer view: ${view}`);
  }
  requireArray(catalogue, "catalogue");
  requireArray(favourites, "favourites");
  requireArray(recents, "recents");

  const items = catalogue.map(toPlayerVisible);
  const byId = new Map(items.map((item) => [item.id, item]));

  if (view === DrawerView.FAVOURITES) {
    const ordered = [...favourites]
      .filter((entry) => byId.has(entry?.id))
      .sort((a, b) => (b.favouritedAt ?? 0) - (a.favouritedAt ?? 0))
      .map((entry) => byId.get(entry.id));
    return build(view, ordered, "NO_FAVOURITES");
  }

  if (view === DrawerView.RECENTS) {
    const ordered = [...recents]
      .filter((entry) => byId.has(entry?.id))
      .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
      .map((entry) => byId.get(entry.id));
    return build(view, ordered, "NO_RECENTS");
  }

  const needle = normalizeSearchText(query);
  if (needle.length === 0) return build(view, [], "EMPTY_QUERY");

  const prefix = [];
  const substring = [];
  for (const item of items) {
    const haystack = normalizeSearchText(item.title);
    if (haystack.startsWith(needle)) prefix.push(item);
    else if (haystack.includes(needle)) substring.push(item);
  }
  const alphabetical = (a, b) => a.title.localeCompare(b.title, "hr");
  prefix.sort(alphabetical);
  substring.sort(alphabetical);
  return build(view, [...prefix, ...substring], "NO_MATCHES");
}

function build(view, items, emptyReason) {
  return Object.freeze({
    view,
    items: Object.freeze(items),
    // Drives the empty-state message the drawer announces to screen readers.
    emptyReason: items.length === 0 ? emptyReason : null,
  });
}

/**
 * One-way intent seam: the drawer reports that a player dwelled on a tile so a
 * separate cache policy can act on it. Nothing is returned to the drawer and
 * no policy logic lives here — ordering above never consults this path.
 */
export function createIntentReporter(onIntent) {
  if (onIntent != null && typeof onIntent !== "function") {
    throw new TypeError("onIntent must be a function when provided");
  }
  return function reportIntent(gameId) {
    if (typeof gameId !== "string" || gameId.length === 0) return;
    if (onIntent) onIntent(Object.freeze({ gameId }));
  };
}
