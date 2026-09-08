const MAX_CONCURRENCY = 2;
const ALLOWED_STAGES = new Set(["PRELOADER", "COMMON", "SPLASH", "PRIMARY"]);
const UNRESOLVED_VARIANT = /\$\{(?:locale|language|tier|resolution)\}|\{(?:locale|language|tier|resolution)\}|@\{resolution\}/i;

export const WarmStatus = Object.freeze({
  REQUESTED: "REQUESTED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
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

function summarize(results) {
  return Object.freeze({
    attempted: results.filter(Boolean).length,
    requested: results.filter((result) => result?.status === WarmStatus.REQUESTED).length,
    failed: results.filter((result) => result?.status === WarmStatus.FAILED).length,
    cancelled: results.filter((result) => result?.status === WarmStatus.CANCELLED).length,
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
 */
export async function warmAssets({
  plan,
  target,
  requestAsset,
  concurrency = MAX_CONCURRENCY,
  signal,
} = {}) {
  validatePlan(plan, target);
  if (typeof requestAsset !== "function") {
    throw new TypeError("requestAsset must be a function");
  }
  validateConcurrency(concurrency);

  const results = new Array(plan.assets.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < plan.assets.length) {
      if (signal?.aborted) return;

      const index = nextIndex;
      nextIndex += 1;
      const asset = plan.assets[index];
      const status = await settleRequest(
        () => requestAsset(asset.url, {
          signal,
          stage: asset.stage,
          estimatedBytes: asset.estimatedBytes,
        }),
        signal,
      );
      if (status == null) return;
      results[index] = Object.freeze({ index, stage: asset.stage, status });
    }
  }

  const workerCount = Math.min(concurrency, plan.assets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return summarize(results);
}
