import test from "node:test";
import assert from "node:assert/strict";
import { assessPrefetch, GovernorReason } from "../src/governor.js";

const safeInput = Object.freeze({
  enabled: true,
  saveData: false,
  effectiveType: "4g",
  visibilityState: "visible",
  byteBudget: 1_000,
  bytesUsed: 200,
  nextAssetBytes: 300,
});

test("allows an explicitly safe request within budget", () => {
  assert.deepEqual(assessPrefetch(safeInput), {
    allowed: true,
    reason: GovernorReason.ALLOWED,
    remainingBytes: 800,
    projectedBytes: 500,
  });
});

test("blocks when disabled, Save-Data is enabled, or the page is hidden", () => {
  assert.equal(assessPrefetch({ ...safeInput, enabled: false }).reason, GovernorReason.DISABLED);
  assert.equal(assessPrefetch({ ...safeInput, saveData: true }).reason, GovernorReason.SAVE_DATA);
  assert.equal(assessPrefetch({ ...safeInput, visibilityState: "hidden" }).reason, GovernorReason.PAGE_HIDDEN);
});

test("blocks slow and unknown connection capabilities", () => {
  assert.equal(assessPrefetch({ ...safeInput, effectiveType: "3g" }).reason, GovernorReason.SLOW_CONNECTION);
  assert.equal(assessPrefetch({ ...safeInput, effectiveType: undefined }).reason, GovernorReason.CONNECTION_UNKNOWN);
  assert.equal(assessPrefetch({ ...safeInput, saveData: undefined }).reason, GovernorReason.CONNECTION_UNKNOWN);
});

test("blocks unknown visibility conservatively", () => {
  assert.equal(
    assessPrefetch({ ...safeInput, visibilityState: undefined }).reason,
    GovernorReason.VISIBILITY_UNKNOWN,
  );
});

test("allows an exact budget boundary and blocks an overrun", () => {
  assert.equal(
    assessPrefetch({ ...safeInput, byteBudget: 500 }).reason,
    GovernorReason.ALLOWED,
  );
  assert.equal(
    assessPrefetch({ ...safeInput, byteBudget: 499 }).reason,
    GovernorReason.BUDGET_EXCEEDED,
  );
});

test("invalid or missing budget data fails closed", () => {
  assert.equal(
    assessPrefetch({ ...safeInput, nextAssetBytes: -1 }).reason,
    GovernorReason.BUDGET_INVALID,
  );
  assert.equal(assessPrefetch().allowed, false);
});
