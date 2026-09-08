import { requireCredentialFreeHttpsUrl } from "./browser-requester.js";
import { assessPrefetch } from "./governor.js";

export const ConnectionPrewarmStatus = Object.freeze({
  GOVERNOR_BLOCKED: "GOVERNOR_BLOCKED",
  HINTS_EMITTED: "HINTS_EMITTED",
});

// Works for any credential-free HTTPS URL: the session endpoint or an asset
// CDN URL/origin. Callers pass whichever exact URL they want hinted; this
// only ever extracts its origin.
function extractOrigin(exactUrl) {
  requireCredentialFreeHttpsUrl(exactUrl);
  return new URL(exactUrl).origin;
}

/**
 * Real browser adapter for a later approved environment.
 *
 * It emits transport hints only. It does not call the session endpoint, create a
 * session, cache a response, or alter the mandatory authorization boundary.
 *
 * The returned function accepts any exact credential-free HTTPS URL — the
 * session endpoint or an asset-CDN origin — and hints its origin exactly
 * once per prewarmer instance via the shared `hintedOrigins` set below.
 *
 * `dns-prefetch` and `preconnect` (with `crossOrigin = "anonymous"`) are the
 * documented HTML hints for warming a connection to an origin ahead of the
 * first real request to it, and only benefit cross-origin requests.
 * Source: https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/preconnect
 */
export function createBrowserConnectionPrewarmer({ documentImpl = globalThis.document } = {}) {
  if (documentImpl == null
      || typeof documentImpl.createElement !== "function"
      || typeof documentImpl.head?.append !== "function") {
    throw new TypeError("documentImpl must provide createElement and head.append");
  }

  const hintedOrigins = new Set();
  return async (exactUrl) => {
    const origin = extractOrigin(exactUrl);
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

/**
 * Synthetic adapter wired by local demos. It deliberately performs no I/O.
 * Kept in parity with the browser adapter: accepts any exact credential-free
 * HTTPS URL (session endpoint or asset-CDN origin) and dedupes per origin
 * via its own `hintedOrigins` set.
 */
export function createSyntheticConnectionPrewarmer({ recordHint = () => {} } = {}) {
  if (typeof recordHint !== "function") throw new TypeError("recordHint must be a function");
  const hintedOrigins = new Set();
  return async (exactUrl) => {
    const origin = extractOrigin(exactUrl);
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
 *
 * `exactAssetOrigins` lets a caller also hint known asset-CDN origins at
 * drawer-open, before the manifest resolves (docs/WARM-LATENCY-PLAN.md
 * section 2 row 1) — e.g. a configured CDN base origin, not a per-asset URL
 * from the not-yet-resolved manifest. Each target (the session endpoint plus
 * every asset origin) is passed through the same `prewarmConnection` adapter
 * instance, so its internal `hintedOrigins` set dedupes across all of them:
 * an origin already hinted (by either the session endpoint or a prior asset
 * origin) is never hinted twice.
 */
export async function prewarmConnectionOnDrawerOpen({
  exactSessionEndpoint,
  exactAssetOrigins = [],
  environment,
  prewarmConnection,
} = {}) {
  if (typeof prewarmConnection !== "function") {
    throw new TypeError("prewarmConnection must be a function");
  }
  if (!Array.isArray(exactAssetOrigins)) {
    throw new TypeError("exactAssetOrigins must be an array");
  }

  const targets = [exactSessionEndpoint, ...exactAssetOrigins].filter((target) => target != null);
  if (targets.length === 0) {
    throw new TypeError("exactSessionEndpoint or at least one exactAssetOrigins entry is required");
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

  let hintsAdded = 0;
  let evidenceLabel = "SIMULATED";
  let deduplicated = true;
  for (const target of targets) {
    const result = await prewarmConnection(target);
    hintsAdded += result.hintsAdded ?? 0;
    evidenceLabel = result.evidenceLabel;
    deduplicated = deduplicated && result.deduplicated === true;
  }

  return Object.freeze({
    status: ConnectionPrewarmStatus.HINTS_EMITTED,
    governorReason: decision.reason,
    evidenceLabel,
    hintsAdded,
    deduplicated,
  });
}
