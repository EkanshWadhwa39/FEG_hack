import test from "node:test";
import assert from "node:assert/strict";
import {
  ANNOUNCEMENT_FLOOR_MS,
  AUTHORITATIVE_SOURCES,
  REJECTED_SOURCES,
  TransitionState,
  createTransition,
} from "../src/transition.js";

/** Deterministic clock plus scheduler so no test depends on real time. */
function createHarness(options = {}) {
  let currentTime = 0;
  let nextId = 1;
  const timers = new Map();

  const now = () => currentTime;
  const schedule = (callback, delay) => {
    const id = nextId++;
    timers.set(id, { callback, dueAt: currentTime + Math.max(0, delay) });
    return id;
  };
  const cancel = (id) => timers.delete(id);

  const advance = (milliseconds) => {
    const target = currentTime + milliseconds;
    // Run timers in due order, allowing callbacks to schedule follow-ups.
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((a, b) => a[1].dueAt - b[1].dueAt);
      if (due.length === 0) break;
      const [id, timer] = due[0];
      timers.delete(id);
      currentTime = Math.max(currentTime, timer.dueAt);
      timer.callback();
    }
    currentTime = target;
  };

  const transition = createTransition({ now, schedule, cancel, ...options });
  return { transition, advance, pendingTimers: () => timers.size };
}

test("opening shows the screen and never schedules its own dismissal", () => {
  const { transition, advance } = createHarness();
  assert.equal(transition.getState().state, TransitionState.IDLE);

  transition.open();
  assert.equal(transition.getState().state, TransitionState.VISIBLE);

  // An hour with no authoritative signal must not clear the screen.
  advance(3_600_000);
  assert.equal(transition.getState().state, TransitionState.VISIBLE);
  assert.equal(transition.getState().interactive, false);
});

test("first paint is recorded but never advances readiness", () => {
  const { transition, advance } = createHarness();
  transition.open();
  advance(5_000);

  const snapshot = transition.notifyFirstPaint();
  assert.equal(snapshot.state, TransitionState.VISIBLE);
  assert.equal(snapshot.interactive, false);
});

test("non-authoritative readiness signals are refused loudly", () => {
  const { transition } = createHarness();
  transition.open();

  for (const source of REJECTED_SOURCES) {
    assert.throws(
      () => transition.signalInteractive(source),
      RangeError,
      `${source} must not be accepted as interactive`,
    );
  }
  for (const bad of [null, undefined, 42, "", "input_accepted"]) {
    assert.throws(() => transition.signalInteractive(bad), RangeError);
  }
  assert.equal(transition.getState().state, TransitionState.VISIBLE);
  assert.equal(transition.getState().interactive, false);
});

test("an authoritative signal before the floor holds for the remainder", () => {
  const { transition, advance } = createHarness({ announcementMs: 1_000 });
  transition.open();

  advance(300);
  transition.signalInteractive(AUTHORITATIVE_SOURCES[0]);

  // Interactive is true immediately, but the screen is still held.
  assert.equal(transition.getState().interactive, true);
  assert.equal(transition.getState().state, TransitionState.VISIBLE);

  advance(699);
  assert.equal(transition.getState().state, TransitionState.VISIBLE);

  advance(1);
  assert.equal(transition.getState().state, TransitionState.CLEARED);
});

test("an authoritative signal after the floor clears without extra delay", () => {
  const { transition, advance } = createHarness({ announcementMs: 1_000 });
  transition.open();
  advance(4_000);

  assert.equal(transition.getState().announcementSatisfied, true);
  transition.signalInteractive("INPUT_ACCEPTED");
  assert.equal(transition.getState().state, TransitionState.CLEARED);
});

test("the announcement floor alone never clears the screen", () => {
  const { transition, advance, pendingTimers } = createHarness({ announcementMs: 500 });
  transition.open();

  advance(500);
  assert.equal(transition.getState().announcementSatisfied, true);
  assert.equal(transition.getState().state, TransitionState.VISIBLE);
  // Nothing is queued that could dismiss the screen on its own.
  assert.equal(pendingTimers(), 0);
});

test("extended duration lengthens the floor and cannot be shortened mid-hold", () => {
  const { transition, advance } = createHarness({
    announcementMs: 1_000,
    extendedAnnouncementMs: 3_000,
    extendedDuration: true,
  });
  transition.open();
  assert.equal(transition.getState().announcementFloorMs, 3_000);

  advance(1_200);
  transition.signalInteractive("INPUT_ACCEPTED");
  assert.equal(transition.getState().state, TransitionState.VISIBLE);

  advance(1_799);
  assert.equal(transition.getState().state, TransitionState.VISIBLE);
  advance(1);
  assert.equal(transition.getState().state, TransitionState.CLEARED);
});

test("enabling extended duration mid-transition extends an in-flight hold", () => {
  const { transition, advance } = createHarness({
    announcementMs: 1_000,
    extendedAnnouncementMs: 3_000,
  });
  transition.open();
  advance(200);
  transition.signalInteractive("INPUT_ACCEPTED");

  transition.setExtendedDuration(true);
  advance(900);
  assert.equal(transition.getState().state, TransitionState.VISIBLE);

  advance(2_000);
  assert.equal(transition.getState().state, TransitionState.CLEARED);
});

test("failure rolls back without ever reporting interactive or cleared", () => {
  const { transition, advance } = createHarness({ announcementMs: 100 });
  transition.open();
  advance(50);

  transition.fail("NETWORK_LOST");
  const failed = transition.getState();
  assert.equal(failed.state, TransitionState.FAILED);
  assert.equal(failed.interactive, false);
  assert.equal(failed.failureReason, "NETWORK_LOST");

  // A late signal must not resurrect a failed transition.
  transition.signalInteractive("INPUT_ACCEPTED");
  advance(10_000);
  assert.equal(transition.getState().state, TransitionState.FAILED);
});

test("reset returns to idle and subscribers can unsubscribe", () => {
  const { transition, advance } = createHarness({ announcementMs: 10 });
  const seen = [];
  const unsubscribe = transition.subscribe(
    ({ state, interactive }) => seen.push(`${state}:${interactive}`),
  );

  transition.open();
  advance(20);
  transition.signalInteractive("INPUT_ACCEPTED");
  // Readiness and dismissal are separate events: the machine reports that it
  // became interactive while still visible, then reports the clear.
  assert.deepEqual(seen, ["VISIBLE:false", "VISIBLE:true", "CLEARED:true"]);

  unsubscribe();
  transition.reset();
  assert.equal(seen.length, 3);
  assert.equal(transition.getState().state, TransitionState.IDLE);
  assert.throws(() => transition.subscribe("nope"), TypeError);
});

test("constructor rejects invalid dependencies and floors", () => {
  assert.throws(() => createTransition({ now: "no" }), TypeError);
  assert.throws(() => createTransition({ announcementMs: -1 }), RangeError);
  assert.throws(() => createTransition({ extendedAnnouncementMs: Number.NaN }), RangeError);
  assert.equal(ANNOUNCEMENT_FLOOR_MS.EXTENDED > ANNOUNCEMENT_FLOOR_MS.STANDARD, true);
});
