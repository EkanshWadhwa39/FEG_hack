import test from "node:test";
import assert from "node:assert/strict";
import { SpeculationTier } from "../src/governor.js";
import {
  PREINIT_DWELL_MS,
  RefusalReason,
  Rung,
  SpeculationAction,
  WARM_DWELL_MS,
  createByteLedger,
  planSpeculation,
} from "../src/speculation.js";

const allow = (tier = SpeculationTier.FULL) => Object.freeze({
  allowed: true, reason: "ALLOWED", tier, remainingBytes: Infinity, projectedBytes: null,
});

const base = Object.freeze({
  authorization: "GRANTED",
  governor: allow(),
  costs: { warmBytes: 3_000_000, engineBytes: 50_000_000 },
  budget: { byteBudget: 96 * 1_048_576, bytesUsed: 0 },
});

const actionsOf = (plan, action) =>
  plan.actions.filter((entry) => entry.action === action).map((entry) => entry.gameId);

test("no authorization means no speculation of any kind", () => {
  for (const authorization of ["DENIED", "UNKNOWN", undefined, "granted"]) {
    const plan = planSpeculation({
      ...base,
      authorization,
      candidates: [{ gameId: "a", score: 5_000 }],
    });
    assert.equal(plan.rung, Rung.NONE);
    assert.equal(plan.refusedBecause, RefusalReason.AUTHORIZATION);
    assert.deepEqual(plan.actions, []);
  }
});

test("losing authorization tears down an engine that is already in flight", () => {
  const plan = planSpeculation({
    ...base,
    authorization: "DENIED",
    candidates: [{ gameId: "a", score: 5_000 }],
    preinit: { state: "PREPARED", gameId: "a" },
  });
  assert.deepEqual(actionsOf(plan, SpeculationAction.CANCEL_ENGINE), ["a"]);
});

test("a governor refusal also tears the engine down", () => {
  const plan = planSpeculation({
    ...base,
    governor: { allowed: false, reason: "SAVE_DATA", tier: SpeculationTier.NONE },
    candidates: [{ gameId: "a", score: 5_000 }],
    preinit: { state: "PREPARING", gameId: "a" },
  });
  assert.equal(plan.refusedBecause, RefusalReason.GOVERNOR);
  assert.deepEqual(actionsOf(plan, SpeculationAction.CANCEL_ENGINE), ["a"]);
});

test("a glance buys a transport hint and nothing else", () => {
  const plan = planSpeculation({
    ...base,
    candidates: [{ gameId: "a", score: WARM_DWELL_MS - 1 }],
  });
  assert.equal(plan.rung, Rung.CONNECT);
  assert.deepEqual(actionsOf(plan, SpeculationAction.PREWARM_CONNECTION), ["a"]);
  assert.deepEqual(actionsOf(plan, SpeculationAction.WARM_BYTES), []);
  assert.deepEqual(actionsOf(plan, SpeculationAction.PREPARE_ENGINE), []);
});

test("a short dwell buys bytes, hedged across the strongest few candidates", () => {
  const plan = planSpeculation({
    ...base,
    candidates: [
      { gameId: "a", score: 400 },
      { gameId: "b", score: 300 },
      { gameId: "c", score: 250 },
      { gameId: "d", score: 210 },
    ],
  });
  assert.equal(plan.rung, Rung.WARM);
  assert.equal(plan.target, "a");
  // Bytes are cheap enough to hedge, but not unboundedly.
  assert.deepEqual(actionsOf(plan, SpeculationAction.WARM_BYTES), ["a", "b", "c"]);
  assert.deepEqual(actionsOf(plan, SpeculationAction.PREPARE_ENGINE), []);
});

test("a sustained dwell buys an engine, and only for the strongest candidate", () => {
  const plan = planSpeculation({
    ...base,
    candidates: [
      { gameId: "a", score: PREINIT_DWELL_MS },
      { gameId: "b", score: PREINIT_DWELL_MS },
    ],
  });
  assert.equal(plan.rung, Rung.PREINIT);
  assert.deepEqual(actionsOf(plan, SpeculationAction.PREPARE_ENGINE), ["a"]);
});

test("the reduced tier never buys an engine, however strong the intent", () => {
  const plan = planSpeculation({
    ...base,
    governor: allow(SpeculationTier.REDUCED),
    candidates: [{ gameId: "a", score: 60_000 }],
  });
  assert.equal(plan.rung, Rung.WARM);
  assert.deepEqual(actionsOf(plan, SpeculationAction.PREPARE_ENGINE), []);
  assert.deepEqual(actionsOf(plan, SpeculationAction.WARM_BYTES), ["a"]);
});

test("an unaffordable engine falls back to bytes rather than to nothing", () => {
  const plan = planSpeculation({
    ...base,
    budget: { byteBudget: 10_000_000, bytesUsed: 0 },
    candidates: [{ gameId: "a", score: 5_000 }],
  });
  assert.equal(plan.rung, Rung.WARM);
  assert.deepEqual(actionsOf(plan, SpeculationAction.WARM_BYTES), ["a"]);
});

test("an exhausted budget stops bytes but still allows the free rung", () => {
  const plan = planSpeculation({
    ...base,
    budget: { byteBudget: 1_000, bytesUsed: 900 },
    candidates: [{ gameId: "a", score: 5_000 }],
  });
  assert.equal(plan.rung, Rung.CONNECT);
  assert.equal(plan.refusedBecause, RefusalReason.BUDGET);
  assert.deepEqual(actionsOf(plan, SpeculationAction.PREWARM_CONNECTION), ["a"]);
  assert.deepEqual(actionsOf(plan, SpeculationAction.WARM_BYTES), []);
});

