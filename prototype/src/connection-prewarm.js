import { requireCredentialFreeHttpsUrl } from "./browser-requester.js";
import { assessPrefetch } from "./governor.js";

export const ConnectionPrewarmStatus = Object.freeze({
  GOVERNOR_BLOCKED: "GOVERNOR_BLOCKED",
  HINTS_EMITTED: "HINTS_EMITTED",
});

function sessionOrigin(exactEndpoint) {
  requireCredentialFreeHttpsUrl(exactEndpoint);
  return new URL(exactEndpoint).origin;
}

/**
 * Real browser adapter for a later approved environment.
 *
 * It emits transport hints only. It does not call the session endpoint, create a
 * session, cache a response, or alter the mandatory authorization boundary.
 */
export function createBrowserConnectionPrewarmer({ documentImpl = globalThis.document } = {}) {
  if (documentImpl == null
      || typeof documentImpl.createElement !== "function"
      || typeof documentImpl.head?.append !== "function") {
    throw new TypeError("documentImpl must provide createElement and head.append");
  }

  const hintedOrigins = new Set();
  return async (exactSessionEndpoint) => {
    const origin = sessionOrigin(exactSessionEndpoint);
    if (hintedOrigins.has(origin)) {
      return Object.freeze({ evidenceLabel: "UNKNOWN", hintsAdded: 0, deduplicated: true });
    }

    const parsed = new URL(origin);
    const dnsPrefetch = documentImpl.createElement("link");
    dnsPrefetch.rel = "dns-prefetch";
    dnsPrefetch.href = `//${parsed.host}`;

    const preconnect = documentImpl.createElement("link");
    preconnect.rel = "preconnect";
    preconnect.href = origin;
    preconnect.crossOrigin = "anonymous";

    documentImpl.head.append(dnsPrefetch, preconnect);
    hintedOrigins.add(origin);
    return Object.freeze({ evidenceLabel: "UNKNOWN", hintsAdded: 2, deduplicated: false });
  };
}

/** Synthetic adapter wired by local demos. It deliberately performs no I/O. */
export function createSyntheticConnectionPrewarmer({ recordHint = () => {} } = {}) {
  if (typeof recordHint !== "function") throw new TypeError("recordHint must be a function");
  const hintedOrigins = new Set();
  return async (exactSessionEndpoint) => {
    const origin = sessionOrigin(exactSessionEndpoint);
    const deduplicated = hintedOrigins.has(origin);
    if (!deduplicated) {
      hintedOrigins.add(origin);
      recordHint();
    }
    return Object.freeze({
      evidenceLabel: "SIMULATED",
      hintsAdded: deduplicated ? 0 : 2,
      deduplicated,
    });
  };
}

/**
 * Drawer-open policy boundary. The governor must approve before hints are
 * emitted. This function performs no authorization call and cannot advance a
 * launch; exclusion authorization remains blocking in runSandboxWarmPhase.
 */
export async function prewarmConnectionOnDrawerOpen({
  exactSessionEndpoint,
  environment,
  prewarmConnection,
} = {}) {
  if (typeof prewarmConnection !== "function") {
    throw new TypeError("prewarmConnection must be a function");
  }

  const decision = assessPrefetch({ ...environment, nextAssetBytes: 0 });
  if (!decision.allowed) {
    return Object.freeze({
      status: ConnectionPrewarmStatus.GOVERNOR_BLOCKED,
      governorReason: decision.reason,
      evidenceLabel: "SIMULATED",
      hintsAdded: 0,
    });
  }

  const result = await prewarmConnection(exactSessionEndpoint);
  return Object.freeze({
    status: ConnectionPrewarmStatus.HINTS_EMITTED,
    governorReason: decision.reason,
    evidenceLabel: result.evidenceLabel,
    hintsAdded: result.hintsAdded,
    deduplicated: result.deduplicated,
  });
}
