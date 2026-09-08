import test from "node:test";
import assert from "node:assert/strict";
import {
  DEGRADED_BYTE_BUDGET,
  GovernorReason,
  SpeculationTier,
  assessPrefetch,
  readConnectionCapability,
} from "../src/governor.js";

const safeInput = Object.freeze({
  enabled: true,
  saveData: false,
  effectiveType: "4g",
  connectionApiAvailable: true,
  visibilityState: "visible",
  byteBudget: 1_000,
  bytesUsed: 200,
  nextAssetBytes: 300,
});

test("allows an explicitly safe request within budget at the full tier", () => {
  assert.deepEqual(assessPrefetch(safeInput), {
    allowed: true,
    reason: GovernorReason.ALLOWED,
    tier: SpeculationTier.FULL,
    remainingBytes: 800,
    projectedBytes: 500,
  });
});

test("blocks when disabled, Save-Data is enabled, or the page is hidden", () => {
  assert.equal(assessPrefetch({ ...safeInput, enabled: false }).reason, GovernorReason.DISABLED);
  assert.equal(assessPrefetch({ ...safeInput, saveData: true }).reason, GovernorReason.SAVE_DATA);
  assert.equal(assessPrefetch({ ...safeInput, visibilityState: "hidden" }).reason, GovernorReason.PAGE_HIDDEN);
});

test("Save-Data outranks the capability-degraded path", () => {
  // A browser without the API cannot report saveData, but if a caller does
  // report it the player's instruction must still win.
  const decision = assessPrefetch({
    ...safeInput,
    connectionApiAvailable: false,
    saveData: true,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, GovernorReason.SAVE_DATA);
});

test("a browser with no Network Information API degrades instead of refusing", () => {
  // This is the Firefox and iOS case. Refusing here silently disabled warming
  // for every non-Chromium player while appearing to work in development.
  const decision = assessPrefetch({
    ...safeInput,
    connectionApiAvailable: false,
    saveData: undefined,
    effectiveType: undefined,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, GovernorReason.ALLOWED_DEGRADED);
  assert.equal(decision.tier, SpeculationTier.REDUCED);
});

test("the degraded tier is capped at the reduced budget", () => {
  const decision = assessPrefetch({
    ...safeInput,
    connectionApiAvailable: false,
    saveData: undefined,
    effectiveType: undefined,
    byteBudget: 512 * 1_048_576,
    bytesUsed: DEGRADED_BYTE_BUDGET,
    nextAssetBytes: 1,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, GovernorReason.BUDGET_EXCEEDED);
});

test("an API that is present but will not answer still fails closed", () => {
  for (const broken of [{ effectiveType: undefined }, { saveData: undefined }, { saveData: 0 }]) {
    const decision = assessPrefetch({ ...safeInput, ...broken });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, GovernorReason.CONNECTION_UNKNOWN);
    assert.equal(decision.tier, SpeculationTier.NONE);
  }
});

test("3g warms bytes but never an engine, and 2g does nothing", () => {
  const slow = assessPrefetch({ ...safeInput, effectiveType: "3g" });
  assert.equal(slow.allowed, true);
  assert.equal(slow.tier, SpeculationTier.REDUCED);

  for (const effectiveType of ["2g", "slow-2g", "unknown-future-type"]) {
    const decision = assessPrefetch({ ...safeInput, effectiveType });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, GovernorReason.SLOW_CONNECTION);
  }
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

test("capability reading reports absence explicitly rather than as a missing value", () => {
  assert.deepEqual(readConnectionCapability({}), {
    connectionApiAvailable: false,
    saveData: undefined,
    effectiveType: undefined,
  });
  assert.deepEqual(
    readConnectionCapability({ connection: { saveData: false, effectiveType: "4g" } }),
    { connectionApiAvailable: true, saveData: false, effectiveType: "4g" },
  );
  // Prefixed implementations count as present.
  assert.equal(
    readConnectionCapability({ mozConnection: { saveData: true, effectiveType: "3g" } })
      .connectionApiAvailable,
    true,
  );
  assert.equal(readConnectionCapability(undefined).connectionApiAvailable, false);
});
