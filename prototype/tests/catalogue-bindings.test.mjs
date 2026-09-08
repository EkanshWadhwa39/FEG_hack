import test from "node:test";
import assert from "node:assert/strict";
import { bindCatalogueIntent, bindThumbnailFallback } from "../src/catalogue-bindings.js";

// Minimal DOM/event doubles: no browser, dependencies, network or real timers.
class Node {
  constructor(parent = null, gameId) {
    this.parentElement = parent;
    this.ownerDocument = parent?.ownerDocument;
    this.dataset = gameId ? { gameId } : {};
    this.hidden = false;
    this.isConnected = true;
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, target = this, relatedTarget = null) {
    for (const fn of this.listeners.get(type) ?? []) fn({ target, relatedTarget });
  }
  contains(node) {
    for (let current = node; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (selector === "[data-game-id]" && current.dataset.gameId) return current;
      if (selector === "[hidden]" && current.hidden) return current;
    }
    return null;
  }
  listenerCount() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}
function clock() {
  let next = 0;
  let now = 0;
  const jobs = new Map();
  return {
    jobs,
    set(fn, delay) { const id = next++; jobs.set(id, { fn, at: now + delay }); return id; },
    clear(id) { jobs.delete(id); },
    tick(ms) {
      now += ms;
      for (const [id, job] of [...jobs]) if (job.at <= now) { jobs.delete(id); job.fn(); }
    },
  };
}
function fixture(onIntent, observerEnabled = false) {
  const time = clock();
  const doc = new Node();
  doc.visibilityState = "visible";
  doc.ownerDocument = doc;
  const root = new Node(doc);
  const a = new Node(root, "title-01");
  const b = new Node(root, "title-02");
  const child = new Node(a);
  const sibling = new Node(a);
  const intents = [];
  let observer;
  if (observerEnabled) {
    doc.documentElement = root;
    doc.defaultView = { MutationObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() {}
      disconnect() { this.disconnected = true; }
    } };
  }
  const binding = bindCatalogueIntent({ root, gameIds: ["title-01", "title-02"],
    onIntent: onIntent ?? (intent => intents.push(intent)),
    setTimeoutImpl: time.set, clearTimeoutImpl: time.clear });
  return { time, doc, root, a, b, child, sibling, intents, binding, observer };
}

test("delegated dwell waits 150ms; child transitions do not restart or duplicate", () => {
  const f = fixture();
  f.root.emit("pointerover", f.child);
  f.time.tick(100);
  assert.deepEqual(f.intents, []);
  f.root.emit("pointerout", f.child, f.sibling);
  f.root.emit("pointerover", f.sibling, f.child);
  assert.equal(f.time.jobs.size, 1);
  f.time.tick(49);
  assert.equal(f.intents.length, 0);
  f.time.tick(1);
  assert.deepEqual(f.intents, [{ gameId: "title-01", kind: "HOVER_DWELL" }]);
  assert.ok(Object.isFrozen(f.intents[0]));
  f.root.emit("pointerover", f.child, f.sibling);
  f.time.tick(1000);
  assert.equal(f.intents.length, 1);
  f.binding.dispose();
});

test("one timer across tiles, leave cancels and stale queued callbacks are harmless", () => {
  const f = fixture();
  f.root.emit("pointerover", f.a);
  const stale = [...f.time.jobs.values()][0].fn;
  f.root.emit("pointerout", f.a, f.b);
  f.root.emit("pointerover", f.b, f.a);
  assert.equal(f.time.jobs.size, 1);
  stale();
  assert.equal(f.intents.length, 0);
  f.time.tick(150);
  assert.equal(f.intents[0].gameId, "title-02");
  f.root.emit("pointerout", f.b);
  f.root.emit("pointerover", f.a);
  f.root.emit("pointerleave");
  f.time.tick(150);
  assert.equal(f.intents.length, 1);
  f.binding.dispose();
});

test("click reports immediately and cancels pending dwell without delayed duplicate", () => {
  const f = fixture();
  f.root.emit("pointerover", f.child);
  f.time.tick(100);
  f.root.emit("click", f.child);
  assert.deepEqual(f.intents, [{ gameId: "title-01", kind: "CLICK" }]);
  assert.equal(f.time.jobs.size, 0);
  f.root.emit("pointerover", f.sibling, f.child);
  f.time.tick(1000);
  assert.equal(f.intents.length, 1);
  f.binding.dispose();
});

test("hidden document cancels immediately; hidden ancestors and detached/replaced tiles never report", () => {
  for (const invalidate of [
    f => { f.doc.hidden = true; f.doc.emit("visibilitychange"); assert.equal(f.time.jobs.size, 0); },
    f => { f.root.hidden = true; },
    f => { f.doc.hidden = true; },
    f => { f.a.isConnected = false; new Node(f.root, "title-01"); },
    f => { f.a.parentElement = null; },
    f => { f.a.dataset.gameId = "title-02"; },
  ]) {
    const f = fixture();
    f.root.emit("pointerover", f.a);
    invalidate(f);
    f.time.tick(150);
    assert.deepEqual(f.intents, []);
    f.binding.dispose();
  }
});

