import { assessPrefetch } from "./governor.js";
import { resolveManifest } from "./manifest.js";
import { warmAssets } from "./warmer.js";

export const SandboxArm = Object.freeze({
  CONTROL: "CONTROL",
  TREATMENT: "TREATMENT",
});

export const AuthorizationState = Object.freeze({
  GRANTED: "GRANTED",
  DENIED: "DENIED",
  UNKNOWN: "UNKNOWN",
});

export const SandboxStatus = Object.freeze({
  AUTHORIZATION_BLOCKED: "AUTHORIZATION_BLOCKED",
  CONTROL_READY: "CONTROL_READY",
  GOVERNOR_BLOCKED: "GOVERNOR_BLOCKED",
  WARMING_COMPLETE: "WARMING_COMPLETE",
});

function requireArm(arm) {
  if (!Object.values(SandboxArm).includes(arm)) {
    throw new RangeError("sandbox arm must be CONTROL or TREATMENT");
  }
}

function publicPlanSummary(plan) {
  return Object.freeze({
    locale: plan.locale,
    tier: plan.tier,
    assetCount: plan.assets.length,
    plannedBytes: plan.assets.reduce((total, asset) => total + asset.estimatedBytes, 0),
  });
}

/**
 * Environment-neutral warming phase for a later approved staging sandbox run.
 * Authorization must be explicitly granted before manifest resolution, governor
 * evaluation, or any speculative request. Results intentionally omit URLs.
 */
export async function runSandboxWarmPhase({
  arm,
  authorizationState = AuthorizationState.UNKNOWN,
  manifest,
  target,
  environment,
  requestAsset,
  concurrency = 2,
  signal,
} = {}) {
  requireArm(arm);

  if (authorizationState !== AuthorizationState.GRANTED) {
    return Object.freeze({
      arm,
      status: SandboxStatus.AUTHORIZATION_BLOCKED,
      authorizationState: Object.values(AuthorizationState).includes(authorizationState)
        ? authorizationState
        : AuthorizationState.UNKNOWN,
    });
  }

  const plan = resolveManifest(manifest, target);
  const planSummary = publicPlanSummary(plan);

  if (arm === SandboxArm.CONTROL) {
    return Object.freeze({
      arm,
      status: SandboxStatus.CONTROL_READY,
      authorizationState,
      plan: planSummary,
    });
  }

  const decision = assessPrefetch({
    ...environment,
    nextAssetBytes: planSummary.plannedBytes,
  });
  if (!decision.allowed) {
    return Object.freeze({
      arm,
      status: SandboxStatus.GOVERNOR_BLOCKED,
      authorizationState,
      governorReason: decision.reason,
      plan: planSummary,
    });
  }

  const summary = await warmAssets({
    plan,
    target,
    requestAsset,
    concurrency,
    signal,
  });
  return Object.freeze({
    arm,
    status: SandboxStatus.WARMING_COMPLETE,
    authorizationState,
    governorReason: decision.reason,
    plan: planSummary,
    summary,
  });
}
