import test from "node:test";
import assert from "node:assert/strict";
import { ASSET_SPEC, TOTAL_BODY_BYTES, validateLaunchPlan, hashBytes, seedFromAssetHashes,
  createDeck, createTheme, createGame, selectCard, dismissMismatch, resetGame } from "../src/content-game-model.js";
import { consumeLaunchAssets } from "../src/content-game.js";

const ORIGIN = "http://localhost:8090";
function launchMessage({ origin = ORIGIN, id = "title-01", locale = "en", tier = "1x" } = {}) {
  return { type: "CONTENT_LAUNCH", launchId: "launch-unit-1", title: { id, title: "Synthetic Title 01" }, locale, tier,
    assets: ASSET_SPEC.map(spec => ({ stage: spec.stage, estimatedBytes: spec.estimatedBytes, version: "1",
      url: `${origin}/synthetic/${id}/synthetic-v1/${locale}/${tier}/${spec.file}.bin?v=1` })) };
}
function plan() { return validateLaunchPlan(launchMessage(), ORIGIN); }
const tick = () => new Promise(resolve => setImmediate(resolve));

test("all 20 allowlisted titles, both locales and tiers validate exact fixture keys", () => {
  for (let n = 1; n <= 20; n += 1) for (const locale of ["hr-HR", "en"]) for (const tier of ["1x", "0.5x"]) {
    const message = launchMessage({ id: `title-${String(n).padStart(2, "0")}`, locale, tier });
    const result = validateLaunchPlan(message, ORIGIN);
    assert.equal(result.title.id, message.title.id);
    assert.equal(result.assets.reduce((sum, asset) => sum + asset.estimatedBytes, 0), TOTAL_BODY_BYTES);
    assert.deepEqual(result.assets.map(a => a.url), message.assets.map(a => a.url));
  }
});

test("exact HTTPS and loopback origins only", () => {
  for (const origin of ["https://sandbox.example", "http://127.0.0.1:8090", "http://[::1]:8090"]) {
    assert.ok(validateLaunchPlan(launchMessage({ origin }), origin));
  }
  for (const origin of ["null", "file:///tmp", "http://example.com", "http://localhost:8090/", "https://u:p@host", "https://host/#fragment"]) {
    assert.throws(() => validateLaunchPlan(launchMessage({ origin }), origin), TypeError);
  }
});

test("detached frozen whitelist, canonical stage order, no metadata leakage", () => {
  const message = launchMessage();
  message.assets.reverse();
  message.assets[0].untrustedMetadata = "not forwarded";
  message.secret = "not forwarded";
  const result = validateLaunchPlan(message, ORIGIN);
  message.title.title = "changed";
  message.assets[0].url = "changed";
  assert.equal(result.title.title, "Synthetic Title 01");
  assert.deepEqual(result.assets.map(a => a.stage), ["PRELOADER", "COMMON", "SPLASH"]);
  assert.ok(result.assets[2].url.endsWith("splash.bin?v=1"));
  assert.equal(result.secret, undefined);
  assert.equal(result.assets[2].untrustedMetadata, undefined);
  for (const object of [result, result.title, result.assets, ...result.assets]) assert.ok(Object.isFrozen(object));
});

