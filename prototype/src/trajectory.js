/**
 * Where the pointer is going, before it gets there.
 *
 * Dwell only starts counting once the cursor is already on a tile. But a
 * deliberate move across a lobby takes 200-400 ms, and for most of that time
 * the destination is already obvious from the direction and speed of travel.
 * Starting the free rung -- and only the free rung -- against the predicted
 * destination buys that whole traversal back.
 *
 * ### Why this is safe to be wrong about
 *
 * A wrong prediction opens a socket to an origin the player did not visit. That
 * is a connection the browser would very likely have opened anyway, and it
 * transfers nothing. The rungs that actually cost something -- bytes, and an
 * engine -- are never reachable from a prediction; they still require the
 * cursor to arrive and stay. So the ladder's expensive decisions remain driven
 * by evidence, and only the free decision is driven by a guess.
 *
 * ### The method
 *
 * Sample the pointer, fit a direction from the recent samples, and project
 * forward by the time it would take to cross the remaining distance. A tile is
 * the predicted destination when the projected ray lands inside it *and* the
 * pointer is actually moving toward it rather than away.
 *
 * Three refusals keep it from firing on noise:
 *
 *   - **Too slow.** Below a minimum speed the cursor is browsing, not
 *     travelling, and the direction is dominated by jitter.
 *   - **Too turbulent.** If recent samples disagree about direction, the player
 *     is circling or hesitating and there is no destination to predict.
 *   - **Too far.** Beyond a projection horizon the error cone is wider than a
 *     tile and the answer would be arbitrary.
 */

/** Samples kept for the direction fit. Enough to smooth, few enough to be current. */
export const SAMPLE_WINDOW = 5;

/** Below this, in px/ms, the pointer is browsing rather than travelling. */
export const MIN_SPEED_PX_PER_MS = 0.35;

/** How far ahead to project, in milliseconds of travel. */
export const PROJECTION_MS = 220;

/**
 * Maximum angular disagreement across the sample window, in radians, before the
 * movement is treated as turbulent. ~34 degrees.
 */
export const MAX_TURBULENCE = 0.6;

function direction(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? null : { x: dx / length, y: dy / length, length };
}

/**
 * Fit a heading to a series of pointer samples.
 *
 * @param samples `[{ x, y, t }]`, oldest first
 * @returns `{ x, y, speed }` unit heading and px/ms, or null when unusable
 */
export function fitHeading(samples, {
  minSpeed = MIN_SPEED_PX_PER_MS,
  maxTurbulence = MAX_TURBULENCE,
} = {}) {
  if (!Array.isArray(samples) || samples.length < 3) return null;

  const first = samples[0];
  const last = samples[samples.length - 1];
  if (![first, last].every((s) => Number.isFinite(s?.x) && Number.isFinite(s?.y)
    && Number.isFinite(s?.t))) {
    return null;
  }

  const elapsed = last.t - first.t;
  if (!(elapsed > 0)) return null;

  const overall = direction(first, last);
  if (overall == null) return null;

  const speed = overall.length / elapsed;
  if (speed < minSpeed) return null;

  // Turbulence: does each leg agree with the overall heading?
  for (let i = 1; i < samples.length; i += 1) {
    const leg = direction(samples[i - 1], samples[i]);
    if (leg == null) continue;
    const dot = Math.max(-1, Math.min(1, leg.x * overall.x + leg.y * overall.y));
    if (Math.acos(dot) > maxTurbulence) return null;
  }

  return Object.freeze({ x: overall.x, y: overall.y, speed });
}

/**
 * Distance along a ray at which it enters a box, or null if it never does.
 *
 * The standard slab method. Using ray/box intersection rather than "does the
 * projected end point land inside a tile" matters: with a fixed horizon, an end
 * point test only ever finds tiles at almost exactly the projected distance and
 * sails straight past the nearer ones the pointer is obviously about to cross.
 */
function rayEntry(origin, heading, box) {
  let near = -Infinity;
  let far = Infinity;

  for (const [start, direction_, low, high] of [
    [origin.x, heading.x, box.left, box.right],
    [origin.y, heading.y, box.top, box.bottom],
  ]) {
    if (Math.abs(direction_) < 1e-9) {
      // Parallel to this slab: it can only ever be inside it.
      if (start < low || start > high) return null;
      continue;
    }
    const t1 = (low - start) / direction_;
    const t2 = (high - start) / direction_;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  if (near > far || far < 0) return null;
  return near;
}

/**
 * Which tile the pointer is heading for.
 *
 * @param samples pointer samples, oldest first
 * @param targets `[{ gameId, left, top, right, bottom }]` in the same coordinate
 *                space as the samples
 */
export function predictDestination(samples, targets, {
  projectionMs = PROJECTION_MS,
  minSpeed = MIN_SPEED_PX_PER_MS,
  maxTurbulence = MAX_TURBULENCE,
} = {}) {
  if (!Array.isArray(targets) || targets.length === 0) return null;
  const heading = fitHeading(samples, { minSpeed, maxTurbulence });
  if (heading == null) return null;

  const origin = samples[samples.length - 1];
  const reach = heading.speed * projectionMs;

  let best = null;
  let bestDistance = Infinity;
  for (const target of targets) {
    if (typeof target?.gameId !== "string" || target.gameId.length === 0) continue;
    const { left, top, right, bottom } = target;
    if (![left, top, right, bottom].every(Number.isFinite)) continue;

    const entry = rayEntry(origin, heading, { left, top, right, bottom });
    // `entry <= 0` is the tile the pointer is already inside or leaving. Dwell
    // already covers that one; prediction is only about where it is going next.
    if (entry == null || entry <= 0 || entry > reach) continue;

    if (entry < bestDistance) {
      best = target.gameId;
      bestDistance = entry;
    }
  }
  return best;
}

/**
 * Stateful sampler. Feed it pointer moves; ask it where the player is going.
 *
 * Holds at most `window` samples and nothing else — no identifier, no history,
 * nothing persisted or transmitted.
 */
export function createTrajectoryTracker({
  window: windowSize = SAMPLE_WINDOW,
  now = () => (globalThis.performance?.now?.() ?? Date.now()),
  ...options
} = {}) {
  if (!Number.isInteger(windowSize) || windowSize < 3) {
    throw new RangeError("window must be an integer of at least 3");
  }
  let samples = [];

  return Object.freeze({
    sample(x, y, t = now()) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      samples = [...samples, { x, y, t }].slice(-windowSize);
    },

    /** @param targets tile rectangles in the same coordinate space as samples */
    predict(targets) {
      return predictDestination(samples, targets, options);
    },

    reset() {
      samples = [];
    },
  });
}
