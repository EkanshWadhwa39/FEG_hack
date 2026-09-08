import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DemoPhase, DemoSequencer } from "../src/demo-sequencer.js";
import { createSimulatedRequester } from "../src/simulation.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const DEMO_MANIFEST = Object.freeze({
  locales: {
    "hr-HR": {
      tiers: {
        "1x": {
          assets: [
            { url: "/demo/preloader.js", stage: "PRELOADER", estimatedBytes: 180_000 },
            { url: "/demo/common.js", stage: "COMMON", estimatedBytes: 320_000 },
            {
              url: "/demo/primary.bin",
              stage: "PRIMARY",
              critical: true,
              estimatedBytes: 1_000_000,
            },
          ],
        },
      },
    },
  },
});

const TARGET = Object.freeze({ locale: "hr-HR", tier: "1x" });

// Fast environment: governor will ALLOW
const FAST_ENV = Object.freeze({
  saveData: false,
  effectiveType: "4g",
  visibilityState: "visible",
  byteBudget: 10_000_000,
  bytesUsed: 0,
});

function makeSequencer(overrides = {}) {
  return new DemoSequencer({
    manifest: DEMO_MANIFEST,
    target: TARGET,
    environment: FAST_ENV,
    requestAsset: createSimulatedRequester({ delayMs: 0 }),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

describe("DemoSequencer constructor", () => {
  it("throws without manifest", () => {
    assert.throws(() => new DemoSequencer({}), /manifest required/);
  });

  it("throws without target", () => {
    assert.throws(() => new DemoSequencer({ manifest: DEMO_MANIFEST }), /target required/);
  });

  it("throws without environment", () => {
    assert.throws(
      () => new DemoSequencer({ manifest: DEMO_MANIFEST, target: TARGET }),
      /environment required/,
    );
  });

  it("throws if requestAsset is not a function", () => {
    assert.throws(
      () =>
        new DemoSequencer({
          manifest: DEMO_MANIFEST,
          target: TARGET,
          environment: FAST_ENV,
          requestAsset: "not-a-function",
        }),
      /must be a function/,
    );
  });

  it("starts in IDLE phase", () => {
    assert.equal(makeSequencer().phase, DemoPhase.IDLE);
  });
});

// ---------------------------------------------------------------------------
// Step 1: runCold
// ---------------------------------------------------------------------------

describe("DemoSequencer.runCold", () => {
  it("transitions IDLE → COLD_COMPLETE", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    assert.equal(seq.phase, DemoPhase.COLD_COMPLETE);
  });

  it("cold result has CONTROL arm and no warming", async () => {
    const seq = makeSequencer();
    const result = await seq.runCold();
    assert.equal(result.arm, "CONTROL");
    assert.equal(result.warming, false);
  });

  it("cold result has MEASURED labels on reference numbers", async () => {
    const seq = makeSequencer();
    const result = await seq.runCold();
    assert.equal(result.referenceElapsedMsLabel, "MEASURED");
    assert.equal(result.referenceWireBytesLabel, "MEASURED");
    assert.equal(result.referenceRequestCountLabel, "MEASURED");
    assert.equal(result.cacheHitsLabel, "MEASURED");
  });

  it("cold result has 35500ms reference (from HAR evidence)", async () => {
    const seq = makeSequencer();
    const result = await seq.runCold();
    assert.equal(result.referenceElapsedMs, 35_500);
  });

  it("throws if called from WARM_COMPLETE", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    await seq.runWarm();
    await assert.rejects(() => seq.runCold(), /cannot enter COLD_RUNNING/);
  });

  it("snapshot includes cold result after completion", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    assert.ok(seq.snapshot().cold !== null);
  });
});

// ---------------------------------------------------------------------------
// Step 2: runWarm
// ---------------------------------------------------------------------------

describe("DemoSequencer.runWarm", () => {
  it("transitions COLD_COMPLETE → WARM_COMPLETE", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    await seq.runWarm();
    assert.equal(seq.phase, DemoPhase.WARM_COMPLETE);
  });

  it("warm result has TREATMENT arm", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    const result = await seq.runWarm();
    assert.equal(result.arm, "TREATMENT");
  });

  it("warm result has MEASURED labels on HAR reference numbers", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    const result = await seq.runWarm();
    assert.equal(result.referenceElapsedMsLabel, "MEASURED");
    assert.equal(result.referenceWireBytesLabel, "MEASURED");
    assert.equal(result.cacheHitsLabel, "MEASURED");
  });

  it("warm result has 6700ms reference (from HAR evidence)", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    const result = await seq.runWarm();
    assert.equal(result.referenceElapsedMs, 6_700);
  });

  it("elapsedMs is SIMULATED", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    const result = await seq.runWarm();
    assert.equal(result.elapsedMsLabel, "SIMULATED");
  });

  it("governor-blocked warm result is honest", async () => {
    const seq = makeSequencer({
      environment: { ...FAST_ENV, effectiveType: "2g" }, // slow → SLOW_CONNECTION
    });
    await seq.runCold();
    const result = await seq.runWarm();
    assert.equal(result.governorBlocked, true);
    assert.ok(result.governorReason, "governorReason must be set");
  });

  it("throws if called from IDLE", async () => {
    const seq = makeSequencer();
    await assert.rejects(() => seq.runWarm(), /cannot enter WARM_RUNNING/);
  });
});

