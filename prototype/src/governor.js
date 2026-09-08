/**
 * Speculation governor.
 *
 * Two things it decides, and they are deliberately separate:
 *
 *   1. **May we speculate at all?** Save-Data, a hidden page, an exhausted
 *      budget and an explicit disable all stop everything.
 *   2. **How far may we go?** Not every allowed environment can afford an
 *      engine instance. `tier` answers that, and the caller reads it to pick
 *      which rung of the speculation ladder it is allowed to climb.
 *
 * ### Why a REDUCED tier exists
 *
 * The Network Information API (`navigator.connection`) is **Chromium-only**.
 * Firefox and every browser on iOS do not implement it, so `saveData` and
 * `effectiveType` are not missing because something went wrong — they are
 * missing because the browser has no such API. An earlier version of this file
 * treated both cases as CONNECTION_UNKNOWN and refused, which silently disabled
 * warming for every non-Chromium player. That is not conservatism, it is a bug:
 * the feature appeared to work in the browser it was developed in and did
 * nothing everywhere else.
 *
 * So the two cases are now distinguished by an explicit caller assertion:
 *
 *   - `connectionApiAvailable: false` — the browser has no API. Degrade to
 *     REDUCED: cheap byte warming within a small budget, never an engine.
 *   - API present but a value is missing or unreadable — still refuse. Present
 *     and broken is a different, more suspicious thing than absent.
 *
 * ### Why 3g is REDUCED rather than blocked
 *
 * A slow link is where moving bytes off the click path helps most: the transfer
 * still has to happen, and doing it during browse is strictly better than doing
 * it after the tap. What a slow link cannot afford is *waste*, so 3g gets the
 * small blocking profile and never a speculative engine. Metered intent is
 * carried by Save-Data, which still blocks everything.
 */

export const GovernorReason = Object.freeze({
  ALLOWED: "ALLOWED",
  ALLOWED_DEGRADED: "ALLOWED_DEGRADED",
  DISABLED: "DISABLED",
  SAVE_DATA: "SAVE_DATA",
  SLOW_CONNECTION: "SLOW_CONNECTION",
  CONNECTION_UNKNOWN: "CONNECTION_UNKNOWN",
  PAGE_HIDDEN: "PAGE_HIDDEN",
  VISIBILITY_UNKNOWN: "VISIBILITY_UNKNOWN",
  BUDGET_INVALID: "BUDGET_INVALID",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
});

/**
 * How far speculation may go.
 *
 *   NONE    — nothing at all.
 *   REDUCED — transport hints and cheap byte warming. No engine instance.
 *   FULL    — everything, including speculative engine pre-initialisation.
 */
export const SpeculationTier = Object.freeze({
  NONE: "NONE",
  REDUCED: "REDUCED",
  FULL: "FULL",
});

/** Effective types that can afford a full engine instance. */
const FULL_TIER_EFFECTIVE_TYPES = new Set(["4g"]);

/** Effective types worth warming bytes on, but not an engine. */
const REDUCED_TIER_EFFECTIVE_TYPES = new Set(["3g"]);

/** Ceiling applied when the browser cannot describe its own connection. */
export const DEGRADED_BYTE_BUDGET = 8 * 1_048_576;

function result(allowed, reason, tier, byteBudget, bytesUsed, nextAssetBytes) {
  const validBudget = Number.isFinite(byteBudget) && byteBudget >= 0;
  const validUsed = Number.isFinite(bytesUsed) && bytesUsed >= 0;
  const remainingBytes = validBudget && validUsed
    ? Math.max(0, byteBudget - bytesUsed)
    : 0;

  return Object.freeze({
    allowed,
    reason,
    tier,
    remainingBytes,
    projectedBytes: validUsed && Number.isFinite(nextAssetBytes) && nextAssetBytes >= 0
      ? bytesUsed + nextAssetBytes
      : null,
  });
}

/**
 * Pure policy evaluation.
 *
 * @param enabled                 operator/player switch; anything but `true` refuses
 * @param saveData                `navigator.connection.saveData`
 * @param effectiveType           `navigator.connection.effectiveType`
 * @param connectionApiAvailable  pass `false` only when the browser has no
 *                                Network Information API. Omitting it keeps the
 *                                old fail-closed behaviour for missing values.
 * @param visibilityState         `document.visibilityState`
 * @param byteBudget              per-session speculative byte ceiling
 * @param bytesUsed               speculative bytes already spent this session
 * @param nextAssetBytes          what this decision would additionally spend
 */
