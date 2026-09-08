import test from "node:test";
import assert from "node:assert/strict";
import { warmAssets, WarmStatus } from "../src/warmer.js";

const target = Object.freeze({ locale: "hr-HR", tier: "1x" });
const exactUrl = "https://cdn.example.test/Game/%2FAsset.BIN?b=2&v=17&a=1&a=3&empty=";
const assets = [
  { url: exactUrl, stage: "PRELOADER", estimatedBytes: 10 },
  { url: "/hr-HR/1x/common.js?v=17", stage: "COMMON", estimatedBytes: 20 },
  { url: "/hr-HR/1x/splash.webp?v=17", stage: "SPLASH", estimatedBytes: 30 },
  { url: "/hr-HR/1x/primary.bin?v=17", stage: "PRIMARY", critical: true, estimatedBytes: 40 },
];
const plan = Object.freeze({ ...target, assets: Object.freeze(assets) });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("preserves production-shaped exact URLs and never exceeds concurrency two", async () => {
  const requestedUrls = [];
  let active = 0;
  let peak = 0;

  const summary = await warmAssets({
    plan,
    target,
    concurrency: 2,
    requestAsset: async (url) => {
      requestedUrls.push(url);
      active += 1;
      peak = Math.max(peak, active);
      await wait(5);
      active -= 1;
    },
  });

  assert.equal(requestedUrls[0], exactUrl);
  assert.deepEqual(requestedUrls, assets.map(({ url }) => url));
  assert.equal(peak, 2);
  assert.equal(summary.attempted, 4);
  assert.equal(summary.requested, 4);
  assert.equal(summary.failed, 0);
});

test("records request failures without claiming cache admission or exposing details", async () => {
  const secret = "playerHash=bearer-cookie-authorization-exclusion-payload";
  const sensitivePlan = {
    ...target,
    assets: [
      { url: `/asset.js?${secret}`, stage: "COMMON", estimatedBytes: 1 },
      { url: "/failure.js", stage: "SPLASH", estimatedBytes: 1 },
    ],
  };

  const summary = await warmAssets({
    plan: sensitivePlan,
    target,
    concurrency: 1,
    requestAsset: async (url) => {
      if (url.includes("failure")) throw new Error(`private error ${secret}`);
    },
  });

  assert.deepEqual(summary.results.map(({ status }) => status), [
    WarmStatus.REQUESTED,
    WarmStatus.FAILED,
  ]);
  assert.equal(summary.requested, 1);
  assert.equal(summary.failed, 1);
  assert.equal(JSON.stringify(summary).includes(secret), false);
  assert.equal(Object.hasOwn(summary.results[0], "url"), false);
});

test("requires a resolved target and rejects mismatches before any request", async () => {
  let calls = 0;
  const requestAsset = async () => { calls += 1; };

  await assert.rejects(warmAssets({ plan, requestAsset }), /target must be an object/);
  await assert.rejects(
    warmAssets({ plan, target: { locale: "en-GB", tier: "1x" }, requestAsset }),
    /does not match/,
  );
  assert.equal(calls, 0);
});

test("rejects unresolved locale and tier placeholders atomically", async () => {
  let calls = 0;
  const requestAsset = async () => { calls += 1; };

  for (const url of [
    "/assets/{locale}/file.js",
    "/assets/${language}/file.js",
    "/assets/{tier}/file.js",
    "/assets/@{resolution}/file.js",
  ]) {
    await assert.rejects(
      warmAssets({
        plan: { ...target, assets: [{ url, stage: "COMMON", estimatedBytes: 1 }] },
        target,
        requestAsset,
      }),
      /unresolved locale or tier/,
    );
  }
  assert.equal(calls, 0);
});

test("aborting bounds uncooperative in-flight requests and starts no more work", async () => {
  const controller = new AbortController();
  let calls = 0;

  const run = warmAssets({
    plan,
    target,
    concurrency: 2,
    signal: controller.signal,
    requestAsset: async () => {
      calls += 1;
      return new Promise(() => {});
    },
  });
  await wait(5);
  controller.abort();
  const summary = await run;

  assert.equal(calls, 2);
  assert.equal(summary.attempted, 2);
  assert.equal(summary.cancelled, 2);
  assert.deepEqual(summary.results.map(({ status }) => status), [
    WarmStatus.CANCELLED,
    WarmStatus.CANCELLED,
  ]);
});

test("an uncooperative request resolving after abort is never marked requested", async () => {
  const controller = new AbortController();
  let release;
  const deferred = new Promise((resolve) => { release = resolve; });

  const run = warmAssets({
    plan: { ...target, assets: assets.slice(0, 1) },
    target,
    signal: controller.signal,
    requestAsset: () => deferred,
  });
  controller.abort();
  release();
  const summary = await run;

  assert.equal(summary.requested, 0);
  assert.equal(summary.cancelled, 1);
});

test("an already-aborted signal starts no requests", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  const summary = await warmAssets({
    plan,
    target,
    signal: controller.signal,
    requestAsset: async () => { calls += 1; },
  });

  assert.equal(calls, 0);
  assert.equal(summary.attempted, 0);
});

test("rejects unsafe stages, non-critical PRIMARY, and excess concurrency", async () => {
  const requestAsset = async () => {};

  await assert.rejects(
    warmAssets({
      plan: { ...target, assets: [{ url: "/secondary.bin", stage: "SECONDARY", estimatedBytes: 1 }] },
      target,
      requestAsset,
    }),
    /prohibited stage/,
  );
  await assert.rejects(
    warmAssets({
      plan: { ...target, assets: [{ url: "/primary.bin", stage: "PRIMARY", critical: false, estimatedBytes: 1 }] },
      target,
      requestAsset,
    }),
    /proven critical/,
  );
  await assert.rejects(
    warmAssets({ plan, target, requestAsset, concurrency: 3 }),
    /concurrency must be an integer from 1 to 2/,
  );
});
