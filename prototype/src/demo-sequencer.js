/**
 * Demo sequencer: cold run → warm run → policy toggle → deliberate failure → rollback.
 *
 * A pure state machine with no DOM dependencies. Drives the demo in a
 * repeatable sequence that someone can run live. Each transition is
 * explicit and validated. Rollback is always available and non-destructive.
 *
 * Hard rules:
 * - Every labeled number uses MEASURED (from HAR evidence) or SIMULATED.
 * - No URL, token, or credential is stored or emitted.
 * - Rollback must never freeze — it uses AbortController, not force-quit.
 */

import { assessPrefetch } from "./governor.js";
import { resolveManifest } from "./manifest.js";
import { warmAssets } from "./warmer.js";

export const DemoPhase = Object.freeze({
  IDLE: "IDLE",
  COLD_RUNNING: "COLD_RUNNING",
  COLD_COMPLETE: "COLD_COMPLETE",
  WARM_RUNNING: "WARM_RUNNING",
  WARM_COMPLETE: "WARM_COMPLETE",
  TOGGLE_SHOWN: "TOGGLE_SHOWN",
  FAILURE_RUNNING: "FAILURE_RUNNING",
  FAILURE_SHOWN: "FAILURE_SHOWN",
  ROLLED_BACK: "ROLLED_BACK",
});

// Valid phase transitions — enforced by every step.
const TRANSITIONS = new Map([
  [DemoPhase.COLD_RUNNING, new Set([DemoPhase.IDLE, DemoPhase.ROLLED_BACK])],
  [DemoPhase.WARM_RUNNING, new Set([DemoPhase.COLD_COMPLETE])],
  [DemoPhase.TOGGLE_SHOWN, new Set([DemoPhase.WARM_COMPLETE])],
  [DemoPhase.FAILURE_RUNNING, new Set([DemoPhase.TOGGLE_SHOWN])],
  [DemoPhase.ROLLED_BACK, new Set(Object.values(DemoPhase))], // rollback from anywhere
]);

export class DemoSequencer {
  #phase = DemoPhase.IDLE;
  #coldResult = null;
  #warmResult = null;
  #toggleResult = null;
  #failureResult = null;
  #abortController = null;
  #onPhaseChange;
  #manifest;
  #target;
  #environment;
  #requestAsset;

  /**
   * @param {object} manifest
   * @param {object} target — { locale, tier }
   * @param {object} environment — governor environment (saveData, effectiveType, etc.)
   * @param {Function} requestAsset — used for the warm run
   * @param {Function} onPhaseChange — called with (phase, snapshot) on every transition
   */
  constructor({ manifest, target, environment, requestAsset, onPhaseChange = () => {} } = {}) {
    if (!manifest || typeof manifest !== "object") throw new TypeError("manifest required");
    if (!target || typeof target !== "object") throw new TypeError("target required");
    if (!environment || typeof environment !== "object") throw new TypeError("environment required");
    if (typeof requestAsset !== "function") throw new TypeError("requestAsset must be a function");
    if (typeof onPhaseChange !== "function") throw new TypeError("onPhaseChange must be a function");
    this.#manifest = manifest;
    this.#target = target;
    this.#environment = environment;
    this.#requestAsset = requestAsset;
    this.#onPhaseChange = onPhaseChange;
  }

  get phase() {
    return this.#phase;
  }

  /** Frozen snapshot of all step results (no URLs, no tokens). */
  snapshot() {
    return Object.freeze({
      phase: this.#phase,
      cold: this.#coldResult,
      warm: this.#warmResult,
      toggle: this.#toggleResult,
      failure: this.#failureResult,
    });
  }

  #requirePhase(nextPhase) {
    const allowed = TRANSITIONS.get(nextPhase);
    if (!allowed?.has(this.#phase)) {
      throw new Error(`cannot enter ${nextPhase} from ${this.#phase}`);
    }
  }

