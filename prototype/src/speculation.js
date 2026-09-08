/**
 * The speculation ladder.
 *
 * Before this module existed, the sandbox had two disconnected speculation
 * mechanisms: byte warming that only ran when a human clicked a "Warm now"
 * button, and engine pre-initialisation that ran automatically at 600 ms of
 * dwell. In practice that meant hover-driven warming never happened at all,
 * and the only thing hovering did was spend fifty megabytes on a whole engine.
 * All-or-nothing, with nothing in between.
 *
 * This replaces both with one graduated ladder. Speculation gets more expensive
 * as the evidence of intent gets stronger, so a glance costs a DNS lookup and
 * only a deliberate rest on a tile costs an engine:
 *
 * | rung      | trigger                | cost                       | wasted if wrong |
 * |-----------|------------------------|----------------------------|-----------------|
 * | `CONNECT` | first sight of a tile  | DNS + TCP + TLS, no bytes  | nothing         |
 * | `WARM`    | short dwell (~200 ms)  | blocking profile, ~2.8 MB  | 2.8 MB          |
 * | `PREINIT` | sustained dwell/commit | a live engine, ~50 MB      | 50 MB + GPU     |
 *
 * Three properties the tests pin down:
 *
 *   - **Authorisation gates every rung, not just the reveal.** The exclusion
 *     register decides whether this player may be shown a game at all. Warming
 *     a title for a self-excluded player is speculative work on a launch that
 *     must never happen, so it fails closed here as well.
 *   - **The engine rung requires the FULL governor tier.** A browser we cannot
 *     interrogate, or a 3g link, gets bytes and never an engine.
 *   - **Budget is charged for what is actually spent.** The engine rung is
 *     charged the whole package, not the warm profile. The previous code
 *     budgeted 2.8 MB and then spent 50 MB, which made the budget decorative.
 *
 * The module is pure: it reads a snapshot and returns actions. The page
 * performs them. That keeps every threshold and refusal testable without a
 * browser.
 */

import { SpeculationTier } from "./governor.js";

export const Rung = Object.freeze({
  NONE: "NONE",
  CONNECT: "CONNECT",
  WARM: "WARM",
  PREINIT: "PREINIT",
});

export const SpeculationAction = Object.freeze({
  PREWARM_CONNECTION: "PREWARM_CONNECTION",
  WARM_BYTES: "WARM_BYTES",
  PREPARE_ENGINE: "PREPARE_ENGINE",
  CANCEL_ENGINE: "CANCEL_ENGINE",
});

export const RefusalReason = Object.freeze({
  AUTHORIZATION: "AUTHORIZATION",
  GOVERNOR: "GOVERNOR",
  NO_INTENT: "NO_INTENT",
  TIER_TOO_LOW: "TIER_TOO_LOW",
  BUDGET: "BUDGET",
  ALREADY_DONE: "ALREADY_DONE",
});

/** Dwell at which cheap byte warming starts. */
export const WARM_DWELL_MS = 200;

/** Dwell at which a whole engine becomes defensible. */
export const PREINIT_DWELL_MS = 600;

/**
 * Dwell below which an in-flight engine is reclaimed. Deliberately lower than
 * PREINIT_DWELL_MS: tearing an engine down the instant the pointer wobbles off
 * a tile and rebuilding it when it wobbles back is worse than keeping it.
 */
export const PREINIT_RELEASE_MS = 250;

/** How many titles may hold warmed bytes at once. */
export const MAX_WARM_CANDIDATES = 3;

