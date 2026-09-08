import test from "node:test";
import assert from "node:assert/strict";
import {
  createTrajectoryTracker,
  fitHeading,
  predictDestination,
} from "../src/trajectory.js";

/** A straight run of samples at a constant speed. */
function run({ from, to, count = 5, durationMs = 100 }) {
  return Array.from({ length: count }, (_, i) => {
    const fraction = i / (count - 1);
    return {
      x: from.x + (to.x - from.x) * fraction,
      y: from.y + (to.y - from.y) * fraction,
      t: durationMs * fraction,
    };
  });
}

const tile = (gameId, left, top, size = 200) => ({
  gameId, left, top, right: left + size, bottom: top + size,
});

test("a straight fast move yields a heading", () => {
  const heading = fitHeading(run({ from: { x: 0, y: 0 }, to: { x: 300, y: 0 } }));
  assert.ok(heading);
  assert.equal(Math.round(heading.x), 1);
  assert.equal(Math.round(heading.y), 0);
  assert.equal(Math.round(heading.speed), 3);
});

test("a slow drift is browsing, not travelling", () => {
  // 20 px over 100 ms is 0.2 px/ms, below the floor.
  assert.equal(fitHeading(run({ from: { x: 0, y: 0 }, to: { x: 20, y: 0 } })), null);
});

test("a turbulent path has no destination to predict", () => {
  const zigzag = [
    { x: 0, y: 0, t: 0 },
    { x: 60, y: 0, t: 20 },
    { x: 60, y: 90, t: 40 },
    { x: 130, y: 20, t: 60 },
    { x: 140, y: 130, t: 80 },
  ];
  assert.equal(fitHeading(zigzag), null);
});

test("too few samples is not a heading", () => {
  assert.equal(fitHeading([{ x: 0, y: 0, t: 0 }, { x: 90, y: 0, t: 10 }]), null);
  assert.equal(fitHeading(null), null);
  assert.equal(fitHeading([]), null);
});

test("the tile the pointer is travelling toward is predicted", () => {
  const samples = run({ from: { x: 0, y: 100 }, to: { x: 300, y: 100 } });
  const targets = [tile("near", 350, 20), tile("far", 900, 20), tile("behind", -400, 20)];
  assert.equal(predictDestination(samples, targets), "near");
});

test("a tile behind the pointer is never predicted", () => {
  const samples = run({ from: { x: 900, y: 100 }, to: { x: 600, y: 100 } });
  // Only candidate is to the right, i.e. behind a leftward move.
  assert.equal(predictDestination(samples, [tile("behind", 950, 20)]), null);
});

test("a tile beyond the projection horizon is not predicted", () => {
  const samples = run({ from: { x: 0, y: 100 }, to: { x: 300, y: 100 } });
  // Speed is 3 px/ms; a 220 ms horizon reaches ~660 px past x=300.
  assert.equal(predictDestination(samples, [tile("miles", 4_000, 20)]), null);
});

test("when the ray crosses two tiles the one entered first wins", () => {
  const samples = run({ from: { x: 0, y: 100 }, to: { x: 300, y: 100 } });
  // Overlapping bands on the same ray. The pointer reaches `first` sooner, so
  // that is where it is going; `second` is merely also on the line.
  const targets = [
    { gameId: "second", left: 420, top: 20, right: 1_000, bottom: 300 },
    { gameId: "first", left: 340, top: 0, right: 1_200, bottom: 400 },
  ];
  assert.equal(predictDestination(samples, targets), "first");
});

test("the tile the pointer is already inside is not its destination", () => {
  const samples = run({ from: { x: 0, y: 100 }, to: { x: 300, y: 100 } });
  // Dwell already covers the tile under the cursor; prediction is about next.
  assert.equal(predictDestination(samples, [tile("under-cursor", 250, 20)]), null);
});

test("malformed targets are skipped rather than throwing", () => {
  const samples = run({ from: { x: 0, y: 100 }, to: { x: 300, y: 100 } });
  assert.equal(predictDestination(samples, [{ gameId: "x" }]), null);
  assert.equal(predictDestination(samples, [{ left: 1, top: 1, right: 2, bottom: 2 }]), null);
  assert.equal(predictDestination(samples, []), null);
  assert.equal(predictDestination(samples, null), null);
});

test("the tracker accumulates samples and predicts from them", () => {
  let clock = 0;
  const tracker = createTrajectoryTracker({ now: () => clock });
  const targets = [tile("target", 350, 20)];

  assert.equal(tracker.predict(targets), null, "no samples yet");
  for (let i = 0; i <= 4; i += 1) {
    tracker.sample(i * 75, 100, clock);
    clock += 25;
  }
  assert.equal(tracker.predict(targets), "target");

  tracker.reset();
  assert.equal(tracker.predict(targets), null);
});

test("the tracker keeps only its window and ignores nonsense samples", () => {
  let clock = 0;
  const tracker = createTrajectoryTracker({ window: 3, now: () => clock });
  tracker.sample(Number.NaN, 100);
  tracker.sample(0, Number.POSITIVE_INFINITY);

  // A stale reversed leg must fall out of the window rather than poison the fit.
  for (const x of [900, 0, 75, 150]) {
    tracker.sample(x, 100, clock);
    clock += 25;
  }
  assert.equal(tracker.predict([tile("target", 200, 20)]), "target");
  assert.throws(() => createTrajectoryTracker({ window: 2 }), RangeError);
});
