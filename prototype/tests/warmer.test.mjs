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

test("dispatches largest first within a stage band and never across bands", async () => {
  const banded = [
    { url: "/common-small.js?v=17", stage: "COMMON", estimatedBytes: 10 },
    { url: "/preloader.js?v=17", stage: "PRELOADER", estimatedBytes: 5 },
    { url: "/common-large.js?v=17", stage: "COMMON", estimatedBytes: 900 },
    { url: "/splash.webp?v=17", stage: "SPLASH", estimatedBytes: 4000 },
    { url: "/common-mid.js?v=17", stage: "COMMON", estimatedBytes: 300 },
  ];
  const dispatched = [];

  await warmAssets({
    plan: { ...target, assets: banded },
    target,
    concurrency: 1,
    requestAsset: async (url) => { dispatched.push(url); },
  });

  assert.deepEqual(dispatched, [
    "/preloader.js?v=17",
    "/common-large.js?v=17",
    "/common-mid.js?v=17",
    "/common-small.js?v=17",
    "/splash.webp?v=17",
  ]);
});

test("results stay addressable by the caller's own asset order", async () => {
  const banded = [
    { url: "/splash.webp?v=17", stage: "SPLASH", estimatedBytes: 4000 },
    { url: "/preloader.js?v=17", stage: "PRELOADER", estimatedBytes: 5 },
  ];

  const summary = await warmAssets({
    plan: { ...target, assets: banded },
    target,
    concurrency: 1,
    requestAsset: async () => {},
  });

  assert.deepEqual(
    summary.results.map(({ index, stage }) => [index, stage]),
    [[0, "SPLASH"], [1, "PRELOADER"]],
  );
});

test("a ledger suppresses a repeat request for an exact URL already warmed", async () => {
  const { createWarmLedger } = await import("../src/warm-ledger.js");
  const ledger = createWarmLedger();
  const firstRun = [];
  const secondRun = [];

  const first = await warmAssets({
    plan, target, ledger, requestAsset: async (url) => { firstRun.push(url); },
  });
  const second = await warmAssets({
    plan, target, ledger, requestAsset: async (url) => { secondRun.push(url); },
  });

  assert.equal(first.requested, 4);
  assert.equal(first.skipped, 0);
  assert.equal(secondRun.length, 0);
  assert.equal(second.skipped, 4);
  assert.equal(second.requested, 0);
  assert.equal(second.results.every((r) => r.status === WarmStatus.SKIPPED), true);
});

test("a failed request is not recorded as warmed and is retried next time", async () => {
  const { createWarmLedger } = await import("../src/warm-ledger.js");
  const ledger = createWarmLedger();
  const single = { ...target, assets: [{ url: "/preloader.js?v=17", stage: "PRELOADER", estimatedBytes: 5 }] };

  const first = await warmAssets({
    plan: single, target, ledger, requestAsset: async () => { throw new Error("network"); },
  });
  let retried = 0;
  const second = await warmAssets({
    plan: single, target, ledger, requestAsset: async () => { retried += 1; },
  });

  assert.equal(first.failed, 1);
  assert.equal(retried, 1);
  assert.equal(second.requested, 1);
});

test("a ledger key is the exact URL and is never normalized", async () => {
  const { createWarmLedger } = await import("../src/warm-ledger.js");
  const ledger = createWarmLedger();
  const variants = {
    ...target,
    assets: [
      { url: "/asset.bin?v=17&a=1", stage: "COMMON", estimatedBytes: 10 },
      { url: "/asset.bin?a=1&v=17", stage: "COMMON", estimatedBytes: 10 },
    ],
  };
  const dispatched = [];

  const summary = await warmAssets({
    plan: variants, target, ledger, requestAsset: async (url) => { dispatched.push(url); },
  });

  assert.equal(summary.requested, 2);
  assert.equal(summary.skipped, 0);
  assert.equal(dispatched.length, 2);
});
