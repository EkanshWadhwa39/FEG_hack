import test from "node:test";
import assert from "node:assert/strict";
import { bindContentLoading } from "../src/content-integration.js";
import { createSyntheticCatalogue } from "../src/catalogue.js";

function fixture(beginLaunch, overrides = {}) {
  const callbacks = new Map();
  const root = { isConnected: true, contains: () => true,
    addEventListener: (name, cb) => callbacks.set(name, cb), removeEventListener: name => callbacks.delete(name) };
  const tile = { isConnected: true, dataset: { gameId: "title-01" }, closest: selector => selector === "[data-game-id]" ? tile : null };
  const launches = []; const events = [];
  const loader = { beginLaunch, dispose() {}, cancel() {}, cancelLaunch() {} };
  const catalogue = createSyntheticCatalogue({ origin: "http://127.0.0.1:8090" });
  const options = { root, catalogue, loader, readVariant: () => ({ build: "synthetic-v1", locale: "hr-HR", tier: "1x" }),
    onLaunch: grant => launches.push(grant), onOperatorEvent: event => events.push(event), ...overrides };
  const binding = bindContentLoading(options);
  return { binding, options, launches, events, click: () => callbacks.get("click")({ target: tile }) };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("integration exposes separate static player/thumbnail projections and never policy metadata", () => {
  const f = fixture(async () => ({}));
  assert.equal(f.binding.playerCatalogue.length, 20);
  assert.deepEqual(Object.keys(f.binding.playerCatalogue[0]), ["id", "title", "provider"]);
  assert.deepEqual(Object.keys(f.binding.playerThumbnails["title-01"]), ["label", "url"]);
  assert.ok(Object.isFrozen(f.binding.playerThumbnails["title-01"]));
  assert.throws(() => bindContentLoading({ ...f.options, dwellMs: 149 }), /150ms/);
  f.binding.dispose();
});

test("only a current unrevoked explicit launch grant reaches the UI callback", async () => {
  for (const status of ["AUTHORIZATION_BLOCKED", "IDENTITY_UNRESOLVED", "LAUNCH_BLOCKED"]) {
    const f = fixture(async () => ({ status })); f.click(); await tick(); assert.equal(f.launches.length, 0); f.binding.dispose();
  }
  const controller = new AbortController(); controller.abort();
  const f = fixture(async () => ({ status: "LAUNCH_AUTHORIZED", signal: controller.signal }));
  f.click(); await tick(); assert.equal(f.launches.length, 0); f.binding.dispose();
  const g = fixture(async () => ({ status: "LAUNCH_AUTHORIZED", signal: new AbortController().signal }));
  g.click(); await tick(); assert.equal(g.launches.length, 1); g.binding.dispose();
});

test("late grants after replacement/disposal are suppressed and errors are sanitized", async () => {
  const pending = [];
  const f = fixture(() => new Promise(resolve => pending.push(resolve)));
  f.click(); f.click();
  const grant = { status: "LAUNCH_AUTHORIZED", signal: new AbortController().signal };
  pending[0](grant); await tick(); assert.equal(f.launches.length, 0);
  f.binding.dispose(); pending[1](grant); await tick(); assert.equal(f.launches.length, 0);
  const g = fixture(async () => { throw new Error("do-not-leak-secret"); });
  g.click(); await tick(); assert.deepEqual(g.events, [{ label: "SIMULATED", status: "CONTENT_LOADING_FAILED" }]);
  g.binding.dispose();
});

test("explicit UI cancellation and a replacement-click variant exception invalidate delayed grants", async () => {
  let release;
  const grant = { status: "LAUNCH_AUTHORIZED", signal: new AbortController().signal };
  const f = fixture(() => new Promise(r => { release = r; }));
  f.click(); f.binding.cancelPending(); release(grant); await tick();
  assert.equal(f.launches.length, 0); f.binding.dispose();
  let reads = 0;
  const g = fixture(() => new Promise(r => { release = r; }), { readVariant() {
    if (++reads === 2) throw new Error("private variant detail");
    return { build: "synthetic-v1", locale: "hr-HR", tier: "1x" };
  } });
  g.click(); g.click(); release(grant); await tick();
  assert.equal(g.launches.length, 0); assert.equal(g.events.at(-1).status, "CONTENT_LOADING_FAILED");
  g.binding.dispose();
});
