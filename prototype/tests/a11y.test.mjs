import test from "node:test";
import assert from "node:assert/strict";
import {
  FOCUSABLE_SELECTOR,
  describeDrawerResults,
  nextRovingIndex,
  nextTrapIndex,
  prefersReducedMotion,
} from "../src/a11y.js";

test("roving tabindex moves and wraps in both directions", () => {
  assert.equal(nextRovingIndex(0, "ArrowDown", 3), 1);
  assert.equal(nextRovingIndex(2, "ArrowDown", 3), 0);
  assert.equal(nextRovingIndex(0, "ArrowUp", 3), 2);
  assert.equal(nextRovingIndex(1, "ArrowUp", 3), 0);
  assert.equal(nextRovingIndex(1, "Home", 3), 0);
  assert.equal(nextRovingIndex(1, "End", 3), 2);
});

test("roving tabindex leaves unrelated keys and bad input alone", () => {
  // Returning the current index tells the caller not to preventDefault.
  assert.equal(nextRovingIndex(1, "a", 3), 1);
  assert.equal(nextRovingIndex(1, "Tab", 3), 1);
  assert.equal(nextRovingIndex(0, "ArrowDown", 0), -1);
  assert.equal(nextRovingIndex(0, "ArrowDown", -1), -1);
  // Out-of-range and non-integer indices are clamped rather than propagated.
  assert.equal(nextRovingIndex(99, "ArrowDown", 3), 0);
  assert.equal(nextRovingIndex(null, "ArrowDown", 3), 1);
});

test("focus trap wraps so focus cannot escape a modal transition", () => {
  assert.equal(nextTrapIndex(0, {}, 3), 1);
  assert.equal(nextTrapIndex(2, {}, 3), 0);
  assert.equal(nextTrapIndex(0, { shiftKey: true }, 3), 2);
  assert.equal(nextTrapIndex(2, { shiftKey: true }, 3), 1);
  // Focus currently outside the trap enters at the correct end.
  assert.equal(nextTrapIndex(-1, {}, 3), 0);
  assert.equal(nextTrapIndex(-1, { shiftKey: true }, 3), 2);
  assert.equal(nextTrapIndex(0, {}, 0), -1);
});

test("reduced motion falls back to the safer answer when unsupported", () => {
  assert.equal(prefersReducedMotion(() => ({ matches: true })), true);
  assert.equal(prefersReducedMotion(() => ({ matches: false })), false);
  // No matchMedia, or a throwing implementation, must not mean "animate".
  assert.equal(prefersReducedMotion(undefined), true);
  assert.equal(prefersReducedMotion("not a function"), true);
  assert.equal(prefersReducedMotion(() => { throw new Error("unsupported"); }), true);
  assert.equal(prefersReducedMotion(() => ({})), false);
});

test("drawer announcements distinguish every empty state", () => {
  assert.equal(
    describeDrawerResults({ view: "FAVOURITES", count: 1 }),
    "1 game in favourites.",
  );
  assert.equal(
    describeDrawerResults({ view: "SEARCH", count: 4 }),
    "4 games in search.",
  );
  const messages = ["NO_FAVOURITES", "NO_RECENTS", "EMPTY_QUERY", "NO_MATCHES", null]
    .map((emptyReason) => describeDrawerResults({ view: "SEARCH", count: 0, emptyReason }));
  // Every empty state says something different, so silence is never ambiguous.
  assert.equal(new Set(messages).size, messages.length);
  for (const message of messages) assert.match(message, /\S/);
});

test("the focusable selector excludes programmatically-focused elements", () => {
  assert.match(FOCUSABLE_SELECTOR, /button:not\(\[disabled\]\)/);
  assert.match(FOCUSABLE_SELECTOR, /tabindex="-1"/);
});