const badPlans = [
  ["wrong message type", m => { m.type = "CONTENT_READY"; }],
  ["empty launch id", m => { m.launchId = ""; }],
  ["non-string launch id", m => { m.launchId = 42; }],
  ["control character launch id", m => { m.launchId = "a\nb"; }],
  ["overlong launch id", m => { m.launchId = "x".repeat(129); }],
  ["id zero", m => { m.title.id = "title-00"; }],
  ["id beyond catalogue", m => { m.title.id = "title-21"; }],
  ["non-padded id", m => { m.title.id = "title-1"; }],
  ["coerced id", m => { m.title.id = ["title-01"]; }],
  ["missing title", m => { m.title = null; }],
  ["empty display title", m => { m.title.title = "  "; }],
  ["overlong display title", m => { m.title.title = "x".repeat(121); }],
  ["unresolved locale", m => { delete m.locale; }],
  ["unknown locale", m => { m.locale = "en-US"; }],
  ["unknown tier", m => { m.tier = "2x"; }],
  ["not three assets", m => { m.assets.pop(); }],
  ["extra asset", m => { m.assets.push(m.assets[0]); }],
  ["duplicate stage", m => { m.assets[1] = m.assets[0]; }],
  ["lowercase stage", m => { m.assets[0].stage = "preloader"; }],
  ["secondary stage", m => { m.assets[2].stage = "SECONDARY"; }],
  ["null asset", m => { m.assets[1] = null; }],
  ["wrong byte bound", m => { m.assets[0].estimatedBytes += 1; }],
  ["string byte bound", m => { m.assets[0].estimatedBytes = "16384"; }],
  ["missing version", m => { delete m.assets[0].version; }],
  ["numeric version", m => { m.assets[0].version = 1; }],
  ["different version", m => { m.assets[0].version = "2"; }],
  ["different version key", m => { m.assets[0].versionKey = "version"; }],
  ["path-version override", m => { m.assets[0].versionInPath = true; }],
];
for (const [name, mutate] of badPlans) test(`reject launch: ${name}`, () => {
  const message = launchMessage(); mutate(message);
  assert.throws(() => validateLaunchPlan(message, ORIGIN), /Invalid synthetic launch plan/);
});
for (const [name, alter] of [
  ["relative URL", url => new URL(url).pathname + "?v=1"],
  ["foreign origin", url => url.replace(ORIGIN, "https://foreign.example")],
  ["credentials", url => url.replace("http://", "http://user:password@")],
  ["fragment", url => `${url}#fragment`],
  ["empty fragment", url => `${url}#`],
  ["token query", url => `${url}&token=secret`],
  ["duplicate version", url => `${url}&v=1`],
  ["different version", url => url.replace("v=1", "v=2")],
  ["missing version", url => url.split("?")[0]],
  ["title mismatch", url => url.replace("title-01", "title-02")],
  ["build mismatch", url => url.replace("synthetic-v1", "synthetic-v2")],
  ["locale mismatch", url => url.replace("/en/", "/hr-HR/")],
  ["tier mismatch", url => url.replace("/1x/", "/0.5x/")],
  ["uppercase filename", url => url.replace("preloader.bin", "PRELOADER.bin")],
  ["encoded filename", url => url.replace("preloader", "%70reloader")],
  ["dot segment normalization", url => url.replace("/preloader", "/unused/../preloader")],
  ["whitespace normalization", url => ` ${url}`],
]) test(`reject exact URL violation: ${name}`, () => {
  const message = launchMessage(); message.assets[0].url = alter(message.assets[0].url);
  assert.throws(() => validateLaunchPlan(message, ORIGIN), TypeError);
});

test("null and non-object messages fail closed", () => {
  for (const message of [null, undefined, false, "launch", [], {}]) assert.throws(() => validateLaunchPlan(message, ORIGIN), TypeError);
});

test("seed hashes all bytes and is independent of stream chunk boundaries", () => {
  const body = Uint8Array.from({ length: 4097 }, (_, i) => i % 251);
  const hash = hashBytes(body);
  assert.equal(hashBytes(body.subarray(7), hashBytes(body.subarray(0, 7))), hash);
  for (const index of [0, 2000, 4096]) {
    const altered = body.slice(); altered[index] ^= 1;
    assert.notEqual(hashBytes(altered), hash);
  }
  assert.equal(hashBytes(new Uint8Array()), 2166136261);
  assert.throws(() => hashBytes([1]), TypeError);
});

test("all three stage hashes influence the seed; stage order matters", () => {
  const base = seedFromAssetHashes([11, 22, 33]);
  for (let i = 0; i < 3; i += 1) {
    const hashes = [11, 22, 33]; hashes[i] += 1;
    assert.notEqual(seedFromAssetHashes(hashes), base);
  }
  assert.notEqual(seedFromAssetHashes([33, 22, 11]), base);
  assert.throws(() => seedFromAssetHashes([1, 2]), TypeError);
  assert.throws(() => seedFromAssetHashes([1, -1, 3]), RangeError);
});