// ---------------------------------------------------------------------------
// Step 3: showPolicyToggle
// ---------------------------------------------------------------------------

describe("DemoSequencer.showPolicyToggle", () => {
  it("transitions WARM_COMPLETE → TOGGLE_SHOWN", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    await seq.runWarm();
    seq.showPolicyToggle();
    assert.equal(seq.phase, DemoPhase.TOGGLE_SHOWN);
  });

  it("toggle result shows prefetch disabled", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    await seq.runWarm();
    const result = seq.showPolicyToggle();
    assert.equal(result.prefetchEnabled, false);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "DISABLED");
  });

  it("toggle result is labeled SIMULATED", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    await seq.runWarm();
    const result = seq.showPolicyToggle();
    assert.equal(result.label, "SIMULATED");
  });

  it("throws if called from COLD_COMPLETE", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    assert.throws(() => seq.showPolicyToggle(), /cannot enter TOGGLE_SHOWN/);
  });
});

// ---------------------------------------------------------------------------
// Step 4: triggerDeliberateFailure
// ---------------------------------------------------------------------------

describe("DemoSequencer.triggerDeliberateFailure", () => {
  async function reachToggle() {
    const seq = makeSequencer();
    await seq.runCold();
    await seq.runWarm();
    seq.showPolicyToggle();
    return seq;
  }

  it("transitions TOGGLE_SHOWN → FAILURE_SHOWN", async () => {
    const seq = await reachToggle();
    await seq.triggerDeliberateFailure();
    assert.equal(seq.phase, DemoPhase.FAILURE_SHOWN);
  });

  it("failure result has triggered: true and aborted: true", async () => {
    const seq = await reachToggle();
    const result = await seq.triggerDeliberateFailure();
    assert.equal(result.triggered, true);
    assert.equal(result.aborted, true);
  });

  it("failure result is labeled SIMULATED", async () => {
    const seq = await reachToggle();
    const result = await seq.triggerDeliberateFailure();
    assert.equal(result.label, "SIMULATED");
  });

  it("failure result has an explanatory note", async () => {
    const seq = await reachToggle();
    const result = await seq.triggerDeliberateFailure();
    assert.ok(result.note && result.note.length > 0);
  });

  it("throws if called from COLD_COMPLETE", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    await assert.rejects(() => seq.triggerDeliberateFailure(), /cannot enter FAILURE_RUNNING/);
  });
});

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

describe("DemoSequencer.rollback", () => {
  it("clears all results", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    await seq.runWarm();
    seq.rollback();
    const snap = seq.snapshot();
    assert.equal(snap.cold, null);
    assert.equal(snap.warm, null);
  });

  it("sets phase to ROLLED_BACK", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    seq.rollback();
    assert.equal(seq.phase, DemoPhase.ROLLED_BACK);
  });

  it("rollback from IDLE is safe (no throw)", () => {
    const seq = makeSequencer();
    assert.doesNotThrow(() => seq.rollback());
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe("DemoSequencer.reset", () => {
  it("returns to IDLE after reset", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    seq.reset();
    assert.equal(seq.phase, DemoPhase.IDLE);
  });

  it("allows full sequence replay after reset", async () => {
    const seq = makeSequencer();
    await seq.runCold();
    await seq.runWarm();
    seq.reset();
    await seq.runCold(); // should not throw
    assert.equal(seq.phase, DemoPhase.COLD_COMPLETE);
  });
});

// ---------------------------------------------------------------------------
// onPhaseChange callback
// ---------------------------------------------------------------------------

describe("onPhaseChange callback", () => {
  it("is called on every phase transition with phase and snapshot", async () => {
    const changes = [];
    const seq = makeSequencer({
      onPhaseChange: (phase, snap) => changes.push({ phase, snap }),
    });
    await seq.runCold();
    // Expect at least COLD_RUNNING and COLD_COMPLETE
    const phases = changes.map((c) => c.phase);
    assert.ok(phases.includes(DemoPhase.COLD_RUNNING));
    assert.ok(phases.includes(DemoPhase.COLD_COMPLETE));
  });

  it("snapshot in callback has no URLs", async () => {
    const snapshots = [];
    const seq = makeSequencer({
      onPhaseChange: (_phase, snap) => snapshots.push(JSON.stringify(snap)),
    });
    await seq.runCold();
    for (const s of snapshots) {
      assert.ok(!s.includes("demo/"), "URL leaked into onPhaseChange snapshot");
    }
  });
});
