import test from "node:test";
import assert from "node:assert/strict";
import {
  DEGRADED_BYTE_BUDGET,
  DeviceReason,
  GovernorReason,
  SpeculationTier,
  applyDeviceConstraint,
  assessDeviceForEngine,
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

/* ------------------------- device capability ------------------------- */

test("a constrained device gets bytes but never a speculative engine", () => {
  const lowMemory = assessDeviceForEngine({ deviceMemory: 2 });
  assert.equal(lowMemory.engineAllowed, false);
  assert.equal(lowMemory.reason, DeviceReason.LOW_MEMORY);

  const lowBattery = assessDeviceForEngine({
    deviceMemory: 8, battery: { level: 0.1, charging: false },
  });
  assert.equal(lowBattery.engineAllowed, false);
  assert.equal(lowBattery.reason, DeviceReason.LOW_BATTERY);
});

test("a low but charging battery is not a constraint", () => {
  const charging = assessDeviceForEngine({
    deviceMemory: 8, battery: { level: 0.05, charging: true },
  });
  assert.equal(charging.engineAllowed, true);
});

test("absent device APIs are not evidence of a constrained device", () => {
  // deviceMemory is Chromium-only and the Battery API is gone from iOS and
  // Firefox. Treating absence as a constraint would disable the engine rung
  // for most of the audience, which is the bug this whole tier exists to avoid.
  assert.equal(assessDeviceForEngine({}).engineAllowed, true);
  assert.equal(assessDeviceForEngine().engineAllowed, true);
  assert.equal(
    assessDeviceForEngine({ deviceMemory: 8, battery: { level: Number.NaN } }).engineAllowed,
    true,
  );
});

test("a device constraint lowers the tier but never raises or overturns one", () => {
  const constrained = assessDeviceForEngine({ deviceMemory: 2 });

  const full = assessPrefetch(safeInput);
  const lowered = applyDeviceConstraint(full, constrained);
  assert.equal(lowered.tier, SpeculationTier.REDUCED);
  assert.equal(lowered.deviceReason, DeviceReason.LOW_MEMORY);

  // Already reduced: unchanged.
  const reduced = assessPrefetch({ ...safeInput, effectiveType: "3g" });
  assert.equal(applyDeviceConstraint(reduced, constrained).tier, SpeculationTier.REDUCED);

  // A refusal stays a refusal, and a healthy device changes nothing.
  const refused = assessPrefetch({ ...safeInput, saveData: true });
  assert.equal(applyDeviceConstraint(refused, constrained), refused);
  assert.equal(applyDeviceConstraint(full, assessDeviceForEngine({ deviceMemory: 8 })), full);
  assert.equal(applyDeviceConstraint(full, null), full);
});