test("observer cancels hidden/removal; new dynamic tile works; dispose removes all listeners", () => {
  const f = fixture(undefined, true);
  f.root.emit("pointerover", f.a);
  f.root.hidden = true;
  f.observer.callback();
  assert.equal(f.time.jobs.size, 0);
  f.root.hidden = false;
  const replacement = new Node(f.root, "title-01");
  f.root.emit("pointerover", replacement);
  f.time.tick(150);
  assert.equal(f.intents.length, 1);
  f.root.emit("pointerover", f.b);
  f.binding.dispose();
  f.binding.dispose();
  f.binding.cancelPending();
  f.time.tick(1000);
  assert.equal(f.intents.length, 1);
  assert.equal(f.root.listenerCount(), 0);
  assert.equal(f.doc.listenerCount(), 0);
  assert.equal(f.observer.disconnected, true);
});

test("unknown/outside targets ignored, pointercancel and explicit cancel supported", () => {
  const f = fixture();
  for (const target of [new Node(f.root, "unknown"), new Node(null, "title-01"), f.root]) {
    f.root.emit("pointerover", target);
    f.root.emit("click", target);
  }
  assert.equal(f.time.jobs.size, 0);
  assert.equal(f.intents.length, 0);
  f.root.emit("pointerover", f.a);
  f.root.emit("pointercancel");
  assert.equal(f.time.jobs.size, 0);
  f.root.emit("pointerover", f.a);
  f.binding.cancelPending();
  f.time.tick(1000);
  assert.equal(f.intents.length, 0);
  f.binding.dispose();
});

test("throwing/rejecting callbacks are contained without logging sensitive errors", async () => {
  const oldError = console.error;
  const oldLog = console.log;
  const logs = [];
  console.error = (...args) => logs.push(args);
  console.log = (...args) => logs.push(args);
  try {
    for (const callback of [() => { throw new Error("secret-token"); },
      () => Promise.reject(new Error("secret-token"))]) {
      const f = fixture(callback);
      assert.doesNotThrow(() => f.root.emit("click", f.a));
      await Promise.resolve();
      await Promise.resolve();
      f.binding.dispose();
    }
    assert.deepEqual(logs, []);
  } finally { console.error = oldError; console.log = oldLog; }
});

function thumbnailTest(run) {
  const time = clock();
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  globalThis.setTimeout = time.set;
  globalThis.clearTimeout = time.clear;
  const image = new Node();
  image.complete = true;
  image.naturalWidth = 0;
  image.source = "";
  image.getAttribute = key => key === "src" ? image.source : null;
  Object.defineProperty(image, "src", { set() { throw new Error("Must never write src"); } });
  const fallback = new Node();
  try { run({ image, fallback, time }); }
  finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
}

test("thumbnail attached before src: load succeeds, errors never rewrite/retry URL", () => {
  thumbnailTest(({ image, fallback, time }) => {
    const binding = bindThumbnailFallback({ image, fallback });
    assert.equal(image.listenerCount(), 2);
    assert.equal(fallback.hidden, false);
    image.source = "https://fixtures.example/thumbnail.svg?v=1";
    image.naturalWidth = 24;
    image.emit("load");
    assert.equal(image.hidden, false);
    assert.equal(fallback.hidden, true);
    assert.equal(time.jobs.size, 0);
    binding.dispose();
  });
  thumbnailTest(({ image, fallback, time }) => {
    const binding = bindThumbnailFallback({ image, fallback });
    image.emit("error");
    image.emit("error");
    assert.equal(image.hidden, true);
    assert.equal(fallback.hidden, false);
    assert.equal(time.jobs.size, 0);
    binding.dispose();
  });
});

test("thumbnail timeout settles fallback; late load cannot undo it", () => {
  thumbnailTest(({ image, fallback, time }) => {
    const binding = bindThumbnailFallback({ image, fallback, timeoutMs: 200 });
    time.tick(199);
    assert.equal(time.jobs.size, 1);
    time.tick(1);
    assert.equal(image.hidden, true);
    assert.equal(fallback.hidden, false);
    image.naturalWidth = 32;
    image.emit("load");
    assert.equal(image.hidden, true);
    binding.dispose();
  });
});

test("already failed/loaded images are inspected safely; disposal/rebinding is idempotent", () => {
  for (const naturalWidth of [0, 32]) thumbnailTest(({ image, fallback, time }) => {
    image.source = "thumbnail.svg";
    image.naturalWidth = naturalWidth;
    const first = bindThumbnailFallback({ image, fallback });
    assert.equal(fallback.hidden, naturalWidth > 0);
    assert.equal(time.jobs.size, 0);
    image.source = "";
    const second = bindThumbnailFallback({ image, fallback });
    assert.equal(image.listenerCount(), 2);
    assert.equal(time.jobs.size, 1);
    first.dispose();
    assert.equal(time.jobs.size, 1);
    second.dispose();
    second.dispose();
    assert.equal(time.jobs.size, 0);
    assert.equal(image.listenerCount(), 0);
  });
  thumbnailTest(({ image, fallback, time }) => {
    image.getAttribute = () => { throw new Error("sensitive URL"); };
    const binding = bindThumbnailFallback({ image, fallback });
    assert.equal(image.hidden, true);
    assert.equal(fallback.hidden, false);
    assert.equal(time.jobs.size, 0);
    binding.dispose();
  });
});
