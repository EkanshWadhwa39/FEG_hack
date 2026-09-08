const MAX_CONCURRENCY = 2;
const ALLOWED_STAGES = new Set(["PRELOADER", "COMMON", "SPLASH", "PRIMARY"]);
const UNRESOLVED_VARIANT = /\$\{(?:locale|language|tier|resolution)\}|\{(?:locale|language|tier|resolution)\}|@\{resolution\}/i;

/** Consumption order of the staged bundle. Dispatch never crosses these bands. */
const STAGE_BAND = Object.freeze({
  PRELOADER: 0,
  COMMON: 1,
  SPLASH: 2,
  PRIMARY: 3,
});

export const WarmStatus = Object.freeze({
  REQUESTED: "REQUESTED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  SKIPPED: "SKIPPED",
});

function requireRecord(value, name) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireExactString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be an exact non-empty string`);
  }
}

function validatePlan(plan, target) {
  requireRecord(plan, "plan");
  requireRecord(target, "target");
  requireExactString(plan.locale, "plan.locale");
  requireExactString(plan.tier, "plan.tier");
  requireExactString(target.locale, "target.locale");
  requireExactString(target.tier, "target.tier");

  if (plan.locale !== target.locale || plan.tier !== target.tier) {
    throw new RangeError("resolved plan does not match the requested locale and tier");
  }
  if (!Array.isArray(plan.assets)) throw new TypeError("plan.assets must be an array");

  plan.assets.forEach((asset, index) => {
    requireRecord(asset, `asset ${index}`);
    requireExactString(asset.url, `asset ${index}.url`);
    if (UNRESOLVED_VARIANT.test(asset.url)) {
      throw new RangeError(`asset ${index} URL contains an unresolved locale or tier`);
    }
    if (!ALLOWED_STAGES.has(asset.stage)) {
      throw new RangeError(`asset ${index} has a prohibited stage`);
    }
    if (!Number.isFinite(asset.estimatedBytes) || asset.estimatedBytes < 0) {
      throw new TypeError(`asset ${index} requires non-negative estimatedBytes`);
    }
    if (asset.stage === "PRIMARY" && asset.critical !== true) {
      throw new RangeError(`asset ${index} PRIMARY must be proven critical`);
    }
  });
}

function validateConcurrency(concurrency) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new RangeError(`concurrency must be an integer from 1 to ${MAX_CONCURRENCY}`);
  }
}

function validateLedger(ledger) {
  if (ledger == null) return;
  if (typeof ledger.has !== "function" || typeof ledger.add !== "function") {
    throw new TypeError("ledger must provide has and add");
  }
}

/**
 * Order dispatch by stage band, then by descending size within each band.
 *
 * Bands are never reordered against each other. The game consumes
 * PRELOADER -> COMMON -> SPLASH -> PRIMARY, so pulling a later band forward
 * would lower total makespan while raising the unwarmed critical bytes a
 * player faces if they click mid-warm, and it is the second quantity that
 * decides whether warming helped. Within a band the largest asset goes first,
 * which keeps a small object from being stranded behind a large one on a
 * two-worker pool.
 *
 * Returns indices into the original asset array so results stay addressable by
 * the caller's own ordering.
 */
function dispatchOrder(assets) {
  return assets
    .map((_asset, index) => index)
    .sort((left, right) => {
      const band = STAGE_BAND[assets[left].stage] - STAGE_BAND[assets[right].stage];
      if (band !== 0) return band;
      const size = assets[right].estimatedBytes - assets[left].estimatedBytes;
      if (size !== 0) return size;
      return left - right;
    });
}

function summarize(results) {
  return Object.freeze({
    attempted: results.filter(Boolean).length,
    requested: results.filter((result) => result?.status === WarmStatus.REQUESTED).length,
    failed: results.filter((result) => result?.status === WarmStatus.FAILED).length,
    cancelled: results.filter((result) => result?.status === WarmStatus.CANCELLED).length,
    skipped: results.filter((result) => result?.status === WarmStatus.SKIPPED).length,
    results: Object.freeze(results.filter(Boolean)),
  });
}

function settleRequest(startRequest, signal) {
  if (!signal) {
    return Promise.resolve()
      .then(startRequest)
      .then(() => WarmStatus.REQUESTED, () => WarmStatus.FAILED);
  }
  if (signal.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(status);
    };
    const onAbort = () => finish(WarmStatus.CANCELLED);

    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(startRequest)
      .then(
        () => finish(signal.aborted ? WarmStatus.CANCELLED : WarmStatus.REQUESTED),
        () => finish(signal.aborted ? WarmStatus.CANCELLED : WarmStatus.FAILED),
      );
  });
}

/**
 * Request an exact, resolved manifest with a hard concurrency ceiling.
 *
 * A fulfilled request is REQUESTED, not a proven cache hit. Only later browser
 * evidence can establish cache admission and parent-to-iframe reuse. Returned
 * results omit URLs and error text to avoid leaking sensitive request details.
 *
 * An optional session ledger suppresses a repeat request for an exact URL this
 * page has already warmed, which is what makes hovering several titles from one
 * provider cost one COMMON fetch rather than several.
 */
export async function warmAssets({
  plan,
  target,
  requestAsset,
  concurrency = MAX_CONCURRENCY,
  signal,
  ledger,
} = {}) {
  validatePlan(plan, target);
  if (typeof requestAsset !== "function") {
    throw new TypeError("requestAsset must be a function");
  }
  validateConcurrency(concurrency);
  validateLedger(ledger);

  const results = new Array(plan.assets.length);
  const order = dispatchOrder(plan.assets);
  let nextPosition = 0;

  async function worker() {
    while (nextPosition < order.length) {
      if (signal?.aborted) return;

      const index = order[nextPosition];
      nextPosition += 1;
      const asset = plan.assets[index];

      if (ledger?.has(asset.url)) {
        results[index] = Object.freeze({
          index,
          stage: asset.stage,
          status: WarmStatus.SKIPPED,
        });
        continue;
      }

      const status = await settleRequest(
        () => requestAsset(asset.url, {
          signal,
          stage: asset.stage,
          estimatedBytes: asset.estimatedBytes,
        }),
        signal,
      );
      if (status == null) return;
      if (status === WarmStatus.REQUESTED) ledger?.add(asset.url);
      results[index] = Object.freeze({ index, stage: asset.stage, status });
    }
  }

  const workerCount = Math.min(concurrency, plan.assets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return summarize(results);
}