test("a touch-down outranks every hover score and goes straight to the top", () => {
  const plan = planSpeculation({
    ...base,
    committed: "z",
    candidates: [{ gameId: "a", score: 30_000 }],
  });
  assert.equal(plan.target, "z");
  assert.deepEqual(actionsOf(plan, SpeculationAction.PREPARE_ENGINE), ["z"]);
});

test("an engine already prepared for the target is not prepared again", () => {
  const plan = planSpeculation({
    ...base,
    candidates: [{ gameId: "a", score: 5_000 }],
    preinit: { state: "PREPARED", gameId: "a" },
  });
  assert.equal(plan.rung, Rung.PREINIT);
  assert.equal(plan.refusedBecause, RefusalReason.ALREADY_DONE);
  assert.deepEqual(actionsOf(plan, SpeculationAction.PREPARE_ENGINE), []);
});

test("intent moving to another title reclaims the previous engine", () => {
  const plan = planSpeculation({
    ...base,
    candidates: [{ gameId: "b", score: 400 }],
    preinit: { state: "PREPARED", gameId: "a" },
  });
  assert.deepEqual(actionsOf(plan, SpeculationAction.CANCEL_ENGINE), ["a"]);
});

test("a pointer that merely wobbles off a tile does not thrash the engine", () => {
  // Between the release threshold and the prepare threshold, the engine is
  // neither rebuilt nor thrown away.
  const plan = planSpeculation({
    ...base,
    candidates: [{ gameId: "a", score: 300 }],
    preinit: { state: "PREPARED", gameId: "a" },
  });
  assert.deepEqual(actionsOf(plan, SpeculationAction.CANCEL_ENGINE), []);
  assert.deepEqual(actionsOf(plan, SpeculationAction.PREPARE_ENGINE), []);
});

test("no intent at all reclaims any engine and does nothing else", () => {
  const plan = planSpeculation({ ...base, candidates: [], preinit: { state: "PREPARED", gameId: "a" } });
  assert.equal(plan.rung, Rung.NONE);
  assert.equal(plan.refusedBecause, RefusalReason.NO_INTENT);
  assert.deepEqual(actionsOf(plan, SpeculationAction.CANCEL_ENGINE), ["a"]);
});

test("nothing the ladder produces is ever player-visible", () => {
  const plan = planSpeculation({ ...base, candidates: [{ gameId: "a", score: 5_000 }] });
  assert.equal(plan.playerVisible, false);
});

test("already-connected and already-warmed titles are not repeated", () => {
  const plan = planSpeculation({
    ...base,
    candidates: [{ gameId: "a", score: 400 }, { gameId: "b", score: 300 }],
    connected: ["a", "b"],
    warmed: ["a"],
  });
  assert.deepEqual(actionsOf(plan, SpeculationAction.PREWARM_CONNECTION), []);
  assert.deepEqual(actionsOf(plan, SpeculationAction.WARM_BYTES), ["b"]);
});

test("the ledger charges once per game and rung, and refunds", () => {
  const ledger = createByteLedger({ byteBudget: 1_000 });
  assert.equal(ledger.charge("a", Rung.WARM, 100), true);
  // Re-evaluating the ladder several times a second must not re-bill.
  assert.equal(ledger.charge("a", Rung.WARM, 100), false);
  assert.equal(ledger.bytesUsed(), 100);

  assert.equal(ledger.charge("a", Rung.PREINIT, 500), true);
  assert.equal(ledger.bytesUsed(), 600);
  assert.equal(ledger.remaining(), 400);

  assert.equal(ledger.refund("a", Rung.PREINIT), true);
  assert.equal(ledger.bytesUsed(), 100);
  assert.equal(ledger.refund("a", Rung.PREINIT), false);

  ledger.reset();
  assert.equal(ledger.bytesUsed(), 0);
});

test("the ledger rejects invalid charges and budgets", () => {
  const ledger = createByteLedger({ byteBudget: 10 });
  assert.equal(ledger.charge("", Rung.WARM, 1), false);
  assert.equal(ledger.charge("a", Rung.WARM, -1), false);
  assert.equal(ledger.charge("a", Rung.WARM, Number.NaN), false);
  assert.throws(() => createByteLedger({ byteBudget: -1 }), RangeError);
});

test("a prepared engine is not re-billed, so it cannot look unaffordable", () => {
  // The ladder is re-evaluated several times a second. Charging the engine
  // again on every tick made a prepared engine fail the budget check and
  // demoted the reported rung back to CONNECT while the engine was still live.
  const plan = planSpeculation({
    ...base,
    candidates: [{ gameId: "a", score: 5_000 }],
    preinit: { state: "PREPARED", gameId: "a" },
    budget: { byteBudget: 96 * 1_048_576, bytesUsed: 70 * 1_048_576 },
  });
  assert.equal(plan.rung, Rung.PREINIT);
  assert.equal(plan.refusedBecause, RefusalReason.ALREADY_DONE);
});

test("a target whose bytes are already resident still reads as the WARM rung", () => {
  const plan = planSpeculation({
    ...base,
    governor: allow(SpeculationTier.REDUCED),
    candidates: [{ gameId: "a", score: 400 }],
    connected: ["a"],
    warmed: ["a"],
  });
  assert.equal(plan.rung, Rung.WARM);
  assert.equal(plan.refusedBecause, RefusalReason.ALREADY_DONE);
  assert.deepEqual(plan.actions, []);
});
