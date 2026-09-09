const ALLOWED_STAGES = new Set(["PRELOADER", "COMMON", "SPLASH", "PRIMARY"]);
const READY_STAGES = new Set(["PRELOADER", "COMMON", "SPLASH"]);
// An id must be an opaque token, not a locator. Rejecting every path-shaped
// character keeps a URL, query string, or locale segment from reaching a
// telemetry record, which carries stage, bytes, and timestamps only.
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function defaultNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function requireAssetId(id) {
  if (typeof id === "string") {
    if (id.length === 0) throw new TypeError("asset id must be a non-empty string");
    if (!OPAQUE_ID.test(id)) {
      throw new RangeError("asset id must be an opaque token, not a path or URL");
    }
    return;
  }
  if (typeof id === "number") {
    if (!Number.isFinite(id)) throw new TypeError("asset id must be a finite number");
    return;
  }
  throw new TypeError("asset id must be a string or number");
}

function requireFiniteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite, non-negative number`);
  }
}

function isCriticalPathAsset(asset) {
  if (asset.stage === "PRIMARY") return asset.critical === true;
  return READY_STAGES.has(asset.stage);
}

function requireRunAssets(run) {
  if (run == null || typeof run !== "object" || !Array.isArray(run.assets)) {
    throw new TypeError("run must be an object with an assets array");
  }
  return run.assets;
}

/**
 * An injectable recorder for the four asset-lifecycle timestamps used to
 * derive warm-latency metrics: trigger, dispatch, resolve, admit.
 *
 * Only stage, byte counts, and timestamps are ever stored. Callers must pass
 * an opaque asset id (an index or queue position, never a URL, token,
 * cookie, header, or player identifier) — this is a privacy invariant.
 */
export function createTelemetryRecorder({ now = defaultNow } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  const assets = new Map();

  function requireExisting(id, field) {
    const asset = assets.get(id);
    if (!asset) {
      throw new RangeError(`asset ${String(id)} has no recorded trigger`);
    }
    if (asset[field] !== null) {
      throw new RangeError(`asset ${String(id)} already has a recorded ${field}`);
    }
    return asset;
  }

  function set(id, field, value) {
    const asset = assets.get(id);
    const updated = Object.freeze({ ...asset, [field]: value });
    assets.set(id, updated);
    return updated;
  }

  return Object.freeze({
    recordTrigger(id, { stage, bytes, critical = false } = {}) {
      requireAssetId(id);
      if (assets.has(id)) {
        throw new RangeError(`asset ${String(id)} already has a recorded trigger`);
      }
      if (!ALLOWED_STAGES.has(stage)) {
        throw new RangeError("stage must be one of PRELOADER, COMMON, SPLASH, PRIMARY");
      }
      requireFiniteNonNegative(bytes, "bytes");
      if (typeof critical !== "boolean") {
        throw new TypeError("critical must be a boolean");
      }

      const record = Object.freeze({
        id,
        stage,
        bytes,
        critical,
        trigger: now(),
        dispatch: null,
        resolve: null,
        admit: null,
      });
      assets.set(id, record);
      return record;
    },

    recordDispatch(id) {
      requireAssetId(id);
      requireExisting(id, "dispatch");
      return set(id, "dispatch", now());
    },

    recordResolve(id) {
      requireAssetId(id);
      const asset = requireExisting(id, "resolve");
      if (asset.dispatch === null) {
        throw new RangeError(`asset ${String(id)} must be dispatched before it resolves`);
      }
      return set(id, "resolve", now());
    },

    recordAdmit(id) {
      requireAssetId(id);
      const asset = requireExisting(id, "admit");
      if (asset.resolve === null) {
        throw new RangeError(`asset ${String(id)} must resolve before it is admitted`);
      }
      return set(id, "admit", now());
    },

    getRun() {
      return Object.freeze({
        assets: Object.freeze(Array.from(assets.values())),
      });
    },
  });
}

/**
 * T_ready = max T_admit (admit - trigger) over PRELOADER + COMMON + SPLASH +
 * critical PRIMARY assets. Returns null when no eligible asset has been
 * admitted yet — callers must not treat that as zero latency.
 */
export function computeTReady(run) {
  const assets = requireRunAssets(run);

  const durations = assets
    .filter(isCriticalPathAsset)
    .filter((asset) => Number.isFinite(asset.trigger) && Number.isFinite(asset.admit))
    .map((asset) => asset.admit - asset.trigger);

  if (durations.length === 0) return null;
  return Math.max(...durations);
}

/**
 * Builds U(t): unwarmed critical bytes remaining t ms after the run's
 * trigger (the earliest recorded trigger across all assets). An asset only
 * stops counting once its admit timestamp is at or before trigger + t.
 */
export function createUnwarmedBytesSeries(run) {
  const assets = requireRunAssets(run);
  const eligible = assets.filter(isCriticalPathAsset);

  const triggers = eligible
    .map((asset) => asset.trigger)
    .filter((value) => Number.isFinite(value));

  if (eligible.length > 0 && triggers.length === 0) {
    throw new RangeError("eligible assets must have a recorded trigger");
  }

  const runTrigger = triggers.length > 0 ? Math.min(...triggers) : 0;

  return function U(t) {
    if (!Number.isFinite(t) || t < 0) {
      throw new RangeError("t must be a finite, non-negative number of milliseconds");
    }
    if (eligible.length === 0) return 0;

    const cutoff = runTrigger + t;
    return eligible.reduce((sum, asset) => {
      const admitted = Number.isFinite(asset.admit) && asset.admit <= cutoff;
      return admitted ? sum : sum + asset.bytes;
    }, 0);
  };
}