function asFiniteNonNegative(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Decide what speculation should be happening right now.
 *
 * @param candidates     ranked dwell output: `[{ gameId, score }]`, strongest first
 * @param committed      a game the player has actually touched down on
 *                       (`pointerdown`). Treated as maximum-strength intent:
 *                       the tap has already begun, so there is nothing left to
 *                       predict and no waste to fear.
 * @param authorization  `"GRANTED"` or anything else, which refuses
 * @param governor       result of `assessPrefetch`
 * @param connected      game ids whose origin already has transport hints
 * @param warmed         game ids whose blocking profile is already requested
 * @param preinit        `{ state, gameId }` from the pre-init manager
 * @param costs          `{ warmBytes, engineBytes }` for the title in question
 * @param budget         `{ byteBudget, bytesUsed }`
 */
export function planSpeculation({
  candidates = [],
  committed = null,
  authorization = "UNKNOWN",
  governor = null,
  connected = [],
  warmed = [],
  preinit = null,
  costs = null,
  budget = null,
  warmDwellMs = WARM_DWELL_MS,
  preinitDwellMs = PREINIT_DWELL_MS,
  preinitReleaseMs = PREINIT_RELEASE_MS,
  maxWarmCandidates = MAX_WARM_CANDIDATES,
} = {}) {
  const refuse = (reason, actions = []) => Object.freeze({
    rung: Rung.NONE,
    target: null,
    actions: Object.freeze(actions),
    refusedBecause: reason,
    // The ladder never orders, filters or badges anything the player sees.
    playerVisible: false,
  });

  const preinitState = preinit?.state ?? "IDLE";
  const preinitGameId = preinit?.gameId ?? null;
  const engineLive = preinitState === "PREPARING" || preinitState === "PREPARED";

  // Fail closed. Denial, timeout, malformed response and unknown all land here,
  // and an engine already in flight is torn down rather than left running.
  if (authorization !== "GRANTED") {
    return refuse(
      RefusalReason.AUTHORIZATION,
      engineLive ? [{ action: SpeculationAction.CANCEL_ENGINE, gameId: preinitGameId }] : [],
    );
  }
  if (governor == null || governor.allowed !== true) {
    return refuse(
      RefusalReason.GOVERNOR,
      engineLive ? [{ action: SpeculationAction.CANCEL_ENGINE, gameId: preinitGameId }] : [],
    );
  }

  const ranked = candidates
    .filter((entry) => typeof entry?.gameId === "string" && Number.isFinite(entry.score));
  // A touch-down outranks every hover score: the player is already tapping it,
  // so both the accumulated and the present-moment measures are maximal.
  const top = committed != null
    ? { gameId: committed, score: Infinity, currentMs: Infinity }
    : ranked[0] ?? null;

  if (top == null) {
    return refuse(
      RefusalReason.NO_INTENT,
      engineLive ? [{ action: SpeculationAction.CANCEL_ENGINE, gameId: preinitGameId }] : [],
    );
  }

  const actions = [];
  const connectedSet = new Set(connected);
  const warmedSet = new Set(warmed);

  // Rung 1 — transport. Free, so it is offered to every ranked candidate, not
  // only the strongest: a preconnect that turns out to be wrong costs a socket
  // the browser would have opened anyway.
  for (const entry of committed != null ? [top, ...ranked] : ranked) {
    if (!connectedSet.has(entry.gameId)) {
      actions.push({ action: SpeculationAction.PREWARM_CONNECTION, gameId: entry.gameId });
      connectedSet.add(entry.gameId);
    }
  }

  const warmBytes = asFiniteNonNegative(costs?.warmBytes, 0);
  const engineBytes = asFiniteNonNegative(costs?.engineBytes, 0);
  const byteBudget = asFiniteNonNegative(budget?.byteBudget, Infinity);
  const bytesUsed = asFiniteNonNegative(budget?.bytesUsed, 0);
  const affordable = (bytes) => bytesUsed + bytes <= byteBudget;

  // An engine already in flight for this exact title has been billed already.
  // Charging it a second time on the next tick would make a prepared engine
  // look unaffordable and quietly demote the ladder back down a rung.
  const alreadyBilled = engineLive && preinitGameId === top.gameId;
  // The engine rung reads *present* dwell, not accumulated. A pointer crossing
  // a rail deposits a little accumulated dwell on every tile it passes, and a
  // few passes would otherwise be enough for a tile nobody ever stopped on to
  // buy itself a whole engine. `currentMs` is zero the moment the pointer
  // leaves, so this rung can only ever be reached by standing still on a tile.
  const presentMs = Number.isFinite(top.currentMs) || top.currentMs === Infinity
    ? top.currentMs
    : top.score;
  const preinitReady = presentMs >= preinitDwellMs
    && governor.tier === SpeculationTier.FULL
    && (alreadyBilled || affordable(engineBytes));

  // Rung 3 — engine. Checked before rung 2 because a prepared engine fetches
  // the whole package itself, which makes separately warming the same title's
  // blocking profile duplicated work.
  if (preinitReady) {
    if (preinitGameId === top.gameId && engineLive) {
      return Object.freeze({
        rung: Rung.PREINIT,
        target: top.gameId,
        actions: Object.freeze(actions),
        refusedBecause: RefusalReason.ALREADY_DONE,
        playerVisible: false,
      });
    }
    actions.push({
      action: SpeculationAction.PREPARE_ENGINE,
      gameId: top.gameId,
      estimatedBytes: engineBytes,
    });
    return Object.freeze({
      rung: Rung.PREINIT,
      target: top.gameId,
      actions: Object.freeze(actions),
      refusedBecause: null,
      playerVisible: false,
    });
  }

  // Intent has decayed below the hold threshold, or moved to another title, so
  // give the memory back rather than holding a whole engine on a guess. Release
  // reads accumulated dwell deliberately: a prepared engine should survive the
  // pointer wandering off for a moment, even though it took a deliberate rest
  // to earn in the first place.
  if (engineLive && (top.score < preinitReleaseMs || preinitGameId !== top.gameId)) {
    actions.push({ action: SpeculationAction.CANCEL_ENGINE, gameId: preinitGameId });
  }

  // Rung 2 — bytes. Cheap enough to hedge across the strongest few candidates,
  // which is the whole point of having a rung between free and expensive.
  if (top.score >= warmDwellMs) {
    let spend = bytesUsed;
    let warmedCount = warmedSet.size;
    for (const entry of committed != null ? [top, ...ranked] : ranked) {
      if (warmedCount >= maxWarmCandidates) break;
      if (warmedSet.has(entry.gameId)) continue;
      if (entry.score < warmDwellMs && entry.gameId !== top.gameId) continue;
      if (spend + warmBytes > byteBudget) break;
      actions.push({
        action: SpeculationAction.WARM_BYTES,
        gameId: entry.gameId,
        estimatedBytes: warmBytes,
      });
      warmedSet.add(entry.gameId);
      warmedCount += 1;
      spend += warmBytes;
    }

    const warming = actions.some((entry) => entry.action === SpeculationAction.WARM_BYTES);
    // A target whose bytes are already resident has reached the WARM rung, even
    // though this tick issued no request. Reporting CONNECT there would make a
    // successful warm look like a failure the moment it finished.
    const atWarmRung = warming || warmedSet.has(top.gameId);
    return Object.freeze({
      rung: atWarmRung ? Rung.WARM : Rung.CONNECT,
      target: top.gameId,
      actions: Object.freeze(actions),
      refusedBecause: warming
        ? null
        : (warmedSet.has(top.gameId) ? RefusalReason.ALREADY_DONE : RefusalReason.BUDGET),
      playerVisible: false,
    });
  }

  return Object.freeze({
    rung: actions.length > 0 ? Rung.CONNECT : Rung.NONE,
    target: top.gameId,
    actions: Object.freeze(actions),
    refusedBecause: actions.length > 0 ? null : RefusalReason.NO_INTENT,
    playerVisible: false,
  });
}

/**
 * Running total of speculative bytes, so the governor's budget is charged for
 * what was really spent rather than what was planned.
 *
 * Charges are recorded per game and per rung and never charged twice, because
 * the ladder is re-evaluated several times a second and a naive counter would
 * exhaust the budget in a few ticks without a single extra byte being fetched.
 */
export function createByteLedger({ byteBudget = 96 * 1_048_576 } = {}) {
  if (!Number.isFinite(byteBudget) || byteBudget < 0) {
    throw new RangeError("byteBudget must be a non-negative finite number");
  }
  const charges = new Map();

  const key = (gameId, rung) => `${rung}:${gameId}`;

  return Object.freeze({
    byteBudget,

    /** Record a spend. Returns true when it was new, false when already charged. */
    charge(gameId, rung, bytes) {
      if (typeof gameId !== "string" || gameId.length === 0) return false;
      if (!Number.isFinite(bytes) || bytes < 0) return false;
      const id = key(gameId, rung);
      if (charges.has(id)) return false;
      charges.set(id, bytes);
      return true;
    },

    /** Give bytes back when an engine is torn down before it finished. */
    refund(gameId, rung) {
      return charges.delete(key(gameId, rung));
    },

    bytesUsed() {
      let total = 0;
      for (const bytes of charges.values()) total += bytes;
      return total;
    },

    remaining() {
      return Math.max(0, byteBudget - this.bytesUsed());
    },

    reset() {
      charges.clear();
    },
  });
}
