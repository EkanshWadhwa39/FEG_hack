/** One-way DOM intent seam. Never changes ordering, focus, styling or policy. */
export function bindCatalogueIntent({ root, gameIds, onIntent, dwellMs = 150,
  setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout } = {}) {
  if (!root?.addEventListener || typeof onIntent !== "function"
      || !Number.isFinite(dwellMs) || dwellMs < 0) throw new TypeError("Invalid intent binding");
  const allowed = new Set(gameIds);
  const doc = root.ownerDocument;
  let disposed = false;
  let timer = null;
  let hovered = null;
  let generation = 0;
  const hidden = node => doc?.hidden === true || doc?.visibilityState === "hidden"
    || root.hidden === true || Boolean(node?.closest?.("[hidden]"));
  const valid = node => node?.isConnected === true && root.isConnected === true
    && root.contains(node) && allowed.has(node.dataset?.gameId) && !hidden(node);
  const tile = target => {
    const node = (target?.closest ? target : target?.parentElement)?.closest?.("[data-game-id]");
    return valid(node) ? node : null;
  };
  function cancelPending() {
    generation += 1;
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
    hovered = null;
  }
  function report(node, kind) {
    if (disposed || !valid(node)) return;
    // Intentionally swallow callback failures: no raw error, URL or payload logs.
    try {
      const returned = onIntent(Object.freeze({ gameId: node.dataset.gameId, kind }));
      if (returned && typeof returned.then === "function") Promise.resolve(returned).catch(() => {});
    } catch { /* Cache intent must never break the player surface. */ }
  }
  function over(event) {
    const next = tile(event.target);
    if (disposed || !next || hovered === next) return;
    // Moving between descendants of the same tile is not a new dwell.
    if (tile(event.relatedTarget) === next) return;
    cancelPending();
    hovered = next;
    const id = next.dataset.gameId;
    const token = generation;
    timer = setTimeoutImpl(() => {
      if (disposed || token !== generation) return;
      timer = null;
      if (hovered === next && next.dataset.gameId === id) report(next, "HOVER_DWELL");
    }, dwellMs);
  }
  function out(event) {
    if (hovered && tile(event.relatedTarget) !== hovered) cancelPending();
  }
  function click(event) {
    const next = tile(event.target);
    cancelPending();
    if (next) {
      hovered = next; // Child transitions after click must not schedule a duplicate dwell.
      report(next, "CLICK");
    }
  }
  function visibility() { if (hidden(hovered ?? root)) cancelPending(); }
  root.addEventListener("pointerover", over);
  root.addEventListener("pointerout", out);
  root.addEventListener("pointerleave", cancelPending);
  root.addEventListener("pointercancel", cancelPending);
  root.addEventListener("click", click);
  doc?.addEventListener("visibilitychange", visibility);
  // Guard dynamic replacement/hidden ancestors even without a pointer event.
  let observer;
  const Observer = doc?.defaultView?.MutationObserver;
  if (typeof Observer === "function" && doc.documentElement) {
    observer = new Observer(() => {
      if (hovered && !valid(hovered)) cancelPending();
    });
    observer.observe(doc.documentElement, { subtree: true, childList: true,
      attributes: true, attributeFilter: ["hidden", "data-game-id"] });
  }
  return Object.freeze({ cancelPending, dispose() {
    if (disposed) return;
    disposed = true;
    cancelPending();
    root.removeEventListener("pointerover", over);
    root.removeEventListener("pointerout", out);
    root.removeEventListener("pointerleave", cancelPending);
    root.removeEventListener("pointercancel", cancelPending);
    root.removeEventListener("click", click);
    doc?.removeEventListener("visibilitychange", visibility);
    observer?.disconnect();
  } });
}

const thumbnailBindings = new WeakMap();

/** Call before setting src. Never writes src or retries a failing URL. */
export function bindThumbnailFallback({ image, fallback, timeoutMs = 3000 } = {}) {
  if (!image?.addEventListener || !fallback || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("Invalid thumbnail binding");
  }
  thumbnailBindings.get(image)?.dispose();
  let disposed = false;
  let settled = false;
  let timer = null;
  function settle(success) {
    if (disposed || settled) return;
    settled = true;
    if (timer !== null) globalThis.clearTimeout(timer);
    timer = null;
    image.hidden = !success;
    fallback.hidden = success;
  }
  const failed = () => settle(false);
  const loaded = () => settle(image.naturalWidth > 0);
  image.addEventListener("error", failed);
  image.addEventListener("load", loaded);
  // Text stays available while the network is unresolved.
  image.hidden = true;
  fallback.hidden = false;
  const binding = Object.freeze({ dispose() {
    if (disposed) return;
    disposed = true;
    if (timer !== null) globalThis.clearTimeout(timer);
    timer = null;
    image.removeEventListener("error", failed);
    image.removeEventListener("load", loaded);
    if (thumbnailBindings.get(image) === binding) thumbnailBindings.delete(image);
  } });
  thumbnailBindings.set(image, binding);
  timer = globalThis.setTimeout(failed, timeoutMs);
  // complete=true without a src is the initial empty image, not a failed load.
  try {
    const hasSource = image.currentSrc || image.getAttribute?.("src") || image.getAttribute?.("srcset");
    if (hasSource && image.complete) settle(image.naturalWidth > 0);
  } catch { failed(); }
  return binding;
}
