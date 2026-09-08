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
 * Cold-cache baseline from HAR evidence.
 * Source: casino.psk.hr cold run captured before any warming.
 * Label: MEASURED — these are real numbers from real HAR files.
 */
export const COLD_BASELINE = Object.freeze({
  elapsedMs: 35_500,
  elapsedMsLabel: "MEASURED",
  wireBytes: 16_600_000,
  wireBytesLabel: "MEASURED",
  requestCount: 149,
  requestCountLabel: "MEASURED",
  cacheHits: 0,
  cacheHitsLabel: "MEASURED",
  source: "HAR: cold run (no prior warming)",
  sourceLabel: "MEASURED",
});

/**
 * Warm-cache reference from HAR evidence.
 * Source: casino.psk.hr warm run after one full cold load.
 * Label: MEASURED — these are real numbers from real HAR files.
 */
export const WARM_REFERENCE = Object.freeze({
  elapsedMs: 6_700,
  elapsedMsLabel: "MEASURED",
  wireBytes: 12_000,
  wireBytesLabel: "MEASURED",
  requestCount: 149,
  requestCountLabel: "MEASURED",
  cacheHits: 139,
  cacheHitsLabel: "MEASURED",
  source: "HAR: warm run (after cache was populated)",
  sourceLabel: "MEASURED",
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
