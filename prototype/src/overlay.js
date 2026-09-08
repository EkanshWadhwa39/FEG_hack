/**
 * Live network/cache-hit instrumentation overlay for the demo.
 *
 * OverlayTracker: pure logic — tracks request state, computes snapshots.
 * createInstrumentedRequester: wraps requestAsset and feeds the tracker.
 * buildOverlayHtml / renderOverlaySnapshot: DOM rendering (not tested in Node).
 *
 * Hard rules:
 * - Every number in snapshot output is labeled (MEASURED / SIMULATED / FEG-PROVIDED).
 * - No URL, path, or header value is ever stored or emitted by this module.
 */

export const OverlayLabel = Object.freeze({
  MEASURED: "MEASURED",
  SIMULATED: "SIMULATED",
  FEG_PROVIDED: "FEG-PROVIDED",
});

export const RequestState = Object.freeze({
  PENDING: "PENDING",
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

/**
 * Track per-request instrumentation state.
 * Requests are identified by opaque sequential IDs — no URLs stored.
 */
export class OverlayTracker {
  // id → { state, stage, estimatedBytes }
  #requests = new Map();
  #startMs = null;
  #label = OverlayLabel.SIMULATED;

  /**
   * Mark the tracker as started (call once before the first request).
   * @param {string} label — OverlayLabel value for this session
   */
  start(label = OverlayLabel.SIMULATED) {
    if (this.#startMs !== null) {
      throw new Error("tracker already started — call reset() before reuse");
    }
    if (!Object.values(OverlayLabel).includes(label)) {
      throw new RangeError("label must be a valid OverlayLabel");
    }
    this.#startMs = Date.now();
    this.#label = label;
    return this;
  }

  /**
   * Register a new pending request by opaque ID.
   * The URL is intentionally not accepted.
   */
  trackRequest(id, { stage = "UNKNOWN", estimatedBytes = 0 } = {}) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("id must be a non-empty string");
    }
    if (this.#requests.has(id)) {
      throw new Error(`duplicate request id: ${id}`);
    }
    this.#requests.set(id, {
      state: RequestState.PENDING,
      stage: typeof stage === "string" ? stage : "UNKNOWN",
      estimatedBytes: Number.isFinite(estimatedBytes) && estimatedBytes >= 0 ? estimatedBytes : 0,
    });
    return this;
  }

  /** Mark a tracked request as COMPLETE. */
  completeRequest(id) {
    return this.#transition(id, RequestState.COMPLETE);
  }

  /** Mark a tracked request as FAILED. */
  failRequest(id) {
    return this.#transition(id, RequestState.FAILED);
  }

  /** Mark a tracked request as CANCELLED. */
  cancelRequest(id) {
    return this.#transition(id, RequestState.CANCELLED);
  }

  #transition(id, newState) {
    const req = this.#requests.get(id);
    if (!req) throw new Error(`unknown request id: ${id}`);
    req.state = newState;
    return this;
  }

  /**
   * Return a snapshot of current state.
   * All counts and byte totals carry the session label.
   * No per-request URLs or paths are included.
   */
  snapshot() {
    const all = [...this.#requests.values()];
    const pending = all.filter((r) => r.state === RequestState.PENDING).length;
    const complete = all.filter((r) => r.state === RequestState.COMPLETE).length;
    const failed = all.filter((r) => r.state === RequestState.FAILED).length;
    const cancelled = all.filter((r) => r.state === RequestState.CANCELLED).length;
    const totalEstimatedBytes = all
      .filter((r) => r.state === RequestState.COMPLETE)
      .reduce((sum, r) => sum + r.estimatedBytes, 0);
    const elapsedMs = this.#startMs !== null ? Date.now() - this.#startMs : null;

    return Object.freeze({
      pending,
      complete,
      failed,
      cancelled,
      total: all.length,
      totalEstimatedBytes,
      elapsedMs,
      label: this.#label,
    });
  }

  /** Clear all state so the tracker can be reused for the next run. */
  reset() {
    this.#requests.clear();
    this.#startMs = null;
    this.#label = OverlayLabel.SIMULATED;
    return this;
  }
}

/**
 * Wrap a requestAsset function with overlay instrumentation.
 * Each call is assigned an opaque sequential id — no URL is stored.
 *
 * @param {Function} requestAsset — original requester
 * @param {OverlayTracker} tracker — must already be started
 * @param {string} label — OverlayLabel for this session
 */
export function createInstrumentedRequester(requestAsset, tracker, label = OverlayLabel.SIMULATED) {
  if (typeof requestAsset !== "function") {
    throw new TypeError("requestAsset must be a function");
  }
  if (!(tracker instanceof OverlayTracker)) {
    throw new TypeError("tracker must be an OverlayTracker instance");
  }

  let seq = 0;
  return async (url, options = {}) => {
    const id = `req-${(seq += 1)}`;
    tracker.trackRequest(id, {
      stage: options.stage,
      estimatedBytes: options.estimatedBytes,
    });
    try {
      const result = await requestAsset(url, options);
      tracker.completeRequest(id);
      return result;
    } catch (error) {
      if (options.signal?.aborted) {
        tracker.cancelRequest(id);
      } else {
        tracker.failRequest(id);
      }
      throw error;
    }
  };
}

// ---------------------------------------------------------------------------
// DOM rendering — not exercised in Node tests
// ---------------------------------------------------------------------------

const _fmtBytes = (b) =>
  b >= 1_048_576 ? `${(b / 1_048_576).toFixed(2)} MiB` : `${(b / 1024).toFixed(1)} KiB`;

const _fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

/**
 * Build the overlay inner HTML from a snapshot.
 * Every number includes its label — no raw values shown without context.
 */
export function buildOverlayHtml(snapshot) {
  const { pending, complete, failed, cancelled, total, totalEstimatedBytes, elapsedMs, label } =
    snapshot;
  const elapsed = elapsedMs !== null ? _fmtMs(elapsedMs) : "—";
  return [
    `<div class="ov-row"><span class="ov-key">Elapsed</span>`,
    `<strong class="ov-val">${elapsed} <span class="label ${label.toLowerCase()}">${label}</span></strong></div>`,
    `<div class="ov-row"><span class="ov-key">Requests</span>`,
    `<strong class="ov-val">${complete}/${total} done · ${pending} pending · ${failed} failed · ${cancelled} cancelled`,
    ` <span class="label ${label.toLowerCase()}">${label}</span></strong></div>`,
    `<div class="ov-row"><span class="ov-key">Transfer est.</span>`,
    `<strong class="ov-val">${_fmtBytes(totalEstimatedBytes)} <span class="label ${label.toLowerCase()}">${label}</span></strong></div>`,
  ].join("");
}

/**
 * Render a snapshot into a DOM element.
 * @param {Element} element — overlay container
 * @param {object} snapshot — from OverlayTracker.snapshot()
 */
export function renderOverlaySnapshot(element, snapshot) {
  if (!element || typeof element !== "object") {
    throw new TypeError("element is required");
  }
  element.innerHTML = buildOverlayHtml(snapshot);
}
