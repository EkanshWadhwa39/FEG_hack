const SENSITIVE_QUERY_KEY_PARTS = Object.freeze([
  "token", "auth", "bearer", "credential", "jwt", "session", "signature",
  "secret", "apikey", "accesskey", "keypair", "policy", "expires", "player", "cookie",
]);

function requireSafeUrl(exactUrl, sandboxOrigins) {
  if (typeof exactUrl !== "string" || !exactUrl || exactUrl.trim() !== exactUrl) {
    throw new TypeError("asset URL must be an exact non-empty string");
  }
  let parsed;
  try { parsed = new URL(exactUrl); } catch { throw new TypeError("asset URL must be absolute"); }
  if (parsed.protocol !== "https:" && !(sandboxOrigins?.has(parsed.origin))) {
    throw new RangeError("asset URL must use HTTPS");
  }
  if (parsed.username || parsed.password || exactUrl.includes("#")) {
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

function requireExactAssetUrl(exactUrl, sandboxOrigins) {
  const parsed = requireSafeUrl(exactUrl, sandboxOrigins);
  // Reject browser-normalized aliases rather than silently fetching a different
  // path/key (dot segments, backslashes, control characters, default ports, etc.).
  if (parsed.href !== exactUrl) throw new RangeError("asset URL is not an approved exact browser identity");
  return parsed;
}

/** Validate, but NEVER rebuild the exact cache key. */
export function requireCredentialFreeHttpsUrl(exactUrl) {
  requireSafeUrl(exactUrl);
  return exactUrl;
}

function abortError() { return new DOMException("Request cancelled or aborted", "AbortError"); }

// A fetch/reader test adapter (or missing browser capability) may ignore abort.
// Bound the caller independently; cleanup still owns its semaphore slot.
function untilAbort(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? abortError());
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function createRequester({ fetchImpl = globalThis.fetch, allowedOrigins, allowedAssetUrls,
  timeoutMs = 10000, mode = "cors", priority } = {}, sandboxOrigins) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (mode !== "cors") throw new RangeError("completed preparation requires readable cors responses");
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.length) throw new TypeError("explicit approved origins required");
  const approved = new Set(allowedOrigins.map(origin => {
    const url = requireSafeUrl(origin, sandboxOrigins);
    if (url.origin !== origin) throw new TypeError("approved origins must be exact origins");
    return origin;
  }));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw new RangeError("invalid request timeout");
  if (priority !== undefined && priority !== "low") throw new RangeError("only an optional low priority hint is supported");
  // Snapshot approval into private sets; caller mutation cannot enlarge the boundary.
  let approvedAssets;
  if (allowedAssetUrls !== undefined) {
    if (!Array.isArray(allowedAssetUrls) || !allowedAssetUrls.length) throw new TypeError("explicit approved asset URLs required");
    approvedAssets = new Set();
    for (const exactUrl of allowedAssetUrls) {
      const url = requireExactAssetUrl(exactUrl, sandboxOrigins);
      if (!approved.has(url.origin)) throw new RangeError("asset origin is not approved");
      if (approvedAssets.has(exactUrl)) throw new RangeError("duplicate approved asset URL");
      approvedAssets.add(exactUrl);
    }
  }
  let active = 0;
  const queue = [];
  const idleWaiters = new Set();
  function notifyIdle() {
    if (active === 0 && queue.length === 0) for (const finish of [...idleWaiters]) finish();
  }
  // Additive API: caller promises may reject before slow cancellation finishes.
  // Foreground work must await this boundary, not merely those caller promises.
  function waitForIdle({ signal } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason ?? abortError());
    if (active === 0 && queue.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = () => {
        idleWaiters.delete(finish);
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(signal.reason ?? abortError()); else resolve();
      };
      const abort = () => finish();
      idleWaiters.add(finish);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  function pump() {
    while (active < 2 && queue.length) {
      const item = queue.shift();
      item.signal?.removeEventListener("abort", item.abort);
      if (item.signal?.aborted) { item.reject(item.signal.reason ?? abortError()); continue; }
      active += 1;
      item.resolve(() => { active -= 1; pump(); notifyIdle(); });
    }
  }
  function acquire(signal) {
    if (signal?.aborted) return Promise.reject(signal.reason ?? abortError());
    return new Promise((resolve, reject) => {
      const item = { resolve, reject, signal };
      item.abort = () => {
        const index = queue.indexOf(item);
        if (index >= 0) queue.splice(index, 1);
        reject(signal.reason ?? abortError());
        notifyIdle();
      };
      signal?.addEventListener("abort", item.abort, { once: true });
      queue.push(item); pump();
    });
  }
  function validateUrl(exactUrl) {
    const url = requireExactAssetUrl(exactUrl, sandboxOrigins);
    if (!approved.has(url.origin)) throw new RangeError("asset origin is not approved");
    if (approvedAssets && !approvedAssets.has(exactUrl)) throw new RangeError("exact asset URL is not approved");
    return exactUrl;
  }

  const request = async (exactUrl, { signal, estimatedBytes, onBytes } = {}) => {
    validateUrl(exactUrl);
    if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes <= 0) {
      throw new TypeError("a positive bounded body reservation is required");
    }
    if (onBytes !== undefined && typeof onBytes !== "function") throw new TypeError("onBytes must be callable");
    const controller = new AbortController();
    const cancel = () => controller.abort(abortError());
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    // Includes queue wait, headers AND body consumption. No timeout restarts.
    const timer = setTimeout(() => controller.abort(new DOMException("Request timed out (aborted)", "TimeoutError")), timeoutMs);
    let release;
    let fetchWork;
    let readWork;
    let response;
    let reader;
    let drained = false;
    let bytes = 0;
    try {
      release = await acquire(controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      fetchWork = Promise.resolve(fetchImpl(exactUrl, {
        method: "GET", mode: "cors", credentials: "omit", cache: "default",
        redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
        ...(priority === "low" ? { priority: "low" } : {}),
      }));
      response = await untilAbort(fetchWork, controller.signal);
      if (!response?.ok || ["opaque", "opaqueredirect", "error"].includes(response.type) || response.redirected
          || (response.url && response.url !== exactUrl)) {
        throw new Error("asset request did not complete successfully");
      }
      if (typeof response.body?.getReader !== "function") throw new Error("readable response body required");
      reader = response.body.getReader();
      const length = response.headers?.get("content-length");
      if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > estimatedBytes)) {
        throw new Error("body exceeds reservation");
      }
      while (true) {
        if (controller.signal.aborted) throw controller.signal.reason;
        readWork = Promise.resolve(reader.read());
        const chunk = await untilAbort(readWork, controller.signal);
        if (controller.signal.aborted) throw controller.signal.reason;
        if (chunk.done) { drained = true; break; }
        const count = chunk.value?.byteLength;
        if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid body chunk");
        bytes += count;
        onBytes?.(count);
        if (!Number.isSafeInteger(bytes) || bytes > estimatedBytes) throw new Error("body exceeds reservation");
      }
      return Object.freeze({ label: "MEASURED", completed: true, bodyBytes: bytes });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      controller.abort(abortError());
      // Do not block the caller on an uncooperative cancellation. Also NEVER
      // refund its slot early: late headers get cancelled, pending reads drain,
      // and failed/hung cleanup quarantines the slot (conservative fail-closed).
      if (release) {
        void (async () => {
          try {
            if (!response && fetchWork) {
              try { response = await fetchWork; } catch { /* Fetch already ended. */ }
            }
            if (!drained) {
              if (reader) {
                try { await reader.cancel(); }
                catch {
                  // A native reader already errored by abort has rejected cancel
                  // AND closed promises. Terminal stream state confirms cleanup.
                  if (!reader.closed || typeof reader.closed.then !== "function") throw new Error("unconfirmed body cancellation");
                  await reader.closed.catch(() => {});
                }
              }
              else if (response?.body) await response.body.cancel();
              if (readWork) await readWork.catch(() => {});
            }
            reader?.releaseLock();
            release();
          } catch { /* Unconfirmed cleanup keeps this private slot occupied. */ }
        })();
      }
    }
  };
  request.validateUrl = validateUrl;
  request.waitForIdle = waitForIdle;
  return Object.freeze(request);
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
  return createRequester({ ...options, allowedOrigins: [origin] }, new Set([origin]));
}

/** One shared full-body semaphore across a bounded, explicit loopback catalogue. */
export function createSandboxCatalogueRequester({ origins, allowedAssetUrls, ...options } = {}) {
  if (!Array.isArray(allowedAssetUrls) || !allowedAssetUrls.length) {
    throw new TypeError("explicit approved asset URLs required for catalogue requests");
  }
  if (!Array.isArray(origins) || !origins.length || origins.length > 20 || new Set(origins).size !== origins.length) {
    throw new TypeError("one to twenty distinct loopback origins required");
  }
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.origin !== origin) {
      throw new RangeError("catalogue origins must be exact loopback HTTP origins");
    }
  }
  return createRequester({ ...options, allowedOrigins: origins, allowedAssetUrls }, new Set(origins));
}
