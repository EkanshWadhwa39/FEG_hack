import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TTL_MS,
  createWarmMemory,
  selectLobbyLoadWarmSet,
} from "../src/warm-memory.js";

function fakeStorage({ failOnWrite = false, failOnRead = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem(key) {
      if (failOnRead) throw new DOMException("SecurityError");
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (failOnWrite) throw new DOMException("QuotaExceededError");
      map.set(key, value);
    },
  };
}

test("a remembered title reads back as probably warm", () => {
  let clock = 1_000;
  const memory = createWarmMemory({ storage: fakeStorage(), now: () => clock });

  assert.equal(memory.isProbablyWarm("a", "v1"), false);
  memory.remember("a", "v1");
  assert.equal(memory.isProbablyWarm("a", "v1"), true);
  assert.deepEqual(memory.snapshot(), ["a"]);
});

test("a record expires long before the CDN's own max-age", () => {
  let clock = 0;
  const memory = createWarmMemory({ storage: fakeStorage(), now: () => clock });
  memory.remember("a", "v1");

  clock = DEFAULT_TTL_MS - 1;
  assert.equal(memory.isProbablyWarm("a", "v1"), true);
  clock = DEFAULT_TTL_MS + 1;
  assert.equal(memory.isProbablyWarm("a", "v1"), false, "eviction is invisible to us");
  assert.deepEqual(memory.snapshot(), []);
});

test("a new bundle version shares nothing with the old one", () => {
  const memory = createWarmMemory({ storage: fakeStorage() });
  memory.remember("a", "v1");
  assert.equal(memory.isProbablyWarm("a", "v1"), true);
  assert.equal(memory.isProbablyWarm("a", "v2"), false);
});

test("storage that throws degrades to knowing nothing, never to warm", () => {
  const unwritable = createWarmMemory({ storage: fakeStorage({ failOnWrite: true }) });
  assert.equal(unwritable.remember("a", "v1"), false);
  assert.equal(unwritable.isProbablyWarm("a", "v1"), false);

  const unreadable = createWarmMemory({ storage: fakeStorage({ failOnRead: true }) });
  assert.equal(unreadable.isProbablyWarm("a", "v1"), false);

  const absent = createWarmMemory({ storage: undefined });
  assert.equal(absent.isProbablyWarm("a", "v1"), false);
  assert.deepEqual(absent.snapshot(), []);
});

test("corrupt stored data is discarded rather than trusted", () => {
  const storage = fakeStorage();
  storage.map.set("feg.warm-memory.v1", "{not json");
  const memory = createWarmMemory({ storage });
  assert.equal(memory.isProbablyWarm("a", "v1"), false);

  storage.map.set("feg.warm-memory.v1", JSON.stringify(["an", "array"]));
  assert.deepEqual(memory.snapshot(), []);
});

test("the record is bounded, keeping the freshest entries", () => {
  let clock = 0;
  const memory = createWarmMemory({
    storage: fakeStorage(), now: () => clock, maxEntries: 3,
  });
  for (const id of ["a", "b", "c", "d", "e"]) {
    memory.remember(id, "v1");
    clock += 10;
  }
  const kept = memory.snapshot();
  assert.equal(kept.length, 3);
  assert.deepEqual([...kept].sort(), ["c", "d", "e"]);
});

test("forget and clear remove records", () => {
  const memory = createWarmMemory({ storage: fakeStorage() });
  memory.remember("a", "v1");
  memory.remember("b", "v1");
  memory.forget("a", "v1");
  assert.deepEqual(memory.snapshot(), ["b"]);
  memory.clear();
  assert.deepEqual(memory.snapshot(), []);
});

test("rejects an invalid TTL rather than silently caching forever", () => {
  assert.throws(() => createWarmMemory({ ttlMs: 0 }), RangeError);
  assert.throws(() => createWarmMemory({ ttlMs: Number.NaN }), RangeError);
});

/* ---------------------- lobby-load selection ---------------------- */

test("last-played is preferred over favourites, and never buys an engine", () => {
  const selection = selectLobbyLoadWarmSet({
    recents: ["r1", "r2"],
    favourites: ["f1", "f2"],
    limit: 3,
  });
  assert.deepEqual(selection.candidates, ["r1", "r2", "f1"]);
  assert.deepEqual(selection.sources, ["RECENT", "RECENT", "FAVOURITE"]);
  assert.equal(selection.rung, "WARM");
  assert.equal(selection.playerVisible, false);
});

test("a player with no session history still gets their favourites warmed", () => {
  const selection = selectLobbyLoadWarmSet({ favourites: ["f1", "f2"], limit: 1 });
  assert.deepEqual(selection.candidates, ["f1"]);
  assert.deepEqual(selection.sources, ["FAVOURITE"]);
});

test("titles already warm are skipped, so the budget goes to cold ones", () => {
  const selection = selectLobbyLoadWarmSet({
    recents: ["r1", "r2"],
    alreadyWarm: ["r1"],
    limit: 2,
  });
  assert.deepEqual(selection.candidates, ["r2"]);
});

test("selection rejects nonsense and an invalid limit", () => {
  const selection = selectLobbyLoadWarmSet({ recents: ["", null, 7, "ok"], limit: 5 });
  assert.deepEqual(selection.candidates, ["ok"]);
  assert.deepEqual(selectLobbyLoadWarmSet({ limit: 0, recents: ["a"] }).candidates, []);
  assert.throws(() => selectLobbyLoadWarmSet({ limit: -1 }), RangeError);
});
