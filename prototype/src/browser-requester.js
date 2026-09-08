const SENSITIVE_QUERY_KEY_PARTS = Object.freeze([
  "token", "auth", "bearer", "credential", "jwt", "session", "signature",
  "secret", "apikey", "accesskey", "keypair", "policy", "expires", "player", "cookie",
]);

function requireSafeUrl(exactUrl, sandboxOrigin) {
  if (typeof exactUrl !== "string" || !exactUrl || exactUrl.trim() !== exactUrl) {
    throw new TypeError("asset URL must be an exact non-empty string");
  }
  let parsed;
  try { parsed = new URL(exactUrl); } catch { throw new TypeError("asset URL must be absolute"); }
  if (parsed.protocol !== "https:" && !(sandboxOrigin && parsed.origin === sandboxOrigin)) {
    throw new RangeError("asset URL must use HTTPS");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new RangeError("asset URL must not contain credentials or fragments");
  }
  for (const key of parsed.searchParams.keys()) {
    const compact = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (["key", "sig"].includes(compact) || SENSITIVE_QUERY_KEY_PARTS.some(p => compact.includes(p))) {
      throw new RangeError("asset URL contains a prohibited credential-like query key");
    }
  }
  return parsed;
}

/** Validate, but NEVER rebuild the exact cache key. */
export function requireCredentialFreeHttpsUrl(exactUrl) {
  requireSafeUrl(exactUrl);
  return exactUrl;
}

function abortError() { return new DOMException("Request cancelled", "AbortError"); }

function createRequester({ fetchImpl = globalThis.fetch, allowedOrigins, timeoutMs = 10000, mode = "cors" } = {}, sandboxOrigin) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (mode !== "cors") throw new RangeError("completed preparation requires readable cors responses");
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length) throw new TypeError("explicit approved origins required");
  const approved = new Set(allowedOrigins.map(origin => {
    const url = requireSafeUrl(origin, sandboxOrigin);
    if (url.origin !== origin) throw new TypeError("approved origins must be exact origins");
    return origin;
  }));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw new RangeError("invalid request timeout");
  let active = 0;
  const queue = [];
  function pump() {
    while (active < 2 && queue.length) {
      const item = queue.shift();
      item.signal?.removeEventListener("abort", item.abort);
      if (item.signal?.aborted) { item.reject(abortError()); continue; }
      active += 1;
      item.resolve(() => { active -= 1; pump(); });
    }
  }
  function acquire(signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const item = { resolve, reject, signal };
      item.abort = () => {
        const index = queue.indexOf(item);
        if (index >= 0) queue.splice(index, 1);
        reject(abortError());
      };
      signal?.addEventListener("abort", item.abort, { once: true });
      queue.push(item); pump();
    });
  }
  function validateUrl(exactUrl) {
    const url = requireSafeUrl(exactUrl, sandboxOrigin);
    if (!approved.has(url.origin)) throw new RangeError("asset origin is not approved");
    return exactUrl;
  }

  const request = async (exactUrl, { signal, estimatedBytes, onBytes } = {}) => {
    validateUrl(exactUrl);
    if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes <= 0) {
      throw new TypeError("a positive bounded body reservation is required");
    }
    const release = await acquire(signal);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(cancel, timeoutMs);
    let reader;
    let bytes = 0;
    try {
      if (controller.signal.aborted) throw abortError();
      const response = await fetchImpl(exactUrl, {
        method: "GET", mode: "cors", credentials: "omit", cache: "default",
        redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      });
      if (!response?.ok || response.type === "opaque" || response.redirected) {
        throw new Error("asset request did not complete successfully");
      }
      if (!response.body?.getReader) throw new Error("readable response body required");
      reader = response.body.getReader();
      const length = response.headers?.get("content-length");
      if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > estimatedBytes)) {
        throw new Error("body exceeds reservation");
      }
      while (true) {
        if (controller.signal.aborted) throw abortError();
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        onBytes?.(chunk.value.byteLength);
        if (bytes > estimatedBytes) throw new Error("body exceeds reservation");
      }
      if (controller.signal.aborted) throw abortError();
      return Object.freeze({ label: "MEASURED", completed: true, bodyBytes: bytes });
    } finally {
      controller.abort();
      try { await reader?.cancel(); } catch { /* Already errored/aborted. */ }
      reader?.releaseLock();
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      release();
    }
  };
  request.validateUrl = validateUrl;
  return request;
}

/** HTTPS production-shaped interface: explicit allowlist, no redirects, no opaque success.
 * Slots last through body completion/cancellation, including across candidate changes.
 * Byte limits bound readable bodies, not transport headers/in-flight TCP buffering.
 */
export function createCredentialFreeBrowserRequester(options) { return createRequester(options); }

/** Separate SIMULATED loopback-only adapter. Never enables arbitrary HTTP origins. */
export function createSandboxBrowserRequester({ origin, ...options } = {}) {
  const url = new URL(origin);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.origin !== origin) {
    throw new RangeError("sandbox origin must be an exact loopback HTTP origin");
  }
  return createRequester({ ...options, allowedOrigins: [origin] }, origin);
}
