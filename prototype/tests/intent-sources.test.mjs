import test from "node:test";
import assert from "node:assert/strict";
import { createDwellTracker } from "../src/dwell.js";
import {
  attachTileIntent,
  createViewportDwell,
  selectViewportFocus,
} from "../src/intent-sources.js";

/** Minimal event target, so these tests need no DOM. */
function fakeElement() {
  const handlers = new Map();
  return {
    handlers,
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    fire(type, event = {}) {
      for (const handler of handlers.get(type) ?? []) handler(event);
    },
  };
}

test("the tile nearest the centre of a settled viewport wins", () => {
  const focus = selectViewportFocus([
    { gameId: "top", top: 0, bottom: 100, ratio: 1 },
    { gameId: "middle", top: 380, bottom: 480, ratio: 1 },
    { gameId: "bottom", top: 700, bottom: 800, ratio: 1 },
  ], 800);
  assert.equal(focus, "middle");
});

test("a barely-visible tile is not being looked at", () => {
  assert.equal(
    selectViewportFocus([{ gameId: "clipped", top: 760, bottom: 860, ratio: 0.4 }], 800),
    null,
  );
});

test("viewport focus rejects nonsense rather than guessing", () => {
  assert.equal(selectViewportFocus(null, 800), null);
  assert.equal(selectViewportFocus([], 0), null);
  assert.equal(selectViewportFocus([{ gameId: "a", top: Number.NaN, bottom: 1, ratio: 1 }], 800), null);
  assert.equal(selectViewportFocus([{ top: 0, bottom: 10, ratio: 1 }], 800), null);
});

test("pointer, keyboard and touch all credit the same dwell tracker", () => {
  let clock = 0;
  const dwell = createDwellTracker({ now: () => clock });
  const element = fakeElement();
  const commits = [];
  attachTileIntent({
    element, gameId: "a", dwell,
    onCommit: (id) => commits.push(id),
    onRelease: (id) => commits.push(`-${id}`),
  });

  element.fire("mouseenter");
  clock += 500;
  element.fire("mouseleave");
  assert.equal(dwell.strongest().gameId, "a");

  dwell.reset();
  element.fire("focus");
  clock += 500;
  element.fire("blur");
  assert.equal(dwell.strongest().gameId, "a", "keyboard focus must count like hover");

  element.fire("pointerdown", { pointerType: "touch" });
  assert.deepEqual(commits, ["a"]);
  element.fire("pointercancel");
  assert.deepEqual(commits, ["a", "-a"]);
});

test("a mouse press does not commit, because hover already covered it", () => {
  const dwell = createDwellTracker();
  const element = fakeElement();
  const commits = [];
  attachTileIntent({ element, gameId: "a", dwell, onCommit: (id) => commits.push(id) });

  element.fire("pointerdown", { pointerType: "mouse" });
  assert.deepEqual(commits, []);
});

test("detaching removes every listener", () => {
  const dwell = createDwellTracker();
  const element = fakeElement();
  const detach = attachTileIntent({ element, gameId: "a", dwell });
  detach();
  for (const handlers of element.handlers.values()) assert.equal(handlers.size, 0);
});

test("attaching rejects a missing element, id, or tracker", () => {
  const dwell = createDwellTracker();
  assert.throws(() => attachTileIntent({ element: null, gameId: "a", dwell }), TypeError);
  assert.throws(() => attachTileIntent({ element: fakeElement(), gameId: "", dwell }), TypeError);
  assert.throws(() => attachTileIntent({ element: fakeElement(), gameId: "a", dwell: {} }), TypeError);
});

test("a settled viewport credits dwell; a moving one credits nothing", () => {
  let clock = 0;
  const dwell = createDwellTracker({ now: () => clock });
  const timers = [];
  let visible = [{ gameId: "b", top: 380, bottom: 480, ratio: 1 }];

  const viewport = createViewportDwell({
    dwell,
    readVisibleTiles: () => visible,
    viewportHeight: () => 800,
    setTimeoutImpl: (fn) => { timers.push(fn); return timers.length; },
    clearTimeoutImpl: () => {},
  });

  viewport.onScroll();
  assert.equal(viewport.focused(), null, "still scrolling: nothing is credited yet");
  timers.pop()();
  assert.equal(viewport.focused(), "b");

  // Dwell accrues while the viewport stays settled.
  clock += 1_000;
  assert.equal(dwell.strongest().gameId, "b");

  // A flick to another tile stops crediting the old one immediately.
  visible = [{ gameId: "c", top: 380, bottom: 480, ratio: 1 }];
  viewport.onScroll();
  assert.equal(viewport.focused(), null);
  timers.pop()();
  assert.equal(viewport.focused(), "c");

  viewport.stop();
  assert.equal(viewport.focused(), null);
});

test("viewport dwell rejects missing dependencies", () => {
  assert.throws(() => createViewportDwell({ readVisibleTiles: () => [] }), TypeError);
  assert.throws(() => createViewportDwell({ dwell: createDwellTracker() }), TypeError);
});
