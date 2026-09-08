import test from "node:test";
import assert from "node:assert/strict";
import { createCredentialFreeBrowserRequester, createSandboxBrowserRequester,
  requireCredentialFreeHttpsUrl } from "../src/browser-requester.js";
const origin = "https://cdn.example.test";
const exactUrl = `${origin}/Game/%2FAsset.BIN?b=2&v=17&a=1&a=3&empty=`;
const make = options => createCredentialFreeBrowserRequester({ allowedOrigins: [origin], ...options });
const options = { estimatedBytes: 10 };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("preserves exact URL, omits credentials/referrer, blocks redirects and drains body", async () => {
  const calls = [];
  const requester = make({ fetchImpl: async (...args) => { calls.push(args); return new Response("123"); } });
  assert.deepEqual(await requester(exactUrl, options), { label: "MEASURED", completed: true, bodyBytes: 3 });
  assert.equal(calls[0][0], exactUrl);
  const request = calls[0][1];
  assert.equal(request.credentials, "omit");
  assert.equal(request.cache, "default");
  assert.equal(request.mode, "cors");
  assert.equal(request.redirect, "error");
  assert.equal(request.referrerPolicy, "no-referrer");
  assert.equal(Object.hasOwn(request, "headers"), false);
});

test("rejects unsafe origins/credentials/fragments before network and keeps HTTPS production boundary", async () => {
  let calls = 0;
  const requester = make({ fetchImpl: async () => { calls++; return new Response("a"); } });
  for (const url of ["/relative", "http://cdn.example.test/a", "https://other.test/a",
    `${origin}/a?token=x`, `${origin}/a?playerHash=x`, `${origin}/a?session_id=x`,
    "https://user:secret@cdn.example.test/a", `${origin}/a#x`, ` ${origin}/a`]) {
    await assert.rejects(requester(url, options));
  }
  assert.equal(calls, 0);
  assert.throws(() => createCredentialFreeBrowserRequester(), /origins/);
  assert.throws(() => make({ mode: "no-cors" }), /readable/);
  assert.throws(() => requireCredentialFreeHttpsUrl("http://127.0.0.1/a"), /HTTPS/);
  assert.throws(() => createSandboxBrowserRequester({ origin: "http://example.com" }), /loopback/);
  const local = createSandboxBrowserRequester({ origin: "http://127.0.0.1:1234", fetchImpl: async () => new Response("a") });
  await local("http://127.0.0.1:1234/a", options);
  await assert.rejects(local("http://127.0.0.1:1235/a", options));
});

test("opaque, missing, redirected and failed responses cannot report completed preparation", async () => {
  for (const response of [undefined, { ok: true, type: "opaque" }, { ok: true, redirected: true },
    { ok: true }, new Response("missing", { status: 404 })]) {
    await assert.rejects(make({ fetchImpl: async () => response })(exactUrl, options));
  }
});

test("holds both slots until full bodies complete; third request does not start at headers", async () => {
  const bodies = [];
  let starts = 0;
  const requester = make({ fetchImpl: async () => {
    starts++;
    return new Response(new ReadableStream({ start(c) { bodies.push(c); } }));
  } });
  const work = [0, 1, 2].map(() => requester(exactUrl, options));
  await tick(); assert.equal(starts, 2);
  bodies[0].enqueue(new Uint8Array(4)); bodies[0].close();
  await work[0]; await tick(); assert.equal(starts, 3);
  bodies[1].close(); bodies[2].close();
  await Promise.all(work);
});

test("cancel queued work without issuing fetch and do not refund active slot early", async () => {
  const bodies = []; let starts = 0;
  const requester = make({ fetchImpl: async () => { starts++; return new Response(new ReadableStream({ start(c) { bodies.push(c); } })); } });
  const work = [requester(exactUrl, options), requester(exactUrl, options)];
  const controller = new AbortController();
  const queued = requester(exactUrl, { ...options, signal: controller.signal });
  controller.abort(); await assert.rejects(queued, /cancelled/);
  assert.equal(starts, 2);
  for (const b of bodies) b.close(); await Promise.all(work);
});

test("body bound is enforced and observed bytes include an oversized delivered chunk", async () => {
  let observed = 0;
  await assert.rejects(make({ fetchImpl: async () => new Response(new Uint8Array(12)) })(exactUrl,
    { ...options, onBytes: bytes => { observed += bytes; } }), /reservation/);
  assert.equal(observed, 12);
  await assert.rejects(make({ fetchImpl: async () => new Response("a", { headers: { "Content-Length": "100" } }) })(exactUrl, options), /reservation/);
});

test("timeout and caller cancellation abort fetch; partial bodies fail rather than succeed", async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  await assert.rejects(make({ fetchImpl, timeoutMs: 5 })(exactUrl, options), /aborted/);
  const controller = new AbortController();
  const run = make({ fetchImpl })(exactUrl, { ...options, signal: controller.signal });
  await tick(); controller.abort(); await assert.rejects(run);
  await assert.rejects(make({ fetchImpl: async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(2)); c.error(new Error("truncated")); },
  })) })(exactUrl, options), /truncated/);
});
