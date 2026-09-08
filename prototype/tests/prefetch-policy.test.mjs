import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_K,
  MAX_K,
  WarmReason,
  selectWarmCandidates,
} from "../src/prefetch-policy.js";

test("dwell outranks recency, because it is about the launch about to happen", () => {
  const result = selectWarmCandidates({
    dwellCandidates: [{ gameId: "hovered", score: 900 }],
    recents: ["played-earlier"],
  });
  assert.deepEqual(result.candidates, ["hovered"]);
  assert.equal(result.reason, WarmReason.DWELL);
});

test("recency is used when there is no dwell signal", () => {
  const result = selectWarmCandidates({ recents: ["last-played", "before-that"] });
  assert.deepEqual(result.candidates, ["last-played"]);
  assert.equal(result.reason, WarmReason.RECENT);
});

test("k defaults to one, matching the measured cost conclusion", () => {
  const result = selectWarmCandidates({
    dwellCandidates: [{ gameId: "a" }, { gameId: "b" }, { gameId: "c" }],
  });
  assert.equal(DEFAULT_K, 1);
  assert.equal(result.candidates.length, 1);
});

test("a larger k fills from dwell first, then recency, without duplicates", () => {
  const result = selectWarmCandidates({
    dwellCandidates: [{ gameId: "a" }, { gameId: "b" }],
    recents: ["b", "c"],
    k: 3,
  });
  assert.deepEqual(result.candidates, ["a", "b", "c"]);
  assert.deepEqual(result.sources, [WarmReason.DWELL, WarmReason.DWELL, WarmReason.RECENT]);
});

test("already-warm titles are never warmed twice", () => {
  const result = selectWarmCandidates({
    dwellCandidates: [{ gameId: "cached" }],
    recents: ["cached", "fresh"],
    alreadyWarm: ["cached"],
  });
  assert.deepEqual(result.candidates, ["fresh"]);
  assert.equal(result.reason, WarmReason.RECENT);
});

test("no signal means warm nothing, not warm something popular", () => {
  const result = selectWarmCandidates({});
  assert.deepEqual(result.candidates, []);
  assert.equal(result.reason, WarmReason.NOTHING_TO_WARM);
});

test("the decision is marked cache-only", () => {
  // The view layer reads this as a refusal; prediction must not reach a player.
  assert.equal(selectWarmCandidates({ recents: ["a"] }).playerVisible, false);
});

test("k is bounded so waste cannot be configured away", () => {
  assert.throws(() => selectWarmCandidates({ k: 0 }), RangeError);
  assert.throws(() => selectWarmCandidates({ k: MAX_K + 1 }), RangeError);
  assert.throws(() => selectWarmCandidates({ k: 1.5 }), RangeError);
});

test("both string ids and dwell records are accepted", () => {
  const fromRecords = selectWarmCandidates({ dwellCandidates: [{ gameId: "a", score: 5 }] });
  const fromStrings = selectWarmCandidates({ dwellCandidates: ["a"] });
  assert.deepEqual(fromRecords.candidates, fromStrings.candidates);
  assert.throws(() => selectWarmCandidates({ recents: "nope" }), TypeError);
});

test("malformed entries are skipped rather than warmed", () => {
  const result = selectWarmCandidates({
    dwellCandidates: [null, { gameId: "" }, { score: 9 }, { gameId: "real" }],
  });
  assert.deepEqual(result.candidates, ["real"]);
});