export function assessPrefetch({
  enabled,
  saveData,
  effectiveType,
  connectionApiAvailable,
  visibilityState,
  byteBudget,
  bytesUsed,
  nextAssetBytes,
} = {}) {
  const decide = (allowed, reason, tier, budget = byteBudget) =>
    result(allowed, reason, tier, budget, bytesUsed, nextAssetBytes);

  if (enabled !== true) return decide(false, GovernorReason.DISABLED, SpeculationTier.NONE);

  if (visibilityState == null) {
    return decide(false, GovernorReason.VISIBILITY_UNKNOWN, SpeculationTier.NONE);
  }
  if (visibilityState !== "visible") {
    return decide(false, GovernorReason.PAGE_HIDDEN, SpeculationTier.NONE);
  }

  // Save-Data is a direct instruction from the player and outranks everything
  // below, including the capability-degraded path.
  if (saveData === true) return decide(false, GovernorReason.SAVE_DATA, SpeculationTier.NONE);

  let tier;
  let reason;
  let effectiveBudget = byteBudget;

  if (connectionApiAvailable === false) {
    // No API in this browser. Not an error, and not a reason to do nothing.
    tier = SpeculationTier.REDUCED;
    reason = GovernorReason.ALLOWED_DEGRADED;
    effectiveBudget = Number.isFinite(byteBudget)
      ? Math.min(byteBudget, DEGRADED_BYTE_BUDGET)
      : byteBudget;
  } else if (saveData == null || effectiveType == null) {
    // The API is present but will not answer. Refuse.
    return decide(false, GovernorReason.CONNECTION_UNKNOWN, SpeculationTier.NONE);
  } else if (saveData !== false) {
    return decide(false, GovernorReason.CONNECTION_UNKNOWN, SpeculationTier.NONE);
  } else if (FULL_TIER_EFFECTIVE_TYPES.has(effectiveType)) {
    tier = SpeculationTier.FULL;
    reason = GovernorReason.ALLOWED;
  } else if (REDUCED_TIER_EFFECTIVE_TYPES.has(effectiveType)) {
    tier = SpeculationTier.REDUCED;
    reason = GovernorReason.ALLOWED_DEGRADED;
    effectiveBudget = Number.isFinite(byteBudget)
      ? Math.min(byteBudget, DEGRADED_BYTE_BUDGET)
      : byteBudget;
  } else {
    // 2g, slow-2g, or anything unrecognised.
    return decide(false, GovernorReason.SLOW_CONNECTION, SpeculationTier.NONE);
  }

  const budgetValues = [effectiveBudget, bytesUsed, nextAssetBytes];
  if (budgetValues.some((value) => !Number.isFinite(value) || value < 0)) {
    return decide(false, GovernorReason.BUDGET_INVALID, SpeculationTier.NONE, effectiveBudget);
  }
  if (bytesUsed + nextAssetBytes > effectiveBudget) {
    return decide(false, GovernorReason.BUDGET_EXCEEDED, SpeculationTier.NONE, effectiveBudget);
  }

  return decide(true, reason, tier, effectiveBudget);
}

/**
 * Read the browser's connection capability without assuming it exists.
 *
 * Returns the exact shape `assessPrefetch` expects, including the explicit
 * `connectionApiAvailable: false` that unlocks the degraded tier. Kept here so
 * every caller reports capability the same way instead of each page inventing
 * its own guess.
 */
export function readConnectionCapability(navigatorImpl = globalThis.navigator) {
  const connection = navigatorImpl?.connection
    ?? navigatorImpl?.mozConnection
    ?? navigatorImpl?.webkitConnection;

  if (connection == null) {
    return Object.freeze({
      connectionApiAvailable: false,
      saveData: undefined,
      effectiveType: undefined,
    });
  }
  return Object.freeze({
    connectionApiAvailable: true,
    saveData: connection.saveData,
    effectiveType: connection.effectiveType,
  });
}
