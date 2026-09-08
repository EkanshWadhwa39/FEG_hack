/** Cache-only synthetic policy. No DOM, storage, network or real player records. */
export const CandidatePolicy = Object.freeze({
  OFF: "OFF", FAVOURITE: "FAVOURITE", POPULAR_UNPLAYED: "POPULAR_UNPLAYED",
});

const policyLabels = Object.freeze({
  OFF: "Off", FAVOURITE: "Synthetic session favourite",
  POPULAR_UNPLAYED: "Synthetic popular unplayed",
});

const defaultIds = () => Array.from({ length: 20 }, (_, i) =>
  `title-${String(i + 1).padStart(2, "0")}`);

/**
 * Fit ONLY the measured aggregate (887 ranks, top-ten share 0.347).
 * Equal-rank quantile buckets are synthetic weights, NOT the popularity of
 * twenty real games. No title-level or player-level source data is consumed.
 */
export function createPopularityPrior({ catalogue } = {}) {
  const ids = catalogue ? catalogue.map(entry => entry.id) : defaultIds();
  if (ids.length !== 20 || new Set(ids).size !== 20) {
    throw new TypeError("Prior requires twenty distinct synthetic identities");
  }
  const rankCount = 887;
  const targetTop10Share = 0.347;
  const distribution = exponent => Array.from({ length: rankCount },
    (_, index) => (index + 1) ** -exponent);
  const sum = values => values.reduce((total, value) => total + value, 0);
  let lower = 0;
  let upper = 4;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const values = distribution(midpoint);
    if (sum(values.slice(0, 10)) / sum(values) < targetTop10Share) lower = midpoint;
    else upper = midpoint;
  }
  const exponent = (lower + upper) / 2;
  const values = distribution(exponent);
  const total = sum(values);
  const buckets = ids.map((gameId, index) => {
    const start = Math.floor(index * rankCount / ids.length);
    const end = Math.floor((index + 1) * rankCount / ids.length);
    return Object.freeze({ gameId, rankStart: start + 1, rankEnd: end,
      weight: sum(values.slice(start, end)) / total });
  });
  return Object.freeze({
    label: "SIMULATED", exponent, rankCount, targetTop10Share,
    calibratedTop10Share: sum(values.slice(0, 10)) / total,
    explanation: "SIMULATED equal-rank quantile weights, NOT real 20-game popularity; "
      + "Zipf calibrated only to the MEASURED aggregate: top 10 of 887 titles = 34.7% of launches.",
    buckets: Object.freeze(buckets),
    weights: Object.freeze(Object.fromEntries(buckets.map(({ gameId, weight }) => [gameId, weight]))),
  });
}

/** Fresh, memory-only session. Sequence numbers are synthetic, not timestamps. */
export function createSyntheticSession({ catalogue } = {}) {
  if (!Array.isArray(catalogue)) throw new TypeError("Synthetic catalogue required");
  const ids = catalogue.map(entry => entry.id);
  const allowed = new Set(ids);
  const plays = new Map();
  let sequence = 0;
  const snapshot = () => Object.freeze({ label: "SIMULATED",
    plays: Object.freeze(ids.filter(id => plays.has(id))
      .map(id => Object.freeze({ ...plays.get(id) }))),
  });
  return Object.freeze({ label: "SIMULATED", snapshot,
    recordPlayed(id) {
      if (!allowed.has(id)) return false;
      sequence += 1;
      plays.set(id, { id, count: (plays.get(id)?.count ?? 0) + 1, lastPlayedSequence: sequence });
      return true;
    },
  });
}

/** Pure selection: does not record plays or modify catalogue/player ordering. */
export function selectCandidate({ catalogue = [], session, policy = CandidatePolicy.OFF,
  intent, prior } = {}) {
  if (!catalogue.length || !Object.hasOwn(CandidatePolicy, policy)
      || policy === CandidatePolicy.OFF) return null;
  const result = (gameId, reason) => Object.freeze({ gameId, policy,
    policyLabel: policyLabels[policy], reason, label: "SIMULATED" });
  if (["HOVER_DWELL", "CLICK"].includes(intent?.kind)
      && catalogue.some(entry => entry.id === intent.gameId)) {
    return result(intent.gameId, intent.kind);
  }
  const state = typeof session?.snapshot === "function" ? session.snapshot() : session;
  const plays = new Map((state?.plays ?? [])
    .filter(play => Number.isSafeInteger(play.count) && play.count > 0)
    .map(play => [play.id, play]));
  let chosen = null;
  if (policy === CandidatePolicy.FAVOURITE) {
    for (const { id } of catalogue) {
      const play = plays.get(id);
      if (!play) continue;
      if (!chosen || play.count > chosen.count || (play.count === chosen.count
          && (play.lastPlayedSequence ?? 0) > (chosen.lastPlayedSequence ?? 0))) chosen = play;
    }
    return chosen ? result(chosen.id, "MOST_PLAYED") : null;
  }
  const weights = (prior ?? createPopularityPrior({ catalogue })).weights;
  let highest = -Infinity;
  for (const { id } of catalogue) {
    const weight = Object.hasOwn(weights, id) ? weights[id] : NaN;
    if (!plays.has(id) && Number.isFinite(weight) && weight > 0 && weight > highest) {
      chosen = id;
      highest = weight;
    }
  }
  return chosen ? result(chosen, "HIGHEST_WEIGHT_UNPLAYED") : null;
}
