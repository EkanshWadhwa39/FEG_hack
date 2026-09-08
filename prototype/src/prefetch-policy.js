/**
 * Which game to warm, and whether to warm at all.
 *
 * Two signals, in this order:
 *
 *   1. DWELL — the player is lingering on a tile right now. This is expressed
 *      intent about the launch that is about to happen, and it is the only
 *      signal that can be right about a game the player has never opened.
 *   2. RECENT — the player's own most recently launched title this session.
 *      Measured at 30.4% hit@1 on 3,337 real launch sequences, which beat a
 *      collaborative next-title model by 2.7x and global popularity by 5.5x
 *      (see docs/PREFETCH-POLICY.md).
 *
 * There is deliberately no collaborative filtering, no similarity model, and no
 * cross-player inference. The measurement said the simple signal wins, and the
 * simple signal also needs no profiling — so this module reads nothing about
 * other players and builds no profile of this one.
 *
 * k defaults to 1 because the same measurement showed extra candidates are not
 * worth their bytes: k=1 to k=5 buys 20 points of hit rate for 5x the transfer,
 * and even the best policy wastes more than it saves when warming a full bundle.
 *
 * Output is CACHE-ONLY. It never orders, filters, badges, or otherwise touches
 * what the player sees. `playerVisible: false` is part of the contract.
 */

export const WarmReason = Object.freeze({
  DWELL: "DWELL",
  RECENT: "RECENT",
  NOTHING_TO_WARM: "NOTHING_TO_WARM",
});

/** Measured conclusion: warm one title, not a basket. */
export const DEFAULT_K = 1;

/** Above 3 the waste is indefensible at any hit rate we measured. */
export const MAX_K = 3;

function normalizeIds(values, key) {
  if (!Array.isArray(values)) throw new TypeError(`${key} must be an array`);
  const ids = [];
  for (const value of values) {
    const id = typeof value === "string" ? value : value?.gameId;
    if (typeof id === "string" && id.length > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Choose up to k titles to warm.
 *
 * @param dwellCandidates ranked output of createDwellTracker().snapshot()
 * @param recents         player's own launches this session, most recent first
 * @param alreadyWarm     titles already in cache; never warmed twice
 */
export function selectWarmCandidates({
  dwellCandidates = [],
  recents = [],
  alreadyWarm = [],
  k = DEFAULT_K,
} = {}) {
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) {
    throw new RangeError(`k must be an integer from 1 to ${MAX_K}`);
  }

  const warmed = new Set(normalizeIds(alreadyWarm, "alreadyWarm"));
  const dwell = normalizeIds(dwellCandidates, "dwellCandidates")
    .filter((id) => !warmed.has(id));
  const recent = normalizeIds(recents, "recents")
    .filter((id) => !warmed.has(id));

  const picks = [];
  const reasons = [];
  for (const [source, ids] of [[WarmReason.DWELL, dwell], [WarmReason.RECENT, recent]]) {
    for (const id of ids) {
      if (picks.length >= k) break;
      if (picks.includes(id)) continue;
      picks.push(id);
      reasons.push(source);
    }
  }

  return Object.freeze({
    candidates: Object.freeze(picks),
    // Reason for the top pick; the whole list is available in `sources`.
    reason: reasons[0] ?? WarmReason.NOTHING_TO_WARM,
    sources: Object.freeze(reasons),
    k,
    // Read by the view layer as a refusal: this must not reach the player.
    playerVisible: false,
  });
}
