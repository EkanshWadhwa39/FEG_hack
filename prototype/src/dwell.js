/**
 * Dwell tracking — how long a player lingers on a game tile.
 *
 * This is a CACHE signal. It selects what to warm and never changes what the
 * player is shown: the drawer renders favourites, recents and search, in the
 * player's own order, regardless of anything measured here.
 *
 * Two deliberate properties:
 *
 *   - Keyboard focus counts exactly like pointer hover. A keyboard or
 *     switch-device user expresses the same intent and must get the same
 *     faster launch; treating only the mouse as intent would make the feature
 *     quietly worse for assistive-technology users.
 *   - Dwell decays. Interest expressed thirty seconds ago is weaker evidence
 *     than interest expressed now, and without decay a long session would
 *     accumulate a stale ranking that never moves.
 *
 * No dwell data is persisted, transmitted, or associated with a player
 * identifier. It lives in memory for the length of the page.
 */

/** Below this, a pointer crossing a tile is travel, not interest. */
export const MINIMUM_DWELL_MS = 150;

/** Dwell weight halves over this period. */
export const DWELL_HALF_LIFE_MS = 30_000;

/** Bound on tracked tiles, so a long browse cannot grow without limit. */
export const MAX_TRACKED = 50;

export function createDwellTracker({
  now = () => Date.now(),
  minimumDwellMs = MINIMUM_DWELL_MS,
  halfLifeMs = DWELL_HALF_LIFE_MS,
  maxTracked = MAX_TRACKED,
} = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function");
  for (const [name, value] of Object.entries({ minimumDwellMs, halfLifeMs, maxTracked })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive finite number`);
    }
  }

  /** gameId -> { totalMs, lastSeenAt } */
  const totals = new Map();
  /** gameId -> entry timestamp, for tiles currently under pointer or focus. */
  const open = new Map();

  function decayed(entry, at) {
    const age = Math.max(0, at - entry.lastSeenAt);
    return entry.totalMs * 0.5 ** (age / halfLifeMs);
  }

  function evictIfNeeded() {
    if (totals.size <= maxTracked) return;
    // Drop the least recently reinforced entry.
    let oldestId = null;
    let oldestAt = Infinity;
    for (const [gameId, entry] of totals) {
      if (entry.lastSeenAt < oldestAt) {
        oldestAt = entry.lastSeenAt;
        oldestId = gameId;
      }
    }
    if (oldestId != null) totals.delete(oldestId);
  }

  return Object.freeze({
    /** Pointer entered, or the tile received keyboard focus. */
    enter(gameId) {
      if (typeof gameId !== "string" || gameId.length === 0) return;
      if (!open.has(gameId)) open.set(gameId, now());
    },

    /** Pointer left, or focus moved away. Credits the elapsed dwell. */
    leave(gameId) {
      if (typeof gameId !== "string" || gameId.length === 0) return;
      const startedAt = open.get(gameId);
      if (startedAt == null) return;
      open.delete(gameId);

      const at = now();
      const elapsed = at - startedAt;
      // A brief pass-over is not interest and is discarded entirely.
      if (elapsed < minimumDwellMs) return;

      const existing = totals.get(gameId);
      const carried = existing ? decayed(existing, at) : 0;
      totals.set(gameId, { totalMs: carried + elapsed, lastSeenAt: at });
      evictIfNeeded();
    },

    /**
     * Ranked candidates, strongest first. Tiles still open are included with
     * the dwell accumulated so far, so a player hovering right now counts.
     *
     * Two numbers per candidate, and the distinction matters:
     *
     *   - `score` is decayed *accumulated* dwell across the session. It answers
     *     "has this title held their attention", which is the right question
     *     for spending a few megabytes.
     *   - `currentMs` is the *uninterrupted* dwell happening right now, and is
     *     zero for a tile the pointer has left. It answers "are they looking at
     *     this, this instant", which is the only question worth answering
     *     before spending a whole engine.
     *
     * Without the second number, a pointer travelling across a rail of tiles
     * deposits a little accumulated dwell on each one, and a few passes are
     * enough for a tile nobody ever stopped on to out-rank everything and buy
     * itself an engine.
     */
    snapshot() {
      const at = now();
      const scores = new Map();
      const current = new Map();

      for (const [gameId, entry] of totals) {
        scores.set(gameId, decayed(entry, at));
      }
      for (const [gameId, startedAt] of open) {
        const elapsed = at - startedAt;
        if (elapsed < minimumDwellMs) continue;
        scores.set(gameId, (scores.get(gameId) ?? 0) + elapsed);
        current.set(gameId, elapsed);
      }

      return Object.freeze([...scores.entries()]
        .map(([gameId, score]) => Object.freeze({
          gameId,
          score: Math.round(score),
          currentMs: Math.round(current.get(gameId) ?? 0),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.gameId.localeCompare(b.gameId)));
    },

    /** The single strongest candidate, or null when nothing qualifies. */
    strongest() {
      return this.snapshot()[0] ?? null;
    },

    reset() {
      totals.clear();
      open.clear();
    },
  });
}
