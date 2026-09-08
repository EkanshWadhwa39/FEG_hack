import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBaselineContext, COLD_BASELINE, WARM_REFERENCE } from "../src/baseline.js";

const DEMO_MANIFEST = Object.freeze({
  locales: {
    "hr-HR": {
      tiers: {
        "1x": {
          assets: [
            { url: "/demo/preloader.js", stage: "PRELOADER", estimatedBytes: 180_000 },
            { url: "/demo/common.js", stage: "COMMON", estimatedBytes: 320_000 },
          ],
        },
      },
    },
  },
});

const TARGET = Object.freeze({ locale: "hr-HR", tier: "1x" });

// ---------------------------------------------------------------------------
// COLD_BASELINE and WARM_REFERENCE constants
// ---------------------------------------------------------------------------

describe("COLD_BASELINE", () => {
  it("is labeled MEASURED", () => {
    assert.equal(COLD_BASELINE.elapsedMsLabel, "MEASURED");
    assert.equal(COLD_BASELINE.wireBytesLabel, "MEASURED");
    assert.equal(COLD_BASELINE.requestCountLabel, "MEASURED");
    assert.equal(COLD_BASELINE.cacheHitsLabel, "MEASURED");
  });

  it("has non-zero elapsed and wire bytes", () => {
    assert.ok(COLD_BASELINE.elapsedMs > 0, "cold elapsedMs must be positive");
    assert.ok(COLD_BASELINE.wireBytes > 0, "cold wireBytes must be positive");
  });

  it("has zero cache hits (cold run has no cache)", () => {
    assert.equal(COLD_BASELINE.cacheHits, 0);
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(COLD_BASELINE));
  });
});

describe("WARM_REFERENCE", () => {
  it("is labeled MEASURED", () => {
    assert.equal(WARM_REFERENCE.elapsedMsLabel, "MEASURED");
    assert.equal(WARM_REFERENCE.wireBytesLabel, "MEASURED");
    assert.equal(WARM_REFERENCE.requestCountLabel, "MEASURED");
    assert.equal(WARM_REFERENCE.cacheHitsLabel, "MEASURED");
  });

  it("warm elapsed is less than cold elapsed", () => {
    assert.ok(
      WARM_REFERENCE.elapsedMs < COLD_BASELINE.elapsedMs,
      `warm (${WARM_REFERENCE.elapsedMs}ms) should be less than cold (${COLD_BASELINE.elapsedMs}ms)`,
    );
  });

  it("warm wire bytes is less than cold wire bytes", () => {
    assert.ok(
      WARM_REFERENCE.wireBytes < COLD_BASELINE.wireBytes,
      `warm (${WARM_REFERENCE.wireBytes}B) should be less than cold (${COLD_BASELINE.wireBytes}B)`,
    );
  });

  it("warm cache hits is greater than zero", () => {
    assert.ok(WARM_REFERENCE.cacheHits > 0);
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(WARM_REFERENCE));
  });
});

// ---------------------------------------------------------------------------
// createBaselineContext
// ---------------------------------------------------------------------------

describe("createBaselineContext", () => {
  it("arm is CONTROL and warming is false", () => {
    const ctx = createBaselineContext(DEMO_MANIFEST, TARGET);
    assert.equal(ctx.arm, "CONTROL");
    assert.equal(ctx.warming, false);
    assert.equal(ctx.prefetchEnabled, false);
  });

  it("resolves locale and tier from manifest", () => {
    const ctx = createBaselineContext(DEMO_MANIFEST, TARGET);
    assert.equal(ctx.locale, "hr-HR");
    assert.equal(ctx.tier, "1x");
  });

  it("assetCount reflects manifest (filters non-proactive stages)", () => {
    const ctx = createBaselineContext(DEMO_MANIFEST, TARGET);
    // Both assets are proactive (PRELOADER, COMMON)
    assert.equal(ctx.assetCount, 2);
  });

  it("assetCount is labeled SIMULATED", () => {
    const ctx = createBaselineContext(DEMO_MANIFEST, TARGET);
    assert.equal(ctx.assetCountLabel, "SIMULATED");
  });

  it("plannedBytes is the sum of estimatedBytes", () => {
    const ctx = createBaselineContext(DEMO_MANIFEST, TARGET);
    assert.equal(ctx.plannedBytes, 180_000 + 320_000);
  });

  it("plannedBytes is labeled SIMULATED", () => {
    const ctx = createBaselineContext(DEMO_MANIFEST, TARGET);
    assert.equal(ctx.plannedBytesLabel, "SIMULATED");
  });

  it("cold reference is COLD_BASELINE", () => {
    const ctx = createBaselineContext(DEMO_MANIFEST, TARGET);
    assert.equal(ctx.cold, COLD_BASELINE);
  });

  it("warm reference is WARM_REFERENCE", () => {
    const ctx = createBaselineContext(DEMO_MANIFEST, TARGET);
    assert.equal(ctx.warm, WARM_REFERENCE);
  });

  it("result is frozen", () => {
    const ctx = createBaselineContext(DEMO_MANIFEST, TARGET);
    assert.ok(Object.isFrozen(ctx));
  });

  it("note mentions no warming", () => {
    const ctx = createBaselineContext(DEMO_MANIFEST, TARGET);
    assert.ok(ctx.note.toLowerCase().includes("no"));
  });

  it("throws on invalid manifest (propagates resolveManifest error)", () => {
    assert.throws(
      () => createBaselineContext({}, TARGET),
      /manifest.locales/,
    );
  });

  it("throws on unsupported locale", () => {
    assert.throws(
      () => createBaselineContext(DEMO_MANIFEST, { locale: "xx-XX", tier: "1x" }),
      /unsupported locale/,
    );
  });
});
