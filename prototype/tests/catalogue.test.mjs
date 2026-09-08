import test from "node:test";
import assert from "node:assert/strict";
import { createSyntheticCatalogue, getPlayerCatalogue } from "../src/catalogue.js";
import { resolveManifest, resolvePreparationIdentity } from "../src/manifest.js";
import { buildDrawer, DrawerView, PLAYER_VISIBLE_FIELDS } from "../src/drawer.js";

const origin = "http://127.0.0.1:8080";
function frozenTree(value) {
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") frozenTree(child);
  }
}

test("exactly twenty stable synthetic identities, builds, thumbnails and deep freeze", () => {
  const catalogue = createSyntheticCatalogue({ origin });
  assert.equal(catalogue.length, 20);
  assert.deepEqual(catalogue, createSyntheticCatalogue({ origin }));
  frozenTree(catalogue);
  catalogue.forEach((entry, index) => {
    assert.equal(entry.id, `title-${String(index + 1).padStart(2, "0")}`);
    assert.equal(entry.label, "SIMULATED");
    assert.equal(entry.build, "synthetic-v1");
    assert.ok(entry.title && entry.provider);
    assert.equal(entry.thumbnailUrl, `${origin}/synthetic/${entry.id}/synthetic-v1/thumbnail.svg?v=1`);
  });
});

test("all 240 exact asset keys resolve with immutable version metadata", () => {
  const urls = new Set();
  for (const entry of createSyntheticCatalogue({ origin })) {
    assert.deepEqual(Object.keys(entry.locales), ["hr-HR", "en"]);
    for (const locale of ["hr-HR", "en"]) {
      assert.deepEqual(Object.keys(entry.locales[locale].tiers), ["1x", "0.5x"]);
      for (const tier of ["1x", "0.5x"]) {
        const plan = resolvePreparationIdentity(entry,
          { id: entry.id, build: entry.build, locale, tier },
          { validateUrl: url => assert.equal(new URL(url).origin, origin) });
        assert.deepEqual(plan.assets.map(a => a.stage), ["PRELOADER", "COMMON", "SPLASH"]);
        assert.deepEqual(plan.assets.map(a => a.estimatedBytes), [16384, 32768, 65536]);
        for (const asset of plan.assets) {
          assert.equal(asset.version, "1");
          assert.equal(asset.url, `${origin}/synthetic/${entry.id}/synthetic-v1/${locale}/${tier}/${asset.stage.toLowerCase()}.bin?v=1`);
          urls.add(asset.url);
        }
      }
    }
    assert.throws(() => resolveManifest(entry, { locale: "hr", tier: "1x" }));
    assert.throws(() => resolveManifest(entry, { locale: "en", tier: "2x" }));
  }
  assert.equal(urls.size, 240);
});

test("explicit HTTPS/loopback origins only; reject paths, credentials and URL ambiguity", () => {
  for (const value of ["https://fixtures.example", "http://localhost:8080", "http://[::1]:8080", "http://127.2.3.4", `${origin}/`]) {
    assert.equal(createSyntheticCatalogue({ origin: value }).length, 20);
  }
  for (const value of [undefined, "", "/", "http://example.com", "http://localhost.evil", "file:///tmp",
    "https://user:secret@example.com", "https://example.com/path", "https://example.com/?token=secret",
    "https://example.com/#secret", " https://example.com", "http://2130706433"]) {
    assert.throws(() => createSyntheticCatalogue({ origin: value }), /origin required/);
  }
});

test("player projection contains only the drawer whitelist, never policy or manifest", () => {
  const catalogue = createSyntheticCatalogue({ origin });
  const poisoned = catalogue.map(entry => ({ ...entry, score: 1, policy: "POPULAR_UNPLAYED", weights: {} }));
  const visible = getPlayerCatalogue(poisoned);
  frozenTree(visible);
  assert.deepEqual(visible.map(e => e.id), catalogue.map(e => e.id));
  for (const entry of visible) assert.deepEqual(Object.keys(entry), PLAYER_VISIBLE_FIELDS);
  assert.equal(buildDrawer({ catalogue: visible, view: DrawerView.SEARCH, query: "Synthetic" }).items.length, 20);
  assert.equal(Object.isFrozen(poisoned[0]), false);
});
