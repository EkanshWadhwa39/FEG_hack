import test from "node:test";
import assert from "node:assert/strict";

import {
  createCredentialFreeBrowserRequester,
  requireCredentialFreeHttpsUrl,
} from "../src/browser-requester.js";

const exactUrl = "https://cdn.example.test/Game/%2FAsset.BIN?b=2&v=17&a=1&a=3&empty=";

test("preserves the exact HTTPS URL and forces a credential-free standard-cache request", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const requester = createCredentialFreeBrowserRequester({
    mode: "cors",
    fetchImpl: async (...args) => {
      calls.push(args);
      return { ok: true, type: "cors" };
    },
  });

  await requester(exactUrl, { signal });

  assert.deepEqual(calls, [[exactUrl, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "default",
    signal,
  }]]);
  assert.equal(Object.hasOwn(calls[0][1], "headers"), false);
});

test("accepts opaque no-cors completion without claiming cache admission", async () => {
  const requester = createCredentialFreeBrowserRequester({
    mode: "no-cors",
    fetchImpl: async () => ({ ok: false, type: "opaque" }),
  });

  await assert.doesNotReject(requester(exactUrl));
});

test("rejects non-HTTPS, embedded credentials, and credential-like query keys before fetch", async () => {
  let calls = 0;
  const requester = createCredentialFreeBrowserRequester({
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, type: "cors" };
    },
  });

  for (const unsafeUrl of [
    "http://cdn.example.test/asset.js?v=1",
    "https://user:password@cdn.example.test/asset.js?v=1",
    "https://cdn.example.test/asset.js?token=secret",
    "https://cdn.example.test/asset.js?launchToken=secret",
    "https://cdn.example.test/asset.js?session_id=secret",
    "https://cdn.example.test/asset.js?signature=secret",
  ]) {
    await assert.rejects(requester(unsafeUrl), /HTTPS|credentials|credential-like/);
  }
  assert.equal(calls, 0);
});

test("rejects unsupported request modes and unsuccessful visible responses", async () => {
  assert.throws(
    () => createCredentialFreeBrowserRequester({ fetchImpl: async () => ({}), mode: "same-origin" }),
    /cors or no-cors/,
  );
  assert.throws(() => requireCredentialFreeHttpsUrl("/relative.js"), /absolute/);

  const requester = createCredentialFreeBrowserRequester({
    fetchImpl: async () => ({ ok: false, type: "cors" }),
  });
  await assert.rejects(requester(exactUrl), /did not complete successfully/);
});
