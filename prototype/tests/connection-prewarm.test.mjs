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