test("seeded decks always contain eight exact pairs, reproducibly, without Math.random", () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const deck = createDeck(seed);
    assert.equal(deck.length, 16);
    assert.deepEqual(deck, createDeck(seed));
    for (let symbol = 0; symbol < 8; symbol += 1) assert.equal(deck.filter(value => value === symbol).length, 2);
    assert.ok(Object.isFrozen(deck));
  }
  assert.notDeepEqual(createDeck(0), createDeck(1));
  assert.deepEqual(createDeck(0xffffffff), createDeck(0xffffffff));
});

test("theme is stable, seed-dependent and bounded", () => {
  const themes = new Set();
  for (let seed = 0; seed < 100; seed += 1) {
    const theme = createTheme(seed);
    assert.deepEqual(theme, createTheme(seed));
    assert.ok(theme.hue >= 155 && theme.hue <= 220);
    assert.ok(theme.accentHue >= 265 && theme.accentHue <= 320);
    assert.ok(theme.rotation >= -12 && theme.rotation <= 11);
    assert.ok(Object.isFrozen(theme));
    themes.add(JSON.stringify(theme));
  }
  assert.ok(themes.size > 90);
});

test("invalid seeds are rejected rather than silently coerced", () => {
  for (const seed of [-1, 1.5, NaN, Infinity, 0x100000000, "1", null, undefined]) {
    for (const fn of [createGame, createDeck, createTheme]) assert.throws(() => fn(seed), RangeError);
  }
});

test("first selection, same-card no-op and matching pair are immutable transitions", () => {
  const initial = createGame(42);
  const first = selectCard(initial, 0);
  assert.deepEqual(first.faceUp, [0]);
  assert.equal(first.turns, 0);
  assert.equal(selectCard(first, 0), first);
  const twin = first.deck.findIndex((symbol, index) => index !== 0 && symbol === first.deck[0]);
  const matched = selectCard(first, twin);
  assert.equal(matched.turns, 1);
  assert.equal(matched.pairs, 1);
  assert.deepEqual(matched.matched, [0, twin]);
  assert.deepEqual(matched.faceUp, []);
  assert.equal(selectCard(matched, twin), matched);
  assert.deepEqual(initial, createGame(42));
  for (const state of [initial, first, matched]) {
    assert.ok(Object.isFrozen(state)); assert.ok(Object.isFrozen(state.faceUp)); assert.ok(Object.isFrozen(state.matched));
  }
});

test("mismatch stays visible, blocks third card, and dismiss preserves turns", () => {
  const initial = createGame(17);
  const different = initial.deck.findIndex(symbol => symbol !== initial.deck[0]);
  const mismatch = selectCard(selectCard(initial, 0), different);
  assert.equal(mismatch.turns, 1);
  assert.equal(mismatch.pairs, 0);
  assert.deepEqual(mismatch.faceUp, [0, different]);
  for (let i = 0; i < 16; i += 1) assert.equal(selectCard(mismatch, i), mismatch);
  const dismissed = dismissMismatch(mismatch);
  assert.deepEqual(dismissed.faceUp, []);
  assert.equal(dismissed.turns, 1);
  assert.equal(dismissMismatch(dismissed), dismissed);
  assert.equal(dismissMismatch(selectCard(initial, 0)).faceUp.length, 1);
});

test("completion requires all pairs; reset reproduces same board from every state", () => {
  let state = createGame(99);
  for (let symbol = 0; symbol < 8; symbol += 1) {
    const pair = state.deck.flatMap((value, index) => value === symbol ? [index] : []);
    state = selectCard(state, pair[0]);
    assert.equal(state.complete, false);
    assert.deepEqual(resetGame(state), createGame(99));
    state = selectCard(state, pair[1]);
    assert.equal(state.complete, symbol === 7);
  }
  assert.equal(state.turns, 8);
  assert.equal(state.pairs, 8);
  assert.equal(state.matched.length, 16);
  assert.equal(selectCard(state, 0), state);
  assert.deepEqual(resetGame(state), createGame(99));
  const mismatchIndex = state.deck.findIndex(value => value !== state.deck[0]);
  const mismatch = selectCard(selectCard(createGame(99), 0), mismatchIndex);
  assert.deepEqual(resetGame(mismatch), createGame(99));
});

