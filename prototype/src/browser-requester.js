const ALLOWED_MODES = new Set(["cors", "no-cors"]);
const SENSITIVE_QUERY_KEY_PARTS = Object.freeze([
  "token",
  "auth",
  "bearer",
  "credential",
  "jwt",
  "session",
  "signature",
  "secret",
  "apikey",
  "accesskey",
  "keypair",
  "policy",
  "expires",
]);

function isCredentialLikeQueryKey(key) {
  const compactKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return compactKey === "key"
    || compactKey === "sig"
    || SENSITIVE_QUERY_KEY_PARTS.some((part) => compactKey.includes(part));
}

/**
 * Loopback hosts, where plain HTTP carries no transport risk because the
 * request never leaves the machine. Without this exception the local sandbox
 * could not use the real request boundary and had to hand-roll its own, which
 * is how `connection-prewarm.js` ended up tested but wired into nothing.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Reject URLs that are not suitable for credential-free speculative warming.
 * The original string is returned unchanged so browser cache keys are never
 * normalized, reconstructed, or reordered by this module.
 */
export function requireCredentialFreeHttpsUrl(exactUrl) {
  if (typeof exactUrl !== "string" || exactUrl.length === 0) {
    throw new TypeError("asset URL must be an exact non-empty string");
  }

  let parsed;
  try {
    parsed = new URL(exactUrl);
  } catch {
    throw new TypeError("asset URL must be absolute");
  }

  if (parsed.protocol !== "https:"
    && !(parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname))) {
    throw new RangeError("sandbox asset URL must use HTTPS outside loopback");
  }
  if (parsed.username || parsed.password) {
    throw new RangeError("sandbox asset URL must not contain credentials");
  }
  for (const key of parsed.searchParams.keys()) {
    if (isCredentialLikeQueryKey(key)) {
      throw new RangeError("sandbox asset URL contains a prohibited credential-like query key");
    }
  }

  return exactUrl;
}

/**
 * Create the real browser request boundary for a later approved staging run.
 * No cookies, Authorization headers, custom cache, or URL rewriting are used.
 * A fulfilled request means only that the request completed; cache admission
 * and iframe reuse still require browser/network evidence.
 */
export function createCredentialFreeBrowserRequester({
  fetchImpl = globalThis.fetch,
  mode = "cors",
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  if (!ALLOWED_MODES.has(mode)) {
    throw new RangeError("request mode must be cors or no-cors");
  }

  return async (exactUrl, { signal } = {}) => {
    requireCredentialFreeHttpsUrl(exactUrl);
    const response = await fetchImpl(exactUrl, {
      method: "GET",
      mode,
      credentials: "omit",
      cache: "default",
      signal,
    });

    if (response == null || typeof response !== "object") {
      throw new TypeError("asset request returned no response");
    }
    if (response.type !== "opaque" && response.ok !== true) {
      throw new Error("asset request did not complete successfully");
    }
  };
}
