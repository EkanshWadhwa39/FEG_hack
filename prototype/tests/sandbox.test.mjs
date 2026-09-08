import test from "node:test";
import assert from "node:assert/strict";

import {
  AuthorizationState,
  runSandboxWarmPhase,
  SandboxArm,
  SandboxStatus,
} from "../src/sandbox.js";

const target = Object.freeze({ locale: "hr-HR", tier: "1x" });
const manifest = Object.freeze({
  locales: {
    "hr-HR": {
      tiers: {
        "1x": {
          assets: [
            { url: "https://cdn.example.test/preloader.js?v=17", stage: "PRELOADER", estimatedBytes: 10 },
            { url: "https://cdn.example.test/common.js?v=17", stage: "COMMON", estimatedBytes: 20 },
          ],
        },
      },
    },
  },
});
const safeEnvironment = Object.freeze({
  enabled: true,
  saveData: false,
  effectiveType: "4g",
  visibilityState: "visible",
  byteBudget: 100,
  bytesUsed: 0,
});

test("unknown or denied authorization fails closed before manifest access or requests", async () => {
  let requests = 0;
  const poisonousManifest = {
    get locales() { throw new Error("manifest must not be read"); },
  };

  for (const authorizationState of [undefined, AuthorizationState.DENIED, "MALFORMED"]) {
    const result = await runSandboxWarmPhase({
      arm: SandboxArm.TREATMENT,
      authorizationState,
      manifest: poisonousManifest,
      target,
      environment: safeEnvironment,
      requestAsset: async () => { requests += 1; },
    });
    assert.equal(result.status, SandboxStatus.AUTHORIZATION_BLOCKED);
  }
  assert.equal(requests, 0);
});

test("control resolves the identical plan but sends no speculative requests", async () => {
  let requests = 0;
  const result = await runSandboxWarmPhase({
    arm: SandboxArm.CONTROL,
    authorizationState: AuthorizationState.GRANTED,
    manifest,
    target,
    environment: safeEnvironment,
    requestAsset: async () => { requests += 1; },
  });

  assert.equal(result.status, SandboxStatus.CONTROL_READY);
  assert.deepEqual(result.plan, {
    locale: "hr-HR",
    tier: "1x",
    assetCount: 2,
    plannedBytes: 30,
  });
  assert.equal(requests, 0);
  assert.equal(JSON.stringify(result).includes("cdn.example.test"), false);
});

test("treatment warms only after authorization and governor approval", async () => {
  const requested = [];
  const result = await runSandboxWarmPhase({
    arm: SandboxArm.TREATMENT,
    authorizationState: AuthorizationState.GRANTED,
    manifest,
    target,
    environment: safeEnvironment,
    requestAsset: async (url) => { requested.push(url); },
  });

  assert.equal(result.status, SandboxStatus.WARMING_COMPLETE);
  assert.equal(result.summary.requested, 2);
  assert.deepEqual(requested, manifest.locales["hr-HR"].tiers["1x"].assets.map(({ url }) => url));
  assert.equal(JSON.stringify(result).includes("cdn.example.test"), false);
});

test("unknown connection and over-budget treatment states make no requests", async () => {
  let requests = 0;
  for (const environment of [
    { ...safeEnvironment, effectiveType: undefined },
    { ...safeEnvironment, byteBudget: 29 },
  ]) {
    const result = await runSandboxWarmPhase({
      arm: SandboxArm.TREATMENT,
      authorizationState: AuthorizationState.GRANTED,
      manifest,
      target,
      environment,
      requestAsset: async () => { requests += 1; },
    });
    assert.equal(result.status, SandboxStatus.GOVERNOR_BLOCKED);
  }
  assert.equal(requests, 0);
});


test("explicit disablement is never overridden by the sandbox", async () => {
  let calls = 0;
  for (const enabled of [false, undefined]) {
    const result = await runSandboxWarmPhase({ arm: SandboxArm.TREATMENT,
      authorizationState: AuthorizationState.GRANTED, manifest, target,
      environment: { ...safeEnvironment, enabled }, requestAsset: async () => { calls += 1; } });
    assert.equal(result.status, SandboxStatus.GOVERNOR_BLOCKED);
    assert.equal(result.governorReason, "DISABLED");
  }
  assert.equal(calls, 0);
});