test("invalid indexes throw without mutating state", () => {
  const state = createGame(7);
  for (const index of [-1, 16, 1.5, NaN, Infinity, "0", undefined, null]) assert.throws(() => selectCard(state, index), RangeError);
  assert.deepEqual(state, createGame(7));
});

/** Fake full-body transport: no network, browser, cache or provider assets. */
function fakeTransport({ bodyDelta = 0, bad = null, chunkSize = 4096, blocked = false } = {}) {
  let active = 0, maximum = 0, reads = 0, cancelled = 0, eof = 0;
  const calls = [];
  const fetchImpl = async (url, options) => {
    const asset = plan().assets.find(item => item.url === url);
    assert.ok(asset);
    calls.push({ url, options });
    active += 1; maximum = Math.max(maximum, active);
    let offset = 0, released = false;
    const close = () => { if (!released) { active -= 1; released = true; } };
    const reader = {
      async read() {
        reads += 1;
        if (blocked) await new Promise((_, reject) => {
          if (options.signal.aborted) reject(new DOMException("Aborted", "AbortError"));
          else options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
        await tick();
        if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const length = asset.estimatedBytes + bodyDelta;
        if (offset === length) { eof += 1; return { done: true }; }
        const size = Math.min(chunkSize, length - offset);
        const value = Uint8Array.from({ length: size }, (_, i) => (offset + i + asset.estimatedBytes / 1024) % 251);
        offset += size;
        return { done: false, value };
      },
      async cancel() { cancelled += 1; close(); },
      releaseLock() { close(); },
    };
    const response = { status: 200, ok: true, type: "basic", redirected: false, url,
      headers: { get: () => null }, body: { getReader: () => reader, cancel: () => reader.cancel() } };
    bad?.(response);
    return response;
  };
  return { fetchImpl, calls, get stats() { return { active, maximum, reads, cancelled, eof }; } };
}

test("real consumer holds at most two slots through EOF, exact fetch semantics, byte/timing/seed results", async () => {
  const transport = fakeTransport(); let now = 0;
  const result = await consumeLaunchAssets(plan(), { fetchImpl: transport.fetchImpl, now: () => ++now, timeOrigin: 123000 });
  assert.equal(result.bodyBytes, TOTAL_BODY_BYTES);
  assert.equal(transport.stats.maximum, 2);
  assert.equal(transport.stats.active, 0);
  assert.equal(transport.stats.eof, 3);
  assert.equal(transport.calls.length, 3);
  for (const { url, options } of transport.calls) {
    assert.ok(plan().assets.some(a => a.url === url));
    assert.deepEqual(Object.keys(options).sort(), ["method", "credentials", "referrerPolicy", "mode", "cache", "redirect", "signal"].sort());
    assert.deepEqual({ ...options, signal: null }, { method: "GET", credentials: "omit", referrerPolicy: "no-referrer",
      mode: "cors", cache: "default", redirect: "error", signal: null });
  }
  assert.equal(result.bodyCompleteEpochMs, result.bodyCompleteMs + 123000);
  assert.equal(result.bodyCompleteMs, Math.max(...result.results.map(r => r.bodyCompleteMs)));
  assert.equal(result.durationMs, result.bodyCompleteMs - result.launchStartMs);
  assert.deepEqual(result.results.map(r => r.bodyBytes), ASSET_SPEC.map(a => a.estimatedBytes));
  const rechunked = fakeTransport({ chunkSize: 1777 });
  const again = await consumeLaunchAssets(plan(), { fetchImpl: rechunked.fetchImpl });
  assert.equal(again.seed, result.seed);
});

for (const [name, options] of [
  ["short body", { bodyDelta: -1 }], ["oversized streamed body", { bodyDelta: 1 }],
  ["HTTP error", { bad: r => { r.status = 404; r.ok = false; } }],
  ["partial response", { bad: r => { r.status = 206; } }],
  ["redirected response", { bad: r => { r.redirected = true; } }],
  ["opaque response", { bad: r => { r.type = "opaque"; } }],
  ["missing stream reader", { bad: r => { delete r.body.getReader; } }],
  ["changed response URL", { bad: r => { r.url += "&changed=1"; } }],
  ["oversized declared body", { bad: r => { r.headers.get = () => "9999999"; } }],
  ["malformed declared length", { bad: r => { r.headers.get = () => "oops"; } }],
]) test(`consumer fails closed and cancels both slots: ${name}`, async () => {
  const transport = fakeTransport(options);
  await assert.rejects(consumeLaunchAssets(plan(), { fetchImpl: transport.fetchImpl }));
  assert.equal(transport.stats.active, 0);
  assert.equal(transport.calls.length, 2);
  assert.ok(transport.stats.cancelled >= 2);
});

test("headers alone cannot complete; matching cancellation stops stalled bodies", async () => {
  const controller = new AbortController(), transport = fakeTransport({ blocked: true });
  let completed = false;
  const pending = consumeLaunchAssets(plan(), { fetchImpl: transport.fetchImpl, signal: controller.signal })
    .then(value => { completed = true; return value; });
  await tick();
  assert.equal(completed, false);
  assert.equal(transport.stats.active, 2);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(transport.stats.active, 0);
  assert.equal(transport.stats.eof, 0);
  assert.equal(transport.calls.length, 2);
});

test("already aborted launch issues no requests", async () => {
  const controller = new AbortController(); controller.abort();
  const transport = fakeTransport();
  await assert.rejects(consumeLaunchAssets(plan(), { fetchImpl: transport.fetchImpl, signal: controller.signal }), { name: "AbortError" });
  assert.equal(transport.calls.length, 0);
});

test("bounded timeout cancels slow bodies without successful completion", async () => {
  const transport = fakeTransport({ blocked: true });
  await assert.rejects(consumeLaunchAssets(plan(), { fetchImpl: transport.fetchImpl, timeoutMs: 15 }), { name: "AbortError" });
  assert.equal(transport.stats.active, 0);
  assert.equal(transport.stats.eof, 0);
});

// Tiny DOM/event doubles exercise controller logic in Node, NOT native trust,
// rendering, Resource Timing or cache evidence. Only lead may run real browsers.
class ElementDouble {
  constructor() {
    this.handlers = {}; this.children = []; this.attributes = {}; this.dataset = {};
    this.classList = { toggle() {} }; this.style = { setProperty() {} };
  }
  addEventListener(type, fn) { (this.handlers[type] ??= []).push(fn); }
  fire(type, data = {}) { for (const fn of this.handlers[type] ?? []) fn(data); }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  focus() { this.focused = true; }
}
async function runtimeHarness(run, { transport = fakeTransport(), resourceTimings = true, clockStep = 1 } = {}) {
  const originals = Object.fromEntries(["window", "document", "location", "fetch", "performance"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const nodes = new Map();
  const messages = [];
  const parent = { postMessage(message, origin) { assert.equal(origin, ORIGIN); messages.push(message); } };
  const win = new ElementDouble(); win.parent = parent;
  let now = 0;
  const perf = { timeOrigin: 1000000, now: () => (now += clockStep),
    getEntriesByName(name) {
      return resourceTimings ? [{ name, initiatorType: "fetch", startTime: now, duration: 2,
        responseEnd: now + 2, transferSize: 0, encodedBodySize: 16384, decodedBodySize: 16384 }] : [];
    } };
  const doc = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, new ElementDouble()); return nodes.get(id); },
    createElement: () => new ElementDouble(), createElementNS: () => new ElementDouble(), documentElement: new ElementDouble() };
  const values = { window: win, document: doc, location: { origin: ORIGIN }, fetch: transport.fetchImpl, performance: perf };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  try {
    await import(`../src/content-game.js?node-double=${runtimeHarness.counter++}`);
    const send = (data, extra = {}) => win.fire("message", { source: parent, origin: ORIGIN, data, ...extra });
    const until = async type => {
      for (let n = 0; n < 400; n += 1) { if (messages.some(m => m.type === type)) return; await new Promise(resolve => setTimeout(resolve, 1)); }
      assert.fail(`Missing ${type}`);
    };
    await run({ nodes, messages, send, until, win, parent, transport });
  } finally {
    win.fire("pagehide");
    await tick();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}
runtimeHarness.counter = 0;

test("controller: handshake, origin/source gate, one launch, body milestone, trusted valid input and completion", async () => {
  await runtimeHarness(async ({ nodes, messages, send, until, transport }) => {
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "CONTENT_READY");
    assert.equal(messages[0].handshake, true);
    assert.equal(transport.calls.length, 0);
    send(launchMessage(), { source: {} });
    send(launchMessage(), { origin: "https://foreign.example" });
    assert.equal(transport.calls.length, 0);
    send(launchMessage()); send(launchMessage());
    await until("CONTENT_ASSETS_COMPLETE");
    assert.equal(transport.calls.length, 3);
    const assets = messages.find(m => m.type === "CONTENT_ASSETS_COMPLETE");
    assert.equal(assets.bodyBytes, TOTAL_BODY_BYTES);
    assert.ok(assets.bodyCompleteEpochMs < assets.epochMs);
    assert.equal(assets.scope.kind, "synthetic-original-reference-scene");
    assert.equal(assets.resourceTimings.length, 3);
    assert.ok(assets.assets.every(a => !("hash" in a)));
    assert.ok(!messages.some(m => m.type === "CONTENT_INPUT_ACCEPTED"));
    const cards = nodes.get("board").children;
    assert.equal(cards.length, 16);
    cards[0].fire("click", { isTrusted: false, detail: 1 });
    assert.ok(!messages.some(m => m.type === "CONTENT_INPUT_ACCEPTED"));
    assert.equal(cards[0].attributes["aria-label"], "Card 1, face down");
    cards[0].fire("click", { isTrusted: true, detail: 0 });
    assert.equal(messages.filter(m => m.type === "CONTENT_INPUT_ACCEPTED").length, 1);
    const input = messages.find(m => m.type === "CONTENT_INPUT_ACCEPTED");
    assert.equal(input.inputKind, "keyboard-or-assistive");
    assert.ok(input.inputAcceptedEpochMs >= assets.bodyCompleteEpochMs);
    cards[0].fire("click", { isTrusted: true, detail: 0 });
    assert.equal(messages.filter(m => m.type === "CONTENT_INPUT_ACCEPTED").length, 1);
    send({ type: "CONTENT_ABORT", launchId: "wrong-id" });
    assert.ok(!messages.some(m => m.type === "CONTENT_ABORTED"));
    // Solve by observation using resets; no game state is exposed by the protocol.
    const seen = new Map();
    for (let index = 0; index < 16; index += 1) {
      nodes.get("reset").fire("click", { isTrusted: true });
      cards[index].fire("click", { isTrusted: true, detail: 1 });
      const name = cards[index].attributes["aria-label"].split(", ")[1];
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name).push(index);
    }
    assert.ok(!messages.some(m => m.type === "CONTENT_GAME_COMPLETE"));
    nodes.get("reset").fire("click", { isTrusted: true });
    for (const pair of seen.values()) for (const index of pair) cards[index].fire("click", { isTrusted: true, detail: 1 });
    assert.equal(messages.filter(m => m.type === "CONTENT_GAME_COMPLETE").length, 1);
    assert.equal(messages.at(-1).pairs, 8);
    assert.equal(messages.at(-1).turns, 8);
    assert.equal(transport.calls.length, 3);
    send({ type: "CONTENT_ABORT", launchId: launchMessage().launchId });
    assert.equal(messages.at(-1).type, "CONTENT_ABORTED");
    assert.ok(cards.every(card => card.disabled));
    send(launchMessage());
    assert.equal(transport.calls.length, 3);
  });
});

