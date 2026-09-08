import { assessPrefetch } from "./governor.js";
import { resolvePreparationIdentity } from "./manifest.js";
import { warmAssets } from "./warmer.js";
import { selectCandidate } from "./candidate-policy.js";

const POLICIES = new Set(["OFF", "FAVOURITE", "POPULAR_UNPLAYED"]);
const result = (status, fields = {}) => Object.freeze({ label: "SIMULATED", status, ...fields });

/** Bounded async boundary. Late endpoint responses never authorize stale work. */
function bounded(operation, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error, value) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new Error("CANCELLED"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(new Error("TIMEOUT")), timeoutMs);
    Promise.resolve().then(operation).then(v => finish(null, v), e => finish(e));
  });
}

/** Content-only orchestration; NEVER reads/writes player DOM or returns recommendations
 * to a player renderer. Results are operator telemetry on a SIMULATED catalogue.
 *
 * Adapters: manifestSource.resolve(target,{signal}), requestAsset(url,options)
 * with validateUrl(url), authorization.check({purpose,signal}) + isGranted()
 * + required subscribe(listener), environment.read() + optional subscribe(listener).
 * Swap adapters, not callers. Real authorization must implement live revocation.
 */
export function createContentLoader({ catalogue, session, prior, manifestSource, requestAsset,
  authorization, environment, byteBudget, policy = "OFF", operationTimeoutMs = 5000 } = {}) {
  if (!POLICIES.has(policy)) throw new RangeError("unsupported preparation policy");
  if (!Array.isArray(catalogue) || catalogue.length !== 20) throw new TypeError("exactly 20 synthetic entries required");
  if (!Number.isSafeInteger(byteBudget) || byteBudget < 0) throw new RangeError("invalid session budget");
  if (!Number.isFinite(operationTimeoutMs) || operationTimeoutMs <= 0 || operationTimeoutMs > 60000) throw new RangeError("invalid operation timeout");
  if (typeof manifestSource?.resolve !== "function" || typeof requestAsset !== "function"
      || typeof requestAsset.validateUrl !== "function" || typeof authorization?.check !== "function"
      || typeof authorization.isGranted !== "function" || typeof authorization.subscribe !== "function"
      || typeof environment?.read !== "function") {
    throw new TypeError("explicit content-loading adapters required");
  }
  let enabled = false;
  let disposed = false;
  let foreground = false;
  let active;
  let launchController;
  let chargedBytes = 0;
  let observedBodyBytes = 0;
  let overrun = false;
  const completed = new Set(); // metadata dedupe, NOT an asset/custom cache
  const pendingRequests = new Set();
  const idSet = new Set(catalogue.map(entry => entry.id));

  function eligibility(nextAssetBytes = 0) {
    let state;
    try { state = environment.read(); } catch { state = {}; }
    if (state?.performanceBusy === true) return { allowed: false, reason: "FOREGROUND_BUSY" };
    if (overrun) return { allowed: false, reason: "BODY_BOUND_EXCEEDED" };
    return assessPrefetch({ ...state, enabled: enabled && !disposed && !foreground,
      byteBudget, bytesUsed: chargedBytes, nextAssetBytes });
  }
  function isGranted() {
    try { return authorization.isGranted() === true; } catch { return false; }
  }
  function cancel() { active?.controller.abort(); }
  function cancelLaunch() { launchController?.abort(); }
  function reconcile() {
    if (!isGranted() || !eligibility().allowed) cancel();
    if (!isGranted()) launchController?.abort();
  }
  const unsubscribeAuthorization = authorization.subscribe(reconcile);
  if (typeof unsubscribeAuthorization !== "function") throw new TypeError("live authorization subscription required");
  const unsubscribeEnvironment = environment.subscribe?.(reconcile);

  async function resolve(target, controller) {
    const manifest = await bounded(() => manifestSource.resolve(target, { signal: controller.signal }),
      controller.signal, operationTimeoutMs);
    return resolvePreparationIdentity(manifest, target, { validateUrl: requestAsset.validateUrl });
  }
  async function authorize(purpose, controller) {
    try {
      const state = await bounded(() => authorization.check({ purpose, signal: controller.signal }),
        controller.signal, operationTimeoutMs);
      return !controller.signal.aborted && state === "GRANTED" && isGranted();
    } catch { return false; }
  }
  function snapshot() {
    return result("STATE", { policy, enabled, foreground, disposed,
      reservedBodyBytes: chargedBytes, observedBodyBytes, byteBudget,
      bodyBoundExceeded: overrun, completedObjects: completed.size });
  }

  async function run(candidate, target, controller) {
    const fields = { candidate };
    try {
      if (!await authorize("PREPARE", controller)) return result("AUTHORIZATION_BLOCKED", fields);
      let plan;
      try { plan = await resolve(target, controller); }
      catch { return result(controller.signal.aborted ? "CANCELLED" : "IDENTITY_UNRESOLVED", fields); }
      if (controller.signal.aborted || !isGranted()) return result("CANCELLED", fields);
      const assets = plan.assets.filter(asset => !completed.has(asset.url));
      const bytes = assets.reduce((sum, asset) => sum + asset.estimatedBytes, 0);
      const decision = eligibility(bytes);
      if (!decision.allowed) return result("GOVERNOR_BLOCKED", { ...fields, reason: decision.reason });
      if (!assets.length) return result("ALREADY_REQUESTED", fields);
      // Reserve atomically BEFORE workers start. Retain reservations on failure,
      // cancellation and unstarted remainder: never treat unknown transfer as free.
      chargedBytes += bytes;
      const summary = await warmAssets({ plan: { ...plan, assets }, target, signal: controller.signal,
        concurrency: 2, requestAsset: async (url, options) => {
          if (controller.signal.aborted || !isGranted() || !eligibility().allowed) {
            controller.abort(); throw new Error("GOVERNOR_REVOKED");
          }
          const work = (async () => {
            let assetBytes = 0;
            const response = await requestAsset(url, { ...options, onBytes: count => {
              if (!Number.isSafeInteger(count) || count < 0) { overrun = true; controller.abort(); return; }
              observedBodyBytes += count; assetBytes += count;
              if (assetBytes > options.estimatedBytes) { overrun = true; controller.abort(); }
            } });
            if (controller.signal.aborted || response?.completed !== true) throw new Error("BODY_INCOMPLETE");
            completed.add(url);
          })();
          pendingRequests.add(work);
          try { await work; } finally { pendingRequests.delete(work); }
        } });
      return result(controller.signal.aborted ? "CANCELLED" : summary.failed ? "PARTIAL_FAILURE" : "REQUESTS_COMPLETE",
        { ...fields, summary, accounting: snapshot(), cacheReuse: "UNKNOWN" });
    } finally { controller.abort(); if (active?.controller === controller) active = undefined; }
  }

  function prepare({ intent, build, locale, tier } = {}) {
    if (disposed || foreground) return Promise.resolve(result("DISABLED"));
    const candidate = selectCandidate({ catalogue, session: session.snapshot(), prior, policy, intent });
    if (!candidate) { cancel(); return Promise.resolve(result("NO_CANDIDATE")); }
    const id = candidate.gameId;
    const target = Object.freeze({ id, build, locale, tier });
    const key = JSON.stringify([id, build, locale, tier]);
    if (!eligibility().allowed) {
      cancel(); return Promise.resolve(result("GOVERNOR_BLOCKED", { reason: eligibility().reason }));
    }
    if (active?.key === key && !active.controller.signal.aborted && isGranted()) return active.promise;
    cancel();
    const controller = new AbortController();
    const entry = { key, controller };
    active = entry;
    entry.promise = run(candidate, target, controller);
    return entry.promise;
  }

  /** Click is known intent, but foreground launch MUST NOT start new speculation.
   * The UI awaits this grant and then launches normally with the returned exact plan.
   * It must never launch on a blocked/malformed result. No iframe/UI code lives here.
   */
  async function beginLaunch({ gameId, build, locale, tier } = {}) {
    cancel(); launchController?.abort(); foreground = true;
    if (disposed || !idSet.has(gameId)) return result("LAUNCH_BLOCKED");
    const controller = new AbortController(); launchController = controller;
    const candidate = selectCandidate({ catalogue, session: session.snapshot(), prior, policy,
      intent: { gameId, kind: "CLICK" } });
    const blocked = status => { controller.abort(); return result(status); };
    if (!await authorize("LAUNCH", controller)) return blocked("AUTHORIZATION_BLOCKED");
    let plan;
    try { plan = await resolve({ id: gameId, build, locale, tier }, controller); }
    catch { return blocked("IDENTITY_UNRESOLVED"); }
    // Give cancelled full-body requests time to settle before foreground work.
    try { await bounded(() => Promise.allSettled([...pendingRequests]), controller.signal, operationTimeoutMs); }
    catch { return blocked("LAUNCH_BLOCKED"); }
    if (controller.signal.aborted || !isGranted()) return blocked("AUTHORIZATION_BLOCKED");
    return result("LAUNCH_AUTHORIZED", { plan, candidate, signal: controller.signal });
  }

  return Object.freeze({ prepare, beginLaunch, snapshot, cancel, cancelLaunch,
    setEnabled(value) { enabled = value === true; if (!enabled) cancel(); },
    setPolicy(value) { if (!POLICIES.has(value)) throw new RangeError("unsupported preparation policy"); cancel(); policy = value; },
    resumeBrowsing() { launchController?.abort(); foreground = false; },
    recordPlayed(gameId) { return session.recordPlayed(gameId); },
    dispose() { disposed = true; cancel(); launchController?.abort(); unsubscribeEnvironment?.(); unsubscribeAuthorization?.(); },
  });
}
