import assert from "node:assert/strict";
import test from "node:test";

import {
  ConnectionPrewarmStatus,
  createBrowserConnectionPrewarmer,
  createSyntheticConnectionPrewarmer,
  prewarmConnectionOnDrawerOpen,
} from "../src/connection-prewarm.js";

const allowedEnvironment = Object.freeze({
  enabled: true,
  saveData: false,
  effectiveType: "4g",
  visibilityState: "visible",
  byteBudget: 1,
  bytesUsed: 0,
});

function fakeDocument() {
  const appended = [];
  return {
    appended,
    createElement(tagName) {
      return { tagName };
    },
    head: {
      append(...elements) {
        appended.push(...elements);
      },
    },
  };
}

test("browser adapter emits anonymous DNS and preconnect hints once per origin", async () => {
  const documentImpl = fakeDocument();
  const prewarm = createBrowserConnectionPrewarmer({ documentImpl });

  const first = await prewarm("https://session.example/session/create?v=public-build");
  const second = await prewarm("https://session.example/other/path");

  assert.deepEqual(first, { evidenceLabel: "UNKNOWN", hintsAdded: 2, deduplicated: false });
  assert.deepEqual(second, { evidenceLabel: "UNKNOWN", hintsAdded: 0, deduplicated: true });
  assert.equal(documentImpl.appended.length, 2);
  assert.equal(documentImpl.appended[0].rel, "dns-prefetch");
  assert.equal(documentImpl.appended[0].href, "//session.example");
  assert.equal(documentImpl.appended[1].rel, "preconnect");
  assert.equal(documentImpl.appended[1].href, "https://session.example");
  assert.equal(documentImpl.appended[1].crossOrigin, "anonymous");
});

test("adapter rejects credential-bearing or non-HTTPS session endpoints", async () => {
  const prewarm = createBrowserConnectionPrewarmer({ documentImpl: fakeDocument() });

  await assert.rejects(
    prewarm("https://session.example/session/create?token=secret"),
    /credential-like/,
  );
  await assert.rejects(
    prewarm("http://session.example/session/create"),
    /HTTPS/,
  );
});

test("drawer-open boundary fails closed through the governor", async () => {
  let calls = 0;
  const result = await prewarmConnectionOnDrawerOpen({
    exactSessionEndpoint: "https://session.example/session/create",
    environment: { ...allowedEnvironment, effectiveType: undefined },
    prewarmConnection: async () => { calls += 1; },
  });

  assert.equal(result.status, ConnectionPrewarmStatus.GOVERNOR_BLOCKED);
  assert.equal(result.governorReason, "CONNECTION_UNKNOWN");
  assert.equal(result.hintsAdded, 0);
  assert.equal(calls, 0);
});

test("browser adapter hints asset-CDN origins and reuses the dedup set across origins", async () => {
  const documentImpl = fakeDocument();
  const prewarm = createBrowserConnectionPrewarmer({ documentImpl });

  const first = await prewarm("https://cdn-a.example.test/assets/base");
  const second = await prewarm("https://cdn-a.example.test/assets/other.bin");
  const third = await prewarm("https://cdn-b.example.test/assets/base");

  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(third.deduplicated, false);
  assert.equal(documentImpl.appended.length, 4);
});

test("drawer-open boundary hints the session endpoint and asset-CDN origins, deduping shared origins", async () => {
  const calls = [];
  const prewarmConnection = async (target) => {
    calls.push(target);
    const alreadyHinted = calls.filter((c) => c === target).length > 1;
    return {
      evidenceLabel: "SIMULATED",
      hintsAdded: alreadyHinted ? 0 : 2,
      deduplicated: alreadyHinted,
    };
  };

  const result = await prewarmConnectionOnDrawerOpen({
    exactSessionEndpoint: "https://session.example/session/create",
    exactAssetOrigins: [
      "https://cdn-a.example.test",
      "https://cdn-b.example.test",
      "https://session.example/session/create",
    ],
    environment: allowedEnvironment,
    prewarmConnection,
  });

  assert.equal(result.status, ConnectionPrewarmStatus.HINTS_EMITTED);
  assert.equal(result.hintsAdded, 6);
  assert.equal(result.deduplicated, false);
  assert.deepEqual(calls, [
    "https://session.example/session/create",
    "https://cdn-a.example.test",
    "https://cdn-b.example.test",
    "https://session.example/session/create",
  ]);
});

test("drawer-open boundary can hint asset origins alone, before the session endpoint is known", async () => {
  let calls = 0;
  const result = await prewarmConnectionOnDrawerOpen({
    exactAssetOrigins: ["https://cdn-a.example.test"],
    environment: allowedEnvironment,
    prewarmConnection: async () => {
      calls += 1;
      return { evidenceLabel: "SIMULATED", hintsAdded: 2, deduplicated: false };
    },
  });

  assert.equal(result.status, ConnectionPrewarmStatus.HINTS_EMITTED);
  assert.equal(result.hintsAdded, 2);
  assert.equal(calls, 1);
});

test("drawer-open boundary requires at least one endpoint or asset origin", async () => {
  await assert.rejects(
    prewarmConnectionOnDrawerOpen({
      environment: allowedEnvironment,
      prewarmConnection: async () => ({}),
    }),
    /exactSessionEndpoint or at least one exactAssetOrigins/,
  );
});

test("synthetic drawer-open adapter records no-I/O hint without exposing target", async () => {
  let recorded = 0;
  const prewarmConnection = createSyntheticConnectionPrewarmer({
    recordHint: () => { recorded += 1; },
  });

  const result = await prewarmConnectionOnDrawerOpen({
    exactSessionEndpoint: "https://session.example/session/create",
    environment: allowedEnvironment,
    prewarmConnection,
  });

  assert.deepEqual(result, {
    status: ConnectionPrewarmStatus.HINTS_EMITTED,
    governorReason: "ALLOWED",
    evidenceLabel: "SIMULATED",
    hintsAdded: 2,
    deduplicated: false,
  });
  assert.equal(recorded, 1);
  assert.equal(JSON.stringify(result).includes("session.example"), false);
});
