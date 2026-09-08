import test from "node:test";
import assert from "node:assert/strict";
import {
  createTelemetryRecorder,
  computeTReady,
  createUnwarmedBytesSeries,
} from "../src/warm-telemetry.js";

function fakeClock(startAt = 0) {
  let value = startAt;
  return {
    now: () => value,
    advanceTo: (next) => {
      value = next;
    },
  };
}

test("records trigger/dispatch/resolve/admit timestamps in order", () => {
  const clock = fakeClock(0);
  const recorder = createTelemetryRecorder({ now: clock.now });

  clock.advanceTo(10);
  recorder.recordTrigger("a0", { stage: "PRELOADER", bytes: 100, critical: false });
  clock.advanceTo(20);
  recorder.recordDispatch("a0");
  clock.advanceTo(35);
  recorder.recordResolve("a0");
  clock.advanceTo(50);
  const admitted = recorder.recordAdmit("a0");

  assert.deepEqual(admitted, {
    id: "a0",
    stage: "PRELOADER",
    bytes: 100,
    critical: false,
    trigger: 10,
    dispatch: 20,
    resolve: 35,
    admit: 50,
  });
});

test("rejects an asset id that resembles a URL", () => {
  const recorder = createTelemetryRecorder({ now: () => 0 });
  assert.throws(
    () => recorder.recordTrigger("https://cdn.example/a.bin", { stage: "COMMON", bytes: 1 }),
    RangeError,
  );
});

test("rejects an unknown stage", () => {
  const recorder = createTelemetryRecorder({ now: () => 0 });
  assert.throws(
    () => recorder.recordTrigger("a0", { stage: "BOGUS", bytes: 1 }),
    RangeError,
  );
});

test("rejects negative byte counts", () => {
  const recorder = createTelemetryRecorder({ now: () => 0 });
  assert.throws(
    () => recorder.recordTrigger("a0", { stage: "COMMON", bytes: -1 }),
    TypeError,
  );
});

test("enforces lifecycle ordering: dispatch before resolve before admit", () => {
  const recorder = createTelemetryRecorder({ now: () => 0 });
  recorder.recordTrigger("a0", { stage: "COMMON", bytes: 1 });

  assert.throws(() => recorder.recordResolve("a0"), RangeError);
  recorder.recordDispatch("a0");
  assert.throws(() => recorder.recordAdmit("a0"), RangeError);
  recorder.recordResolve("a0");
  recorder.recordAdmit("a0");
});

test("rejects a duplicate trigger for the same asset id", () => {
  const recorder = createTelemetryRecorder({ now: () => 0 });
  recorder.recordTrigger("a0", { stage: "COMMON", bytes: 1 });
  assert.throws(
    () => recorder.recordTrigger("a0", { stage: "COMMON", bytes: 1 }),
    RangeError,
  );
});

test("rejects recording an event for an asset with no trigger", () => {
  const recorder = createTelemetryRecorder({ now: () => 0 });
  assert.throws(() => recorder.recordDispatch("missing"), RangeError);
});

test("getRun returns a frozen record with no URLs, tokens, or headers", () => {
  const recorder = createTelemetryRecorder({ now: () => 5 });
  recorder.recordTrigger("a0", { stage: "COMMON", bytes: 42 });
  const run = recorder.getRun();

  assert.equal(Object.isFrozen(run), true);
  assert.equal(Object.isFrozen(run.assets), true);
  assert.equal(Object.isFrozen(run.assets[0]), true);
  assert.deepEqual(Object.keys(run.assets[0]).sort(), [
    "admit",
    "bytes",
    "critical",
    "dispatch",
    "id",
    "resolve",
    "stage",
    "trigger",
  ]);
});