test("controller invalid first launch is terminal and error carries no unsafe data", async () => {
  await runtimeHarness(async ({ messages, send, transport }) => {
    const bad = launchMessage(); bad.assets[0].url += "&token=NEVER-FORWARD";
    send(bad); send(launchMessage());
    assert.equal(transport.calls.length, 0);
    assert.equal(messages.at(-1).type, "CONTENT_ERROR");
    assert.equal(messages.at(-1).code, "INVALID_LAUNCH");
    assert.equal(messages.at(-1).launchId, null);
    assert.ok(!JSON.stringify(messages).includes("NEVER-FORWARD"));
  });
});

test("controller pagehide and matching parent abort cancel in-flight reads with no success events", async () => {
  for (const reason of ["pagehide", "parent"]) {
    await runtimeHarness(async ({ messages, send, win, transport }) => {
      send(launchMessage()); await tick();
      assert.equal(transport.stats.active, 2);
      if (reason === "parent") send({ type: "CONTENT_ABORT", launchId: launchMessage().launchId });
      else win.fire("pagehide");
      await tick(); await tick();
      assert.equal(transport.stats.active, 0);
      assert.ok(!messages.some(m => ["CONTENT_ASSETS_COMPLETE", "CONTENT_INPUT_ACCEPTED", "CONTENT_GAME_COMPLETE"].includes(m.type)));
    }, { transport: fakeTransport({ blocked: true }) });
  }
});

