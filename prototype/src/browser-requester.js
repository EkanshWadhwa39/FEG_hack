const ALLOWED_MODES = new Set(["cors", "no-cors"]);
// Values per the fetch() `priority` option. Source:
// https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#priority
const ALLOWED_PRIORITIES = new Set(["auto", "low", "high"]);
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

  if (parsed.protocol !== "https:") {
    throw new RangeError("sandbox asset URL must use HTTPS");
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
 * Consume a response body to completion, discarding bytes as they arrive
 * instead of buffering the whole payload in memory.
 *
 * Why this exists: per docs/WARM-LATENCY-PLAN.md section 2 row 2, a fetch
 * response whose body is never read may not be admitted to the browser's
 * HTTP cache at all — checking `response.ok` alone is not enough. This is
 * corroborated by HTTP client implementations generally: e.g. the
 * make-fetch-happen cache layer documents "Requests will not be cached
 * unless their response bodies are consumed... drain the res.body stream."
 * (https://github.com/npm/make-fetch-happen/issues/293). A browser-spec
 * citation for the exact admission-timing mechanism was not locatable in the
 * MDN/WHATWG pages fetched for this change; that specific mechanism is
 * UNKNOWN and is not claimed here beyond what the project's own plan states.
 *
 * Opaque (no-cors) responses are handled specially: per MDN, an opaque
 * response's `body` is always `null` and its bytes are not accessible to
 * JavaScript at all (status 0, empty headers, body null) — the underlying
 * network transfer is invisible to and independent of any JS-visible stream.
 * Source: https://developer.mozilla.org/en-US/docs/Web/API/Response/type
 * So for opaque responses this function does nothing and never touches
 * `response.body`.
 *
 * For readable bodies, this pipes the stream to a no-op WritableStream sink
 * so each chunk is discarded as it is read (no accumulation), which is the
 * consumption pattern MDN's Fetch guide documents via
 * `response.body.pipeThrough()`/stream consumption:
 * https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
 * `ReadableStream.cancel()` is deliberately NOT used here: MDN's own
 * cancel() docs do not state whether it aborts the underlying network
 * transfer, and canceling risks stopping the download before the full
 * asset is received — the opposite of what cache admission needs. That
 * specific "does cancel() abort the network fetch" behavior is UNKNOWN per
 * the docs checked and is avoided rather than assumed.
 */
async function drainResponseBody(response) {
  if (response.type === "opaque") {
    return;
  }

  const body = response.body;
  if (body == null) {
    return;
  }

  if (typeof body.pipeTo === "function" && typeof WritableStream === "function") {
    await body.pipeTo(new WritableStream());
    return;
  }

  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    try {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } finally {
      reader.releaseLock?.();
    }
    return;
  }

  if (typeof response.arrayBuffer === "function") {
    await response.arrayBuffer();
  }
}

/**
 * Create the real browser request boundary for a later approved staging run.
 * No cookies, Authorization headers, custom cache, or URL rewriting are used.
 * A fulfilled request means only that the request completed and its body
 * was drained; cache admission and iframe reuse still require browser/
 * network evidence.
 */
export function createCredentialFreeBrowserRequester({
  fetchImpl = globalThis.fetch,
  mode = "cors",
  // Speculative warm fetches default to low priority so they yield to the
  // lobby's own rendering (docs/WARM-LATENCY-PLAN.md section 2 row 4). A
  // caller can override per call (e.g. normal/high at launch time) via the
  // per-call `priority` option below.
  priority: defaultPriority = "low",
  // Injectable so callers/tests can simulate browsers with or without the
  // fetch() `priority` option without depending on the host runtime's
  // actual support for it.
  requestCtor = globalThis.Request,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  if (!ALLOWED_MODES.has(mode)) {
    throw new RangeError("request mode must be cors or no-cors");
  }
  if (defaultPriority != null && !ALLOWED_PRIORITIES.has(defaultPriority)) {
    throw new RangeError("request priority must be auto, low, or high");
  }

  // Feature-detect the fetch() `priority` option (values: "high" | "low" |
  // "auto", default "auto"). Source:
  // https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#priority
  // Detection is against the platform Request constructor rather than
  // fetchImpl, so a browser without support degrades silently (the option
  // is simply omitted) instead of risking a throw from a strict fetchImpl.
  const supportsRequestPriority = typeof requestCtor === "function"
    && requestCtor.prototype != null
    && "priority" in requestCtor.prototype;

  return async (exactUrl, { signal, priority = defaultPriority } = {}) => {
    requireCredentialFreeHttpsUrl(exactUrl);
    if (priority != null && !ALLOWED_PRIORITIES.has(priority)) {
      throw new RangeError("request priority must be auto, low, or high");
    }

    const fetchOptions = {
      method: "GET",
      mode,
      credentials: "omit",
      cache: "default",
      signal,
    };
    if (priority != null && supportsRequestPriority) {
      fetchOptions.priority = priority;
    }

    const response = await fetchImpl(exactUrl, fetchOptions);

    if (response == null || typeof response !== "object") {
      throw new TypeError("asset request returned no response");
    }
    if (response.type !== "opaque" && response.ok !== true) {
      throw new Error("asset request did not complete successfully");
    }

    await drainResponseBody(response);
  };
}
