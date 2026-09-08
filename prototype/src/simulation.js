/**
 * Create a local-only requester for the scaffold. It deliberately ignores the
 * asset URL and performs no fetch, navigation, or provider request.
 */
export function createSimulatedRequester({
  delayMs = 140,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new TypeError("delayMs must be a non-negative finite number");
  }
  if (typeof sleep !== "function") throw new TypeError("sleep must be a function");

  return async function simulateRequest() {
    await sleep(delayMs);
  };
}