test("controller missing RT remains UNKNOWN with bounded polling and preserved body timestamp", async () => {
  await runtimeHarness(async ({ messages, send, until }) => {
    send(launchMessage());
    await until("CONTENT_ASSETS_COMPLETE");
    const assets = messages.find(m => m.type === "CONTENT_ASSETS_COMPLETE");
    assert.equal(assets.resourceTimingLabel, "UNKNOWN");
    assert.deepEqual(assets.resourceTimings, [null, null, null]);
    assert.equal(assets.bodyCompleteEpochMs, Math.max(...assets.assets.map(a => a.bodyCompleteEpochMs)));
    assert.ok(assets.epochMs > assets.bodyCompleteEpochMs);
    assert.ok(assets.resourceTimingWaitMs < 400); // Accelerated fake clock, not performance evidence.
    assert.ok(!messages.some(m => m.type === "CONTENT_INPUT_ACCEPTED"));
  }, { resourceTimings: false, clockStep: 20 });
});

test("controller reset and arrow focus cannot establish input; mismatch persists until trusted Continue", async () => {
  await runtimeHarness(async ({ messages, nodes, send, until }) => {
    send(launchMessage()); await until("CONTENT_ASSETS_COMPLETE");
    nodes.get("reset").fire("click", { isTrusted: true });
    const cards = nodes.get("board").children;
    cards[0].fire("keydown", { key: "ArrowRight", isTrusted: true, preventDefault() {} });
    assert.ok(cards[1].focused);
    assert.ok(!messages.some(m => m.type === "CONTENT_INPUT_ACCEPTED"));
    const transport = fakeTransport();
    const { seed } = await consumeLaunchAssets(plan(), { fetchImpl: transport.fetchImpl });
    const deck = createDeck(seed);
    const different = deck.findIndex(value => value !== deck[0]);
    cards[0].fire("click", { isTrusted: true, detail: 1 });
    cards[different].fire("click", { isTrusted: true, detail: 1 });
    assert.equal(messages.find(m => m.type === "CONTENT_INPUT_ACCEPTED").inputKind, "pointer");
    assert.equal(nodes.get("continue").hidden, false);
    assert.ok(cards.every(card => card.attributes["aria-disabled"] === "true"));
    const third = cards.findIndex((_, i) => i !== 0 && i !== different);
    cards[third].fire("click", { isTrusted: true, detail: 1 });
    assert.equal(cards[third].attributes["aria-label"], `Card ${third + 1}, face down`);
    nodes.get("continue").fire("click", { isTrusted: false });
    assert.equal(nodes.get("continue").hidden, false);
    nodes.get("continue").fire("click", { isTrusted: true });
    assert.equal(nodes.get("continue").hidden, true);
    assert.ok(cards[0].focused);
    assert.ok(cards.every(card => card.attributes["aria-disabled"] === "false"));
    assert.equal(messages.filter(m => m.type === "CONTENT_INPUT_ACCEPTED").length, 1);
  });
});

test("controller load failure publishes only a fixed safe code, no success event", async () => {
  await runtimeHarness(async ({ messages, send, until }) => {
    send(launchMessage()); await until("CONTENT_ERROR");
    assert.equal(messages.at(-1).code, "ASSET_LOAD_FAILED");
    assert.ok(!messages.some(m => m.type === "CONTENT_ASSETS_COMPLETE"));
    assert.ok(!JSON.stringify(messages).includes("PRIVATE-NETWORK-DETAIL"));
  }, { transport: { fetchImpl: async () => { throw new Error("PRIVATE-NETWORK-DETAIL"); } } });
});
