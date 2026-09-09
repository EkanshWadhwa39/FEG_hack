/**
 * Responsible-gambling state shown on the transition screen.
 *
 * Every reading carries a `provenance` label, so a caller cannot render a
 * value without also having its label to hand. That keeps the repository's
 * MEASURED / SIMULATED / UNKNOWN discipline structural rather than editorial.
 *
 * The default source is synthetic. A real source is swapped in by passing
 * `read`, with no other change to callers.
 *
 * Wording rule applied here: headroom is expressed neutrally as limit
 * remaining. It is never framed as spending capacity ("you can still stake
 * X"), which would read as an inducement.
 */

export const Provenance = Object.freeze({
  MEASURED: "MEASURED",
  SIMULATED: "SIMULATED",
  UNKNOWN: "UNKNOWN",
});

export const LimitState = Object.freeze({
  OK: "OK",
  NEAR_LIMIT: "NEAR_LIMIT",
  REACHED: "REACHED",
});

/** Headroom at or below this fraction of the limit is flagged NEAR_LIMIT. */
export const NEAR_LIMIT_FRACTION = 0.2;

const EUR = new Intl.NumberFormat("hr-HR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Synthetic session used whenever no real source is supplied. */
export const SYNTHETIC_SESSION = Object.freeze({
  sessionStartedAt: 0,
  stakedMinorUnits: 4_250,
  returnedMinorUnits: 3_100,
  limitMinorUnits: 5_000,
});

function requireInteger(value, name) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer number of minor units`);
  }
  return value;
}

/** Format minor units as EUR with an explicit sign for non-zero values. */
export function formatMinorUnits(minorUnits) {
  requireInteger(minorUnits, "minorUnits");
  const formatted = EUR.format(Math.abs(minorUnits) / 100);
  if (minorUnits > 0) return `+${formatted}`;
  if (minorUnits < 0) return `−${formatted}`;
  return formatted;
}

/** Format an elapsed duration as H:MM:SS, saturating rather than going negative. */
export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "0:00:00";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Build a labelled RG reading.
 *
 * `read` returns the raw session record and is the single seam a real
 * integration replaces. `provenance` describes that source honestly.
 */
export function createRgState({
  now = () => Date.now(),
  read = () => SYNTHETIC_SESSION,
  provenance = Provenance.SIMULATED,
} = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (typeof read !== "function") throw new TypeError("read must be a function");
  if (!Object.hasOwn(Provenance, provenance)) {
    throw new RangeError(`unsupported provenance: ${provenance}`);
  }

  return function readRgState() {
    const session = read();
    if (session == null || typeof session !== "object") {
      // An unusable source must degrade to UNKNOWN, never to a confident zero.
      return Object.freeze({
        provenance: Provenance.UNKNOWN,
        available: false,
        sessionDuration: "0:00:00",
        netPosition: null,
        limitState: LimitState.OK,
        limitRemainingMinorUnits: null,
        limitRemaining: null,
      });
    }

    const staked = requireInteger(session.stakedMinorUnits, "stakedMinorUnits");
    const returned = requireInteger(session.returnedMinorUnits, "returnedMinorUnits");
    const limit = requireInteger(session.limitMinorUnits, "limitMinorUnits");
    const startedAt = requireInteger(session.sessionStartedAt, "sessionStartedAt");

    const netMinorUnits = returned - staked;
    const remaining = Math.max(0, limit - staked);
    const fractionLeft = limit > 0 ? remaining / limit : 0;

    let limitState = LimitState.OK;
    if (remaining === 0) limitState = LimitState.REACHED;
    else if (fractionLeft <= NEAR_LIMIT_FRACTION) limitState = LimitState.NEAR_LIMIT;

    return Object.freeze({
      provenance,
      available: true,
      sessionDuration: formatDuration(now() - startedAt),
      netPosition: formatMinorUnits(netMinorUnits),
      netPositionMinorUnits: netMinorUnits,
      limitState,
      limitRemainingMinorUnits: remaining,
      // Neutral phrasing: what remains of the limit, never spending capacity.
      limitRemaining: EUR.format(remaining / 100),
    });
  };
}
