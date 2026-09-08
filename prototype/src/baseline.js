/**
 * Baseline arm: the same experience with every optimization disabled.
 *
 * Provides an honest comparison reference for the warmed treatment arm.
 * Cold-cache numbers come from measured HAR captures (CODE.md,
 * docs/LOCAL-CACHE-REUSE.md). Simulated numbers are clearly labeled.
 *
 * Does NOT call fetch(), warmAssets(), or any governor/manifest logic
 * beyond manifest resolution (needed to confirm the plan is valid).
 */

import { resolveManifest } from "./manifest.js";

/**
 * Cold-cache baseline from HAR evidence (casino.psk.hr_cold.har).
 * Source: tools/measure_har.py → evidence/derived/har-comparison-cold-warm.json
 *
 * WARNING: This HAR had 27 pre-existing cache hits — not a truly cold cache.
 * elapsed_ms is HAR entry span (first request start → last end), NOT
 * click-to-interactive. The 35.5s/6.7s figures in prior docs used a different
 * unreconciled measurement method and are labeled UNKNOWN here until reconciled.
 */
export const COLD_BASELINE = Object.freeze({
  elapsedMs: 76_358,
  elapsedMsLabel: "MEASURED",
  elapsedMsNote: "HAR entry span; not click-to-interactive",
  wireBytes: 16_597_198,
  wireBytesLabel: "MEASURED",
  requestCount: 177,
  requestCountLabel: "MEASURED",
  cacheHits: 27,
  cacheHitsLabel: "MEASURED",
  cacheHitsNote: "Pre-existing hits — HAR was not captured with a fully cleared cache",
  source: "casino.psk.hr_cold.har (private, not committed)",
  sourceLabel: "MEASURED",
  // Asset-batch milestone (MEASURED): capture-start to last successful response
  // in the exact 16-request batch — see docs/HAR-MILESTONE.md
  assetBatchElapsedMs: 35_568,
  assetBatchElapsedMsLabel: "MEASURED",
  assetBatchElapsedMsNote: "Asset-batch completion, NOT click-to-interactive",
});

/**
 * Warm-cache reference from HAR evidence (casino.psk.hr_warm.har).
 * Source: tools/measure_har.py → evidence/derived/har-comparison-cold-warm.json
 *
 * elapsed_ms is HAR entry span — same caveat as COLD_BASELINE.
 */
export const WARM_REFERENCE = Object.freeze({
  elapsedMs: 16_253,
  elapsedMsLabel: "MEASURED",
  elapsedMsNote: "HAR entry span; not click-to-interactive",
  wireBytes: 12_431,
  wireBytesLabel: "MEASURED",
  requestCount: 155,
  requestCountLabel: "MEASURED",
  cacheHits: 140,
  cacheHitsLabel: "MEASURED",
  source: "casino.psk.hr_warm.har (private, not committed)",
  sourceLabel: "MEASURED",
  // Asset-batch milestone (MEASURED): capture-start to last successful response
  // in the same exact 16-request batch — see docs/HAR-MILESTONE.md
  assetBatchElapsedMs: 6_714,
  assetBatchElapsedMsLabel: "MEASURED",
  assetBatchElapsedMsNote: "Asset-batch completion, NOT click-to-interactive",
});

/**
 * Build a baseline context from the manifest.
 *
 * All optimizations are explicitly disabled — no prefetch, no prewarming,
 * no cache warming. The returned object includes MEASURED cold/warm reference
 * numbers alongside SIMULATED manifest-derived counts, so callers can display
 * both honestly side by side.
 *
 * @param {object} manifest — same manifest used by the treatment arm
 * @param {object} target — { locale, tier }
 * @returns {object} frozen baseline context
 */
export function createBaselineContext(manifest, target) {
  const plan = resolveManifest(manifest, target);
  const plannedBytes = plan.assets.reduce((sum, asset) => sum + asset.estimatedBytes, 0);

  return Object.freeze({
    arm: "CONTROL",
    prefetchEnabled: false,
    warming: false,
    locale: plan.locale,
    tier: plan.tier,
    assetCount: plan.assets.length,
    assetCountLabel: "SIMULATED",
    plannedBytes,
    plannedBytesLabel: "SIMULATED",
    cold: COLD_BASELINE,
    warm: WARM_REFERENCE,
    note:
      "No prefetch, no prewarming, no cache warming. " +
      "Cold and warm numbers are from measured HAR captures, not this simulation.",
  });
}
