import test from "node:test";
import assert from "node:assert/strict";
import { MINIMUM_DWELL_MS, createDwellTracker } from "../src/dwell.js";

function harness(options = {}) {
  let clock = 0;
  const tracker = createDwellTracker({ now: () => clock, ...options });
  return { tracker, advance: (ms) => { clock += ms; }, at: () => clock };
}

test("a brief pass-over is not interest and is discarded", () => {
  const { tracker, advance } = harness();
  tracker.enter("a");
  advance(MINIMUM_DWELL_MS - 1);
  tracker.leave("a");
  assert.deepEqual(tracker.snapshot(), []);
  assert.equal(tracker.strongest(), null);
});

test("dwell at or above the threshold is credited", () => {
  const { tracker, advance } = harness();
  tracker.enter("a");
  advance(400);
  tracker.leave("a");
  assert.equal(tracker.strongest().gameId, "a");
  assert.equal(tracker.strongest().score, 400);
});

test("repeated visits accumulate", () => {
  const { tracker, advance } = harness({ halfLifeMs: 1e9 });
  for (const _ of [0, 1, 2]) {
    tracker.enter("a");
    advance(200);
    tracker.leave("a");
  }
  assert.equal(tracker.strongest().score, 600);
});

test("a tile still under the pointer counts toward the ranking", () => {
  const { tracker, advance } = harness();
  tracker.enter("a");
  advance(500);
  // No leave() yet: the player is hovering right now.
  assert.equal(tracker.strongest().gameId, "a");
  assert.equal(tracker.strongest().score, 500);
});

test("dwell decays so stale interest loses to fresh interest", () => {
  const { tracker, advance } = harness({ halfLifeMs: 1_000 });
  tracker.enter("old");
  advance(1_000);
  tracker.leave("old");

  advance(3_000); // 3 half-lives: 1000 -> ~125

  tracker.enter("new");
  advance(300);
  tracker.leave("new");

  const ranked = tracker.snapshot();
  assert.equal(ranked[0].gameId, "new");
  assert.ok(ranked[1].score < 200, `stale entry should have decayed, got ${ranked[1].score}`);
});

test("keyboard focus is treated exactly like pointer hover", () => {
  // enter/leave are source-agnostic by design, so a keyboard user who tabs
  // onto a tile and pauses gets the same warm as a mouse user who hovers.
  const { tracker: keyboard, advance: advanceK } = harness();
  keyboard.enter("a");
  advanceK(400);
  keyboard.leave("a");

  const { tracker: pointer, advance: advanceP } = harness();
  pointer.enter("a");
  advanceP(400);
  pointer.leave("a");

  assert.deepEqual(keyboard.snapshot(), pointer.snapshot());
});

test("ranking is deterministic when scores tie", () => {
  const { tracker, advance } = harness();
  for (const id of ["b", "a"]) {
    tracker.enter(id);
    advance(300);
    tracker.leave(id);
  }
  // Equal scores fall back to a stable id order rather than insertion order.
  const ids = tracker.snapshot().map((entry) => entry.gameId);
  assert.deepEqual([...ids].sort(), ids);
});

test("tracked tiles are bounded and evict the least recently reinforced", () => {
  const { tracker, advance } = harness({ maxTracked: 2, halfLifeMs: 1e9 });
  for (const id of ["a", "b", "c"]) {
    tracker.enter(id);
    advance(200);
    tracker.leave(id);
  }
  const ids = tracker.snapshot().map((entry) => entry.gameId);
  assert.equal(ids.length, 2);
  assert.equal(ids.includes("a"), false);
});

test("unusable input and lifecycle edges are handled without throwing", () => {
  const { tracker, advance } = harness();
  for (const bad of ["", null, undefined, 42]) {
    tracker.enter(bad);
    tracker.leave(bad);
  }
  tracker.leave("never-entered");
  tracker.enter("a");
  tracker.enter("a"); // double enter must not reset the start time
  advance(300);
  tracker.leave("a");
  assert.equal(tracker.strongest().score, 300);

  tracker.reset();
  assert.deepEqual(tracker.snapshot(), []);
});

test("constructor rejects unusable configuration", () => {
  assert.throws(() => createDwellTracker({ now: "no" }), TypeError);
  assert.throws(() => createDwellTracker({ minimumDwellMs: 0 }), RangeError);
  assert.throws(() => createDwellTracker({ halfLifeMs: -1 }), RangeError);
  assert.throws(() => createDwellTracker({ maxTracked: Number.NaN }), RangeError);
});
