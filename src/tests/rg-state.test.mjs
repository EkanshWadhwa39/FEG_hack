import test from "node:test";
import assert from "node:assert/strict";
import {
  LimitState,
  NEAR_LIMIT_FRACTION,
  Provenance,
  SYNTHETIC_SESSION,
  createRgState,
  formatDuration,
  formatMinorUnits,
} from "../src/rg-state.js";

test("net position is signed so a loss is never displayed as neutral", () => {
  assert.equal(formatMinorUnits(0).startsWith("+"), false);
  assert.match(formatMinorUnits(900), /^\+/);
  assert.match(formatMinorUnits(-1150), /^−/);
  assert.throws(() => formatMinorUnits(1.5), TypeError);
});

test("duration formats and saturates instead of going negative", () => {
  assert.equal(formatDuration(0), "0:00:00");
  assert.equal(formatDuration(3_725_000), "1:02:05");
  assert.equal(formatDuration(-5), "0:00:00");
  assert.equal(formatDuration(Number.NaN), "0:00:00");
});

test("a synthetic reading is labelled SIMULATED and never claims otherwise", () => {
  const state = createRgState({ now: () => 60_000 })();
  assert.equal(state.provenance, Provenance.SIMULATED);
  assert.equal(state.available, true);
  assert.equal(state.sessionDuration, "0:01:00");
});

test("limit state escalates as headroom shrinks", () => {
  const build = (staked, limit) => createRgState({
    now: () => 0,
    read: () => ({
      sessionStartedAt: 0,
      stakedMinorUnits: staked,
      returnedMinorUnits: 0,
      limitMinorUnits: limit,
    }),
  })();

  assert.equal(build(1_000, 10_000).limitState, LimitState.OK);
  // Exactly at the threshold counts as near, not OK.
  assert.equal(build(8_000, 10_000).limitState, LimitState.NEAR_LIMIT);
  assert.equal(build(10_000, 10_000).limitState, LimitState.REACHED);
  // Overspend cannot report negative headroom.
  assert.equal(build(12_000, 10_000).limitRemainingMinorUnits, 0);
  assert.equal(NEAR_LIMIT_FRACTION, 0.2);
});

test("an unusable source degrades to UNKNOWN rather than a confident zero", () => {
  const state = createRgState({ read: () => null })();
  assert.equal(state.provenance, Provenance.UNKNOWN);
  assert.equal(state.available, false);
  assert.equal(state.netPosition, null);
  assert.equal(state.limitRemainingMinorUnits, null);
});

test("a real source can be swapped in without changing the shape", () => {
  const synthetic = createRgState({ now: () => 1_000 })();
  const real = createRgState({
    now: () => 1_000,
    provenance: Provenance.MEASURED,
    read: () => ({
      sessionStartedAt: 0,
      stakedMinorUnits: 100,
      returnedMinorUnits: 250,
      limitMinorUnits: 9_000,
    }),
  })();

  assert.deepEqual(Object.keys(synthetic).sort(), Object.keys(real).sort());
  assert.equal(real.provenance, Provenance.MEASURED);
  assert.match(real.netPosition, /^\+/);
});

test("constructor and record validation reject unusable input", () => {
  assert.throws(() => createRgState({ now: "no" }), TypeError);
  assert.throws(() => createRgState({ provenance: "GUESSED" }), RangeError);
  assert.throws(
    () => createRgState({ read: () => ({ ...SYNTHETIC_SESSION, stakedMinorUnits: 1.5 }) })(),
    TypeError,
  );
});
