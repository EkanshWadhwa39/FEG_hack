import test from "node:test";
import assert from "node:assert/strict";
import { Provenance } from "../src/rg-state.js";
import {
  ELEVATED_VELOCITY_FRACTION,
  ReviewFlag,
  SYNTHETIC_COUNTER_RECORD,
  createCounterMetrics,
} from "../src/counter-metrics.js";

test("counter metrics are marked not player-facing", () => {
  const metrics = createCounterMetrics({ now: () => 600_000 })();
  assert.equal(metrics.playerFacing, false);
  assert.equal(metrics.provenance, Provenance.SIMULATED);
});

test("stake velocity is per minute and time on device is formatted", () => {
  const metrics = createCounterMetrics({
    now: () => 600_000,
    read: () => ({
      sessionStartedAt: 0,
      stakedMinorUnits: 600,
      baselineVelocityMinorUnitsPerMinute: 60,
    }),
  })();
  assert.equal(metrics.timeOnDevice, "0:10:00");
  assert.equal(metrics.stakeVelocityPerMinute, 60);
  assert.equal(metrics.deltaFraction, 0);
  assert.equal(metrics.reviewFlag, ReviewFlag.NORMAL);
});

test("velocity above baseline by more than the threshold flags for review", () => {
  const build = (staked) => createCounterMetrics({
    now: () => 600_000,
    read: () => ({
      sessionStartedAt: 0,
      stakedMinorUnits: staked,
      baselineVelocityMinorUnitsPerMinute: 60,
    }),
  })();

  // Exactly at the threshold is not yet elevated.
  assert.equal(build(750).reviewFlag, ReviewFlag.NORMAL);
  assert.equal(build(760).reviewFlag, ReviewFlag.ELEVATED);
  assert.equal(ELEVATED_VELOCITY_FRACTION, 0.25);
});

test("a very short session reports no velocity instead of a noise figure", () => {
  const metrics = createCounterMetrics({
    now: () => 1_000,
    read: () => ({ ...SYNTHETIC_COUNTER_RECORD, sessionStartedAt: 0 }),
  })();
  assert.equal(metrics.stakeVelocityPerMinute, null);
  assert.equal(metrics.reviewFlag, ReviewFlag.UNKNOWN);
  assert.equal(metrics.timeOnDevice, "0:00:01");
});

test("missing or unusable records degrade to UNKNOWN", () => {
  for (const record of [null, undefined, "no", { sessionStartedAt: 0 }]) {
    const metrics = createCounterMetrics({ read: () => record })();
    assert.equal(metrics.available, false);
    assert.equal(metrics.reviewFlag, ReviewFlag.UNKNOWN);
    assert.equal(metrics.playerFacing, false);
  }
});

test("a missing baseline yields no verdict rather than a false NORMAL", () => {
  const metrics = createCounterMetrics({
    now: () => 600_000,
    read: () => ({ sessionStartedAt: 0, stakedMinorUnits: 6_000 }),
  })();
  assert.equal(metrics.stakeVelocityPerMinute, 600);
  assert.equal(metrics.baselineVelocityPerMinute, null);
  assert.equal(metrics.reviewFlag, ReviewFlag.UNKNOWN);
});

test("a real source swaps in without changing the shape", () => {
  const synthetic = createCounterMetrics({ now: () => 600_000 })();
  const real = createCounterMetrics({
    now: () => 600_000,
    provenance: Provenance.MEASURED,
    read: () => ({
      sessionStartedAt: 0,
      stakedMinorUnits: 900,
      baselineVelocityMinorUnitsPerMinute: 60,
    }),
  })();
  assert.deepEqual(Object.keys(synthetic).sort(), Object.keys(real).sort());
  assert.equal(real.provenance, Provenance.MEASURED);
});

test("constructor rejects unusable configuration", () => {
  assert.throws(() => createCounterMetrics({ read: "no" }), TypeError);
  assert.throws(() => createCounterMetrics({ provenance: "GUESSED" }), RangeError);
  assert.throws(() => createCounterMetrics({ elevatedFraction: -1 }), RangeError);
});
