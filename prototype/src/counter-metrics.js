/**
 * Counter-metric stubs: stake velocity and time on device.
 *
 * These exist to answer a question the latency work must not dodge — does
 * making games faster to reach also make play more intense? They are a
 * harm-detection signal for the operator and compliance reviewers.
 *
 * They are deliberately NOT player-facing. Rendering stake velocity to a
 * player during a transition would read as an engagement cue, which is the
 * kind of nudge the no-dark-patterns rule exists to prevent.
 *
 * The `read` seam is the single thing a real integration replaces; the shape
 * below is what the operator view consumes, so swapping the source in later
 * needs no restructuring.
 */

import { Provenance, formatDuration } from "./rg-state.js";

export const ReviewFlag = Object.freeze({
  NORMAL: "NORMAL",
  ELEVATED: "ELEVATED",
  UNKNOWN: "UNKNOWN",
});

/**
 * Fraction above baseline stake velocity that marks a session for operator
 * review. Deliberately conservative: this is a prompt to look, not a verdict.
 */
export const ELEVATED_VELOCITY_FRACTION = 0.25;

/** Synthetic operator record used when no real source is supplied. */
export const SYNTHETIC_COUNTER_RECORD = Object.freeze({
  sessionStartedAt: 0,
  stakedMinorUnits: 4_250,
  baselineVelocityMinorUnitsPerMinute: 60,
});

export function createCounterMetrics({
  now = () => Date.now(),
  read = () => SYNTHETIC_COUNTER_RECORD,
  provenance = Provenance.SIMULATED,
  elevatedFraction = ELEVATED_VELOCITY_FRACTION,
} = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (typeof read !== "function") throw new TypeError("read must be a function");
  if (!Object.hasOwn(Provenance, provenance)) {
    throw new RangeError(`unsupported provenance: ${provenance}`);
  }
  if (!Number.isFinite(elevatedFraction) || elevatedFraction < 0) {
    throw new RangeError("elevatedFraction must be a non-negative finite number");
  }

  const unknown = Object.freeze({
    provenance: Provenance.UNKNOWN,
    available: false,
    playerFacing: false,
    timeOnDeviceMs: null,
    timeOnDevice: "0:00:00",
    stakeVelocityPerMinute: null,
    baselineVelocityPerMinute: null,
    deltaFraction: null,
    reviewFlag: ReviewFlag.UNKNOWN,
  });

  return function readCounterMetrics() {
    const record = read();
    if (record == null || typeof record !== "object") return unknown;

    const { sessionStartedAt, stakedMinorUnits, baselineVelocityMinorUnitsPerMinute } = record;
    if (!Number.isInteger(sessionStartedAt) || !Number.isInteger(stakedMinorUnits)) {
      return unknown;
    }

    const timeOnDeviceMs = Math.max(0, now() - sessionStartedAt);
    const minutes = timeOnDeviceMs / 60_000;
    // Below a few seconds the velocity figure is noise, not a signal.
    const stakeVelocityPerMinute = minutes >= 0.05
      ? Math.round(stakedMinorUnits / minutes)
      : null;

    const baseline = Number.isFinite(baselineVelocityMinorUnitsPerMinute)
      && baselineVelocityMinorUnitsPerMinute > 0
      ? baselineVelocityMinorUnitsPerMinute
      : null;

    let deltaFraction = null;
    let reviewFlag = ReviewFlag.UNKNOWN;
    if (stakeVelocityPerMinute != null && baseline != null) {
      deltaFraction = (stakeVelocityPerMinute - baseline) / baseline;
      reviewFlag = deltaFraction > elevatedFraction ? ReviewFlag.ELEVATED : ReviewFlag.NORMAL;
    }

    return Object.freeze({
      provenance,
      available: true,
      // Read by the view layer as a refusal to render this in player UI.
      playerFacing: false,
      timeOnDeviceMs,
      timeOnDevice: formatDuration(timeOnDeviceMs),
      stakeVelocityPerMinute,
      baselineVelocityPerMinute: baseline,
      deltaFraction,
      reviewFlag,
    });
  };
}
