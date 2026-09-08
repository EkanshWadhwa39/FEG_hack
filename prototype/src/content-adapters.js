/** Local fixtures implement the same interfaces as a future approved endpoint. */
export function createSyntheticManifestSource(catalogue) {
  const byId = new Map(catalogue.map(entry => [entry.id, entry]));
  return Object.freeze({ label: "SIMULATED", async resolve({ id }, { signal } = {}) {
    if (signal?.aborted) throw new Error("CANCELLED");
    const entry = byId.get(id);
    if (!entry) throw new Error("UNKNOWN_TITLE");
    return entry;
  } });
}

/** Explicit synthetic fixture, not an exclusion-register check or real permission. */
export function createSyntheticAuthorization(initialState = "UNKNOWN") {
  let state = initialState;
  const listeners = new Set();
  return Object.freeze({ label: "SIMULATED",
    async check({ signal } = {}) { if (signal?.aborted) throw new Error("CANCELLED"); return state; },
    isGranted: () => state === "GRANTED",
    setState(next) { state = next; for (const listener of listeners) listener(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
}

/** Live conservative browser capability boundary; no invented fast connection.
 * Long tasks block until a quiet interval. This is a SIMULATED conservative
 * threshold, not measured player performance. No background polling when idle.
 */
export function createBrowserEnvironment({ navigatorImpl = globalThis.navigator,
  documentImpl = globalThis.document, PerformanceObserverImpl = globalThis.PerformanceObserver,
  now = () => performance.now(), quietMs = 1000 } = {}) {
  const listeners = new Set();
  const connection = navigatorImpl?.connection;
  let busyUntil = 0;
  let observer;
  const notify = () => { for (const listener of listeners) listener(); };
  documentImpl?.addEventListener("visibilitychange", notify);
  connection?.addEventListener?.("change", notify);
  try {
    observer = new PerformanceObserverImpl(list => {
      if (list.getEntries().some(entry => entry.duration >= 50)) { busyUntil = now() + quietMs; notify(); }
    });
    observer.observe({ type: "longtask", buffered: false });
  } catch { /* Optional observation unsupported; connection/visibility still fail closed. */ }
  return Object.freeze({
    read: () => ({ saveData: connection?.saveData, effectiveType: connection?.effectiveType,
      visibilityState: documentImpl?.visibilityState, performanceBusy: now() < busyUntil }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { documentImpl?.removeEventListener("visibilitychange", notify); connection?.removeEventListener?.("change", notify); observer?.disconnect(); listeners.clear(); },
  });
}