  #setPhase(phase) {
    this.#phase = phase;
    this.#onPhaseChange(phase, this.snapshot());
  }

  /**
   * Step 1 — Cold run.
   * Resolves the manifest (validates it), then records the cold baseline.
   * No warming, no fetch. Reference numbers are MEASURED from HAR evidence.
   */
  async runCold() {
    this.#requirePhase(DemoPhase.COLD_RUNNING);
    this.#setPhase(DemoPhase.COLD_RUNNING);

    const plan = resolveManifest(this.#manifest, this.#target);

    this.#coldResult = Object.freeze({
      arm: "CONTROL",
      warming: false,
      locale: plan.locale,
      tier: plan.tier,
      assetCount: plan.assets.length,
      assetCountLabel: "SIMULATED",
      // From casino.psk.hr_cold.har via tools/measure_har.py
      // elapsed_ms = HAR entry span (not click-to-interactive)
      // 27 pre-existing cache hits — HAR was not from a cleared-cache session
      referenceElapsedMs: 76_358,
      referenceElapsedMsLabel: "MEASURED",
      referenceElapsedMsNote: "HAR span includes trailing background requests; asset-batch milestone was 35.568s — see docs/HAR-MILESTONE.md",
      referenceWireBytes: 16_597_198,
      referenceWireBytesLabel: "MEASURED",
      referenceRequestCount: 177,
      referenceRequestCountLabel: "MEASURED",
      cacheHits: 27,
      cacheHitsLabel: "MEASURED",
      cacheHitsNote: "Pre-existing hits; HAR was not captured with cleared cache",
    });

    this.#setPhase(DemoPhase.COLD_COMPLETE);
    return this.#coldResult;
  }

  /**
   * Step 2 — Warm run.
   * Evaluates the governor, then runs warmAssets with concurrency 2.
   * If the governor blocks, warm result reflects that honestly.
   */
  async runWarm() {
    this.#requirePhase(DemoPhase.WARM_RUNNING);

    const plan = resolveManifest(this.#manifest, this.#target);
    const plannedBytes = plan.assets.reduce((s, a) => s + a.estimatedBytes, 0);

    const decision = assessPrefetch({
      ...this.#environment,
      enabled: true,
      nextAssetBytes: plannedBytes,
    });

    if (!decision.allowed) {
      this.#warmResult = Object.freeze({
        arm: "TREATMENT",
        warming: false,
        governorBlocked: true,
        governorReason: decision.reason,
        label: "SIMULATED",
      });
      this.#setPhase(DemoPhase.WARM_COMPLETE);
      return this.#warmResult;
    }

    this.#setPhase(DemoPhase.WARM_RUNNING);
    this.#abortController = new AbortController();
    const startMs = Date.now();

    try {
      const summary = await warmAssets({
        plan,
        target: this.#target,
        requestAsset: this.#requestAsset,
        concurrency: 2,
        signal: this.#abortController.signal,
      });
      const elapsedMs = Date.now() - startMs;

      this.#warmResult = Object.freeze({
        arm: "TREATMENT",
        warming: true,
        governorBlocked: false,
        summary,
        elapsedMs,
        elapsedMsLabel: "SIMULATED",
        // From casino.psk.hr_warm.har via tools/measure_har.py
        // elapsed_ms = HAR entry span (not click-to-interactive)
        referenceElapsedMs: 16_253,
        referenceElapsedMsLabel: "MEASURED",
        referenceElapsedMsNote: "HAR entry span; prior 6.7s claim used different unreconciled method",
        referenceWireBytes: 12_431,
        referenceWireBytesLabel: "MEASURED",
        referenceRequestCount: 155,
        referenceRequestCountLabel: "MEASURED",
        cacheHits: 140,
        cacheHitsLabel: "MEASURED",
      });
    } catch {
      this.#warmResult = Object.freeze({
        arm: "TREATMENT",
        warming: false,
        governorBlocked: false,
        failed: true,
        reason: this.#abortController?.signal.aborted ? "CANCELLED" : "ERROR",
        label: "SIMULATED",
      });
    } finally {
      this.#abortController = null;
    }

    this.#setPhase(DemoPhase.WARM_COMPLETE);
    return this.#warmResult;
  }

  /**
   * Step 3 — Policy toggle.
   * Disables prefetch (enabled: false), re-evaluates governor, shows DISABLED.
   * Demonstrates that the governor correctly blocks when the operator opts out.
   */
  showPolicyToggle() {
    this.#requirePhase(DemoPhase.TOGGLE_SHOWN);

    const plan = resolveManifest(this.#manifest, this.#target);
    const plannedBytes = plan.assets.reduce((s, a) => s + a.estimatedBytes, 0);

    const decision = assessPrefetch({
      ...this.#environment,
      enabled: false,
      nextAssetBytes: plannedBytes,
    });

    this.#toggleResult = Object.freeze({
      prefetchEnabled: false,
      allowed: decision.allowed,
      reason: decision.reason,
      label: "SIMULATED",
    });

    this.#setPhase(DemoPhase.TOGGLE_SHOWN);
    return this.#toggleResult;
  }

  /**
   * Step 4a — Deliberate failure.
   * Aborts warming mid-run via AbortController. warmAssets returns CANCELLED
   * statuses. The UI stays responsive — no spinner frozen, no dead state.
   */
  async triggerDeliberateFailure() {
    this.#requirePhase(DemoPhase.FAILURE_RUNNING);
    this.#setPhase(DemoPhase.FAILURE_RUNNING);

    const plan = resolveManifest(this.#manifest, this.#target);
    const abortController = new AbortController();

    // Abort before warmAssets starts — all assets return CANCELLED.
    abortController.abort();

    let summary = null;
    try {
      summary = await warmAssets({
        plan,
        target: this.#target,
        requestAsset: this.#requestAsset,
        concurrency: 2,
        signal: abortController.signal,
      });
    } catch {
      // warmAssets should not throw on abort — but handle gracefully if it does
    }

    this.#failureResult = Object.freeze({
      triggered: true,
      aborted: true,
      summary,
      label: "SIMULATED",
      note:
        "Deliberate failure: operator abort signal sent before warm run. " +
        "All requests cancelled. UI remains responsive — rollback to clean state next.",
    });

    this.#setPhase(DemoPhase.FAILURE_SHOWN);
    return this.#failureResult;
  }

  /**
   * Step 4b — Rollback.
   * Cancels any in-flight warming (if somehow still running) and resets all
   * step results. Can be called from any phase. Never throws.
   */
  rollback() {
    if (this.#abortController && !this.#abortController.signal.aborted) {
      this.#abortController.abort();
    }
    this.#abortController = null;
    this.#coldResult = null;
    this.#warmResult = null;
    this.#toggleResult = null;
    this.#failureResult = null;
    this.#setPhase(DemoPhase.ROLLED_BACK);
  }

  /**
   * Full reset: rollback + return to IDLE so the sequence can restart.
   */
  reset() {
    this.rollback();
    this.#setPhase(DemoPhase.IDLE);
  }
}
