export const GovernorReason = Object.freeze({
  ALLOWED: "ALLOWED",
  DISABLED: "DISABLED",
  SAVE_DATA: "SAVE_DATA",
  SLOW_CONNECTION: "SLOW_CONNECTION",
  CONNECTION_UNKNOWN: "CONNECTION_UNKNOWN",
  PAGE_HIDDEN: "PAGE_HIDDEN",
  VISIBILITY_UNKNOWN: "VISIBILITY_UNKNOWN",
  BUDGET_INVALID: "BUDGET_INVALID",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
});

const FAST_EFFECTIVE_TYPES = new Set(["4g"]);

function result(allowed, reason, byteBudget, bytesUsed, nextAssetBytes) {
  const validBudget = Number.isFinite(byteBudget) && byteBudget >= 0;
  const validUsed = Number.isFinite(bytesUsed) && bytesUsed >= 0;
  const remainingBytes = validBudget && validUsed
    ? Math.max(0, byteBudget - bytesUsed)
    : 0;

  return Object.freeze({
    allowed,
    reason,
    remainingBytes,
    projectedBytes: validUsed && Number.isFinite(nextAssetBytes) && nextAssetBytes >= 0
      ? bytesUsed + nextAssetBytes
      : null,
  });
}

/**
 * Pure policy evaluation. Unknown browser/network inputs fail closed so callers
 * cannot accidentally spend speculative bytes without an explicit safe state.
 */
export function assessPrefetch({
  enabled,
  saveData,
  effectiveType,
  visibilityState,
  byteBudget,
  bytesUsed,
  nextAssetBytes,
} = {}) {
  const decide = (allowed, reason) =>
    result(allowed, reason, byteBudget, bytesUsed, nextAssetBytes);

  if (enabled !== true) return decide(false, GovernorReason.DISABLED);

  if (visibilityState == null) {
    return decide(false, GovernorReason.VISIBILITY_UNKNOWN);
  }
  if (visibilityState !== "visible") {
    return decide(false, GovernorReason.PAGE_HIDDEN);
  }

  if (saveData == null || effectiveType == null) {
    return decide(false, GovernorReason.CONNECTION_UNKNOWN);
  }
  if (saveData === true) return decide(false, GovernorReason.SAVE_DATA);
  if (saveData !== false || !FAST_EFFECTIVE_TYPES.has(effectiveType)) {
    return decide(false, GovernorReason.SLOW_CONNECTION);
  }

  const budgetValues = [byteBudget, bytesUsed, nextAssetBytes];
  if (budgetValues.some((value) => !Number.isFinite(value) || value < 0)) {
    return decide(false, GovernorReason.BUDGET_INVALID);
  }
  if (bytesUsed + nextAssetBytes > byteBudget) {
    return decide(false, GovernorReason.BUDGET_EXCEEDED);
  }

  return decide(true, GovernorReason.ALLOWED);
}
