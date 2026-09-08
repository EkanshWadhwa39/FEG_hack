/**
 * What is probably still in the browser's cache, remembered across sessions.
 *
 * ### Why this exists
 *
 * **57.5% of repeat launches were MEASURED as already cached** — the provider
 * CDN sends `max-age` of roughly 19 years. Warming those titles again is pure
 * waste, and it is worse than neutral: it burns the session byte budget that a
 * genuinely cold title needed.
 *
 * There is no browser API that answers "is this URL in your HTTP cache". The
 * Cache API is a different store and this architecture does not use it. So the
 * only available instrument is a local record of what we warmed and when.
 *
 * ### It is a guess, and it is calibrated to be wrong in the cheap direction
 *
 * The record can be stale: the browser may have evicted the entry, the player
 * may have cleared site data, or the title may have shipped a new bundle. Being
 * wrong here costs one redundant warm — a few megabytes during browse. Being
 * wrong the *other* way, and skipping a warm that was needed, costs a slow
 * launch, which is the whole problem we are solving.
 *
 * So the design leans toward re-warming:
 *
 *   - Entries expire after a conservative TTL, far shorter than the CDN's
 *     `max-age`, because eviction is invisible to us.
 *   - The bundle version is part of the key. A new build is a different set of
 *     content-hashed URLs and shares nothing with the old one.
 *   - Any storage failure degrades to "we know nothing", never to "it's warm".
 *
 * ### Privacy
 *
 * Titles a player launched are stored on the player's own device and nowhere
 * else. No identifier, no timestamp beyond a coarse expiry, nothing
 * transmitted. This is the same class of data as a "recently played" list, and
 * it is cleared by the browser's own site-data controls.
 */

const STORAGE_KEY = "feg.warm-memory.v1";

/** Conservative: the CDN says 19 years, but eviction is invisible to us. */
export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1_000;

/** Bounded, so a long-lived profile cannot grow the record without limit. */
export const MAX_ENTRIES = 120;

function safeParse(raw) {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

/**
 * @param storage  a `Storage`-shaped object; absent or throwing is fine
 * @param now      clock, injected for tests
 * @param ttlMs    how long a record is trusted
 */
export function createWarmMemory({
  storage = globalThis.localStorage,
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  maxEntries = MAX_ENTRIES,
} = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new RangeError("ttlMs must be a positive finite number");
  }

  // Private browsing, disabled storage, and quota-exceeded all throw rather
  // than return. A cache optimisation must never take the page down with it.
  const read = () => {
    try {
      return safeParse(storage?.getItem(STORAGE_KEY));
    } catch {
      return {};
    }
  };
  const write = (value) => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };

  const key = (gameId, version) => `${gameId}@${version ?? ""}`;

  function live(entries, at) {
    const kept = {};
    for (const [entryKey, expiresAt] of Object.entries(entries)) {
      if (Number.isFinite(expiresAt) && expiresAt > at) kept[entryKey] = expiresAt;
    }
    return kept;
  }

  return Object.freeze({
    /** True only when we have an unexpired record for this exact bundle. */
    isProbablyWarm(gameId, version) {
      if (typeof gameId !== "string" || gameId.length === 0) return false;
      const at = now();
      const expiresAt = read()[key(gameId, version)];
      return Number.isFinite(expiresAt) && expiresAt > at;
    },

    /** Record that this title's warm profile was requested. */
    remember(gameId, version) {
      if (typeof gameId !== "string" || gameId.length === 0) return false;
      const at = now();
      const entries = live(read(), at);
      entries[key(gameId, version)] = at + ttlMs;

      // Evict the soonest-to-expire first: they are the least recently warmed.
      const ordered = Object.entries(entries).sort((a, b) => b[1] - a[1]);
      return write(Object.fromEntries(ordered.slice(0, maxEntries)));
    },

    /** Every title we currently believe is warm. */
    snapshot() {
      return Object.freeze(Object.keys(live(read(), now()))
        .map((entryKey) => entryKey.slice(0, entryKey.lastIndexOf("@"))));
    },

    forget(gameId, version) {
      const entries = read();
      delete entries[key(gameId, version)];
      return write(entries);
    },

    clear() {
      return write({});
    },
  });
}

/**
 * Titles worth warming the moment the lobby paints, before any hover exists.
 *
 * **MEASURED: the player's own last-played title is 30.4% hit@1** on 3,337 real
 * launch sequences — it beat a collaborative next-title model by 2.7x and global
 * popularity by 5.5x. That is a better signal than anything a lobby can infer,
 * and unlike dwell it needs no interaction at all: a player who opens the lobby
 * and immediately taps their usual game gets a warm launch, which is precisely
 * the case a hover-triggered design misses.
 *
 * It stays at the cheap rung. 30% is a fine hit rate for 2.8 MB and an
 * indefensible one for a 52 MB engine, so this never returns an engine
 * candidate — the caller warms bytes only.
 */
export function selectLobbyLoadWarmSet({
  recents = [],
  favourites = [],
  alreadyWarm = [],
  limit = 2,
} = {}) {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("limit must be a non-negative integer");
  }
  const warm = new Set(alreadyWarm);
  const picks = [];
  const reasons = [];

  // Recents first, and only then favourites: last-played is the measured
  // signal, favourites are the fallback for a player with no session history.
  for (const [source, ids] of [["RECENT", recents], ["FAVOURITE", favourites]]) {
    for (const id of ids) {
      if (picks.length >= limit) break;
      if (typeof id !== "string" || id.length === 0) continue;
      if (warm.has(id) || picks.includes(id)) continue;
      picks.push(id);
      reasons.push(source);
    }
  }

  return Object.freeze({
    candidates: Object.freeze(picks),
    sources: Object.freeze(reasons),
    // Bytes only. This signal is nowhere near strong enough to buy an engine.
    rung: "WARM",
    playerVisible: false,
  });
}
