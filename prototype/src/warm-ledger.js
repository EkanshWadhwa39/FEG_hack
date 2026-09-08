/**
 * Session-scoped record of exact URLs already warmed.
 *
 * Keys are the exact URL string as it appeared in the resolved manifest. They
 * are never normalized, lowercased, sorted, or stripped of query parameters:
 * the browser cache key is the exact URL, so a normalized ledger key would
 * report a hit for an object that was never actually warmed.
 *
 * The ledger holds URLs only for the lifetime of the page. It is not
 * persisted, not keyed by player, and never exposed in a warming result.
 */
export function createWarmLedger() {
  const warmed = new Set();

  return Object.freeze({
    has(exactUrl) {
      return warmed.has(exactUrl);
    },
    add(exactUrl) {
      if (typeof exactUrl !== "string" || exactUrl.length === 0) {
        throw new TypeError("ledger key must be an exact non-empty string");
      }
      warmed.add(exactUrl);
    },
    get size() {
      return warmed.size;
    },
  });
}
