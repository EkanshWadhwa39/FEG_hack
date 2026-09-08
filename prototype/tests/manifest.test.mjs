import test from "node:test";
import assert from "node:assert/strict";
import { resolveManifest } from "../src/manifest.js";

const manifest = {
  locales: {
    "hr-HR": {
      tiers: {
        "1x": {
          assets: [
            { url: "/hr/preloader.js?v=1", stage: "PRELOADER", estimatedBytes: 10 },
            { url: "/hr/splash.webp?v=1", stage: "SPLASH", estimatedBytes: 20 },
            { url: "/hr/primary.bin?v=1", stage: "PRIMARY", critical: true, estimatedBytes: 30 },
            { url: "/hr/noncritical.bin?v=1", stage: "PRIMARY", critical: false, estimatedBytes: 40 },
            { url: "/hr/secondary.bin?v=1", stage: "SECONDARY", estimatedBytes: 50 },
          ],
        },
        "0.5x": {
          assets: [{ url: "/hr/half.js?v=1", stage: "COMMON", estimatedBytes: 5 }],
        },
      },
    },
    "en-GB": {
      tiers: {
        "1x": {
          assets: [{ url: "/en/common.js?v=1", stage: "COMMON", estimatedBytes: 7 }],
        },
      },
    },
  },
};

test("selects exactly one locale and tier without combining branches", () => {
  const resolved = resolveManifest(manifest, { locale: "hr-HR", tier: "0.5x" });
  assert.equal(resolved.locale, "hr-HR");
  assert.equal(resolved.tier, "0.5x");
  assert.deepEqual(resolved.assets.map(({ url }) => url), ["/hr/half.js?v=1"]);
});

test("excludes SECONDARY and non-critical PRIMARY assets", () => {
  const resolved = resolveManifest(manifest, { locale: "hr-HR", tier: "1x" });
  assert.deepEqual(
    resolved.assets.map(({ stage }) => stage),
    ["PRELOADER", "SPLASH", "PRIMARY"],
  );
  assert.equal(resolved.assets.some(({ url }) => url.includes("secondary")), false);
  assert.equal(resolved.assets.some(({ url }) => url.includes("noncritical")), false);
});

test("does not normalize or fall back from locale and tier keys", () => {
  assert.throws(
    () => resolveManifest(manifest, { locale: "hr-hr", tier: "1x" }),
    /unsupported locale/,
  );
  assert.throws(
    () => resolveManifest(manifest, { locale: "hr-HR", tier: "2x" }),
    /unsupported tier/,
  );
});

test("requires explicit locale and tier selections", () => {
  assert.throws(() => resolveManifest(manifest, { tier: "1x" }), /locale/);
  assert.throws(() => resolveManifest(manifest, { locale: "hr-HR" }), /tier/);
});

test("rejects malformed asset metadata", () => {
  const malformed = {
    locales: {
      "hr-HR": {
        tiers: { "1x": { assets: [{ stage: "COMMON", estimatedBytes: 1 }] } },
      },
    },
  };
  assert.throws(
    () => resolveManifest(malformed, { locale: "hr-HR", tier: "1x" }),
    /exact URL/,
  );
});

import { resolvePreparationIdentity } from "../src/manifest.js";
const strictTarget = { id: "title-01", build: "synthetic-v1", locale: "hr-HR", tier: "1x" };
const strictManifest = { id: strictTarget.id, build: strictTarget.build, locales: {
  "hr-HR": { tiers: { "1x": { assets: [
    { url: "https://cdn.example.test/title-01/synthetic-v1/hr-HR/1x/a.bin?v=1", version: "1", stage: "COMMON", estimatedBytes: 10 },
  ] } } },
} };
const validateUrl = url => { assert.match(url, /^https:/); };

test("strict content identity resolves title, build, exact variant and version before preparation", () => {
  const plan = resolvePreparationIdentity(strictManifest, strictTarget, { validateUrl });
  assert.equal(plan.id, strictTarget.id); assert.equal(plan.build, strictTarget.build);
  assert.equal(plan.assets[0].url, strictManifest.locales["hr-HR"].tiers["1x"].assets[0].url);
  for (const key of ["id", "build", "locale", "tier"]) {
    assert.throws(() => resolvePreparationIdentity(strictManifest, { ...strictTarget, [key]: undefined }, { validateUrl }));
  }
  assert.throws(() => resolvePreparationIdentity(strictManifest, { ...strictTarget, build: "other" }, { validateUrl }));
  assert.throws(() => resolvePreparationIdentity(strictManifest, strictTarget), /boundary/);
});

test("strict identity rejects missing/mismatched versions, duplicate keys and unbounded bodies atomically", () => {
  for (const patch of [{ version: undefined }, { version: "2" }, { url: "https://cdn.example.test/a" },
    { url: "https://cdn.example.test/a?v=1&v=2" }, { url: "https://cdn.example.test/{build}/a?v=1" }, { estimatedBytes: 0 }]) {
    const manifest = structuredClone(strictManifest);
    Object.assign(manifest.locales["hr-HR"].tiers["1x"].assets[0], patch);
    assert.throws(() => resolvePreparationIdentity(manifest, strictTarget, { validateUrl }));
  }
});