test("computeTReady is the max T_admit across PRELOADER/COMMON/SPLASH and critical PRIMARY", () => {
  const clock = fakeClock(0);
  const recorder = createTelemetryRecorder({ now: clock.now });

  const complete = (id, stage, { critical = false, triggerAt, admitAt }) => {
    clock.advanceTo(triggerAt);
    recorder.recordTrigger(id, { stage, bytes: 10, critical });
    clock.advanceTo(triggerAt + 1);
    recorder.recordDispatch(id);
    clock.advanceTo(triggerAt + 2);
    recorder.recordResolve(id);
    clock.advanceTo(admitAt);
    recorder.recordAdmit(id);
  };

  complete("preloader", "PRELOADER", { triggerAt: 0, admitAt: 100 });
  complete("common", "COMMON", { triggerAt: 0, admitAt: 400 });
  complete("noncritical-primary", "PRIMARY", { critical: false, triggerAt: 0, admitAt: 900 });

  clock.advanceTo(0);
  recorder.recordTrigger("critical-primary", { stage: "PRIMARY", bytes: 10, critical: true });
  // not dispatched/resolved/admitted yet — must not count toward T_ready

  const run = recorder.getRun();
  // T_ready ignores the non-critical PRIMARY's 900ms admit and the still-pending critical PRIMARY.
  assert.equal(computeTReady(run), 400);
});

test("computeTReady returns null when no eligible asset has been admitted", () => {
  const run = { assets: [{ stage: "PRIMARY", critical: false, bytes: 1, trigger: 0, admit: null }] };
  assert.equal(computeTReady(run), null);
});

test("U(t) reports unwarmed critical bytes remaining at t ms after the run trigger", () => {
  const clock = fakeClock(0);
  const recorder = createTelemetryRecorder({ now: clock.now });

  const complete = (id, stage, { critical = false, triggerAt, admitAt }) => {
    clock.advanceTo(triggerAt);
    recorder.recordTrigger(id, { stage, bytes: 100, critical });
    clock.advanceTo(triggerAt + 1);
    recorder.recordDispatch(id);
    clock.advanceTo(triggerAt + 2);
    recorder.recordResolve(id);
    clock.advanceTo(admitAt);
    recorder.recordAdmit(id);
  };

  complete("preloader", "PRELOADER", { triggerAt: 0, admitAt: 200 });
  complete("common", "COMMON", { triggerAt: 0, admitAt: 800 });

  const run = recorder.getRun();
  const U = createUnwarmedBytesSeries(run);

  assert.equal(U(100), 200); // neither admitted yet
  assert.equal(U(200), 100); // preloader admitted exactly at 200
  assert.equal(U(800), 0); // both admitted
});

test("U(t) excludes non-critical PRIMARY bytes and pending assets never break the series", () => {
  const clock = fakeClock(0);
  const recorder = createTelemetryRecorder({ now: clock.now });

  recorder.recordTrigger("noncritical", { stage: "PRIMARY", bytes: 500, critical: false });
  clock.advanceTo(10);
  recorder.recordTrigger("critical", { stage: "PRIMARY", bytes: 50, critical: true });
  recorder.recordDispatch("critical");
  recorder.recordResolve("critical");
  clock.advanceTo(20);
  recorder.recordAdmit("critical");

  const run = recorder.getRun();
  const U = createUnwarmedBytesSeries(run);

  assert.equal(U(0), 50); // only the critical asset counts; its trigger is the run trigger (10)
  assert.equal(U(10), 0); // admitted at 20, i.e. 10ms after its own trigger
});

test("U(t) rejects a negative t", () => {
  const run = { assets: [] };
  const U = createUnwarmedBytesSeries(run);
  assert.throws(() => U(-1), RangeError);
});

test("computeTReady and createUnwarmedBytesSeries reject a malformed run", () => {
  assert.throws(() => computeTReady(null), TypeError);
  assert.throws(() => createUnwarmedBytesSeries({ assets: "nope" }), TypeError);
});

test("rejects path-shaped ids, not just absolute URLs", () => {
  const recorder = createTelemetryRecorder({ now: () => 1 });
  for (const id of [
    "https://cdn.example.test/Game/Asset.BIN?v=17",
    "/hr-HR/1x/common.js?v=17",
    "assets/locale/hr/splash.webp",
    "a.b",
    "id with spaces",
  ]) {
    assert.throws(
      () => recorder.recordTrigger(id, { stage: "COMMON", bytes: 1 }),
      /opaque token/,
      `expected ${id} to be rejected`,
    );
  }
  assert.doesNotThrow(() => recorder.recordTrigger("preloader-0", { stage: "COMMON", bytes: 1 }));
});
