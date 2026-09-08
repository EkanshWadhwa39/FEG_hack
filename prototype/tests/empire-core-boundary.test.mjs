import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxCatalogueRequester, createSandboxBrowserRequester,
  createCredentialFreeBrowserRequester } from "../src/bounded-browser-requester.js";
import { resolvePreparationIdentity } from "../src/manifest.js";
import { createContentLoader } from "../src/content-loader.js";
import { createSyntheticCatalogue } from "../src/catalogue.js";
import { createSyntheticSession, createPopularityPrior } from "../src/candidate-policy.js";
import { createSyntheticAuthorization } from "../src/content-adapters.js";
import { createEmpireSource, EARLY_ASSETS } from "../src/empire-catalogue.js";

// Pure Node contract tests: fixtures and injected fetch only; no server/browser.
const origins = Array.from({ length: 20 }, (_, i) => `http://127.0.0.1:${18100 + i}`);
const urls = origins.map(origin => `${origin}/assets/early.bin`);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const opts = { estimatedBytes: 16 };
const make = options => createSandboxCatalogueRequester({ origins, allowedAssetUrls: urls, ...options });
const settle = promise => promise.then(value => ({ value }), error => ({ error }));

// Deadlines here catch a broken implementation without leaving tests hanging.
test("catalogue configuration requires 1..20 exact loopback origins and a nonempty exact URL subset", () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response("a"); };
  for (const invalid of [undefined, null, [], {}, "all"]) {
    assert.throws(() => make({ allowedAssetUrls: invalid, fetchImpl }), /asset URLs/);
  }
  for (const invalid of [undefined, [], [origins[0], origins[0]], [...origins, "http://127.0.0.1:19000"],
    ["https://localhost:18100"], ["http://example.test:18100"], [`${origins[0]}/`],
    ["http://127.0.0.1:18100/path"], ["http://user@127.0.0.1:18100"], ["http://127.1:18100"]]) {
    assert.throws(() => make({ origins: invalid, fetchImpl }));
  }
  for (const invalid of [[`${origins[0]}/a`, "http://127.0.0.1:19000/a"], [urls[0], urls[0]],
    ["/relative"], [`${urls[0]}#fragment`], [`${urls[0]}?token=private`],
    ["http://user:pass@127.0.0.1:18100/a"]]) {
    assert.throws(() => make({ allowedAssetUrls: invalid, fetchImpl }));
  }
  for (const origin of [origins[0], "http://localhost:18100", "http://[::1]:18100"]) {
    assert.equal(typeof make({ origins: [origin], allowedAssetUrls: [`${origin}/a`], fetchImpl }), "function");
  }
  assert.equal(calls, 0);
});

test("exact asset approval is private and rejects unlisted ports/paths/queries/versions before fetch", async () => {
  const approvedOrigins = [origins[0]];
  const exact = `${origins[0]}/Game/%2FAsset.BIN?b=2&v=17&a=1&a=3&empty=`;
  const allowed = [exact]; const seen = [];
  const request = make({ origins: approvedOrigins, allowedAssetUrls: allowed,
    fetchImpl: async url => { seen.push(url); return new Response("a"); } });
  approvedOrigins.push(origins[1]); allowed.push(urls[0], urls[1]);
  assert.ok(Object.isFrozen(request));
  for (const url of [urls[0], urls[1], exact.replace("18100", "18120"), exact.replace("Asset", "asset"),
    exact.replace("v=17", "v=18"), `${exact}&extra=1`, exact.replace("b=2&v=17", "v=17&b=2"),
    exact.replace("%2F", "%2f"), `${origins[0]}/Game/../assets/early.bin`]) {
    await assert.rejects(request(url, opts), /approved|HTTPS/);
  }
  assert.deepEqual(seen, []);
  assert.equal((await request(exact, opts)).completed, true);
  assert.deepEqual(seen, [exact]);
});

test("optional exact lists tighten existing exports without opening their HTTPS/loopback boundaries", async () => {
  const production = "https://cdn.example.test/a?v=1";
  const request = createCredentialFreeBrowserRequester({ allowedOrigins: ["https://cdn.example.test"],
    allowedAssetUrls: [production], fetchImpl: async () => new Response("a") });
  await request(production, opts);
  await assert.rejects(request(`${production}&other=1`, opts), /approved/);
  assert.throws(() => createCredentialFreeBrowserRequester({ allowedOrigins: [origins[0]], allowedAssetUrls: [urls[0]] }), /HTTPS/);
  const sandbox = createSandboxBrowserRequester({ origin: origins[0], allowedAssetUrls: [urls[0]], fetchImpl: async () => new Response("a") });
  await sandbox(urls[0], opts);
  await assert.rejects(sandbox(`${urls[0]}?v=1`, opts), /approved/);
});

test("overlapping calls across all twenty origins share two slots through delayed body completion", { timeout: 2000 }, async () => {
  const bodies = []; let active = 0; let peak = 0;
  const request = make({ fetchImpl: async url => {
    peak = Math.max(peak, ++active);
    return new Response(new ReadableStream({ start(controller) { bodies.push({ url, controller }); } }));
  } });
  const work = urls.map(url => request(url, opts));
  await tick(); assert.equal(bodies.length, 2);
  for (let i = 0; i < urls.length; i++) {
    assert.equal(bodies[i].url, urls[i]);
    bodies[i].controller.enqueue(new Uint8Array(3)); active--; bodies[i].controller.close();
    assert.equal((await work[i]).bodyBytes, 3); await tick();
    assert.equal(bodies.length, Math.min(i + 3, 20));
  }
  await Promise.all(work); assert.equal(peak, 2); assert.equal(active, 0);
});

test("revocation removes queued work and retains slots until delayed active-body cancellation settles", { timeout: 2000 }, async () => {
  const cancels = []; let starts = 0;
  const request = make({ fetchImpl: async () => {
    starts++;
    if (starts > 2) return new Response("a");
    return new Response(new ReadableStream({ cancel() { const d = deferred(); cancels.push(d); return d.promise; } }));
  } });
  const controller = new AbortController();
  const old = urls.slice(0, 3).map(url => settle(request(url, { ...opts, signal: controller.signal })));
  await tick(); assert.equal(starts, 2);
  controller.abort(); assert.ok((await Promise.all(old)).every(r => r.error?.name === "AbortError"));
  const next = request(urls[3], opts); await tick();
  assert.equal(starts, 2); assert.equal(cancels.length, 2);
  cancels[0].resolve(); await next; assert.equal(starts, 3);
  cancels[1].resolve();
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(request(urls[4], { ...opts, signal: alreadyAborted.signal }), /cancelled/);
  assert.equal(starts, 3);
});

test("late headers after abort are cancelled before admitting another origin", { timeout: 2000 }, async () => {
  const headers = [deferred(), deferred()]; let starts = 0; let cancelled = 0;
  const request = make({ fetchImpl: () => ++starts <= 2 ? headers[starts - 1].promise : Promise.resolve(new Response("a")) });
  const controller = new AbortController();
  const work = urls.slice(0, 2).map(url => settle(request(url, { ...opts, signal: controller.signal })));
  await tick(); controller.abort(); await Promise.all(work);
  const next = request(urls[2], opts); await tick(); assert.equal(starts, 2);
  for (const h of headers) h.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await next; assert.equal(starts, 3); assert.equal(cancelled, 2);
});

test("HTTP error bodies are cancelled unread and occupy slots until cleanup completes", { timeout: 2000 }, async () => {
  const cancels = []; let starts = 0;
  const request = make({ fetchImpl: async () => {
    starts++;
    if (starts > 2) return new Response("ok");
    return new Response(new ReadableStream({ cancel() { const d = deferred(); cancels.push(d); return d.promise; } }), { status: 503 });
  } });
  await Promise.all(urls.slice(0, 2).map(url => assert.rejects(request(url, opts), /successfully/)));
  const next = request(urls[2], opts); await tick(); assert.equal(starts, 2); assert.equal(cancels.length, 2);
  cancels[0].resolve(); await next; cancels[1].resolve(); assert.equal(starts, 3);
});

test("redirects, opaque/error responses, and a mismatched final URL cannot report success; bodies cancel", async () => {
  for (const metadata of [{ redirected: true }, { url: `${urls[0]}?version=other` }, { url: urls[1] },
    { type: "opaque" }, { type: "opaqueredirect" }, { type: "error" }, { ok: false }]) {
    let cancelled = 0; let options;
    const request = make({ fetchImpl: async (_url, init) => {
      options = init;
      return { ok: true, ...metadata, body: new ReadableStream({ cancel() { cancelled++; } }) };
    } });
    await assert.rejects(request(urls[0], opts), /successfully/);
    assert.equal(options.redirect, "error"); assert.equal(cancelled, 1);
  }
});

test("strict positive safe-integer body bounds and callback types reject before any network", async () => {
  let calls = 0;
  const request = make({ fetchImpl: async () => { calls++; return new Response("a"); } });
  for (const estimatedBytes of [undefined, null, 0, -1, 0.5, Infinity, NaN, "12", Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(request(urls[0], { estimatedBytes }), /reservation/);
  }
  await assert.rejects(request(urls[0], { ...opts, onBytes: true }), /callable/);
  assert.equal(calls, 0);
});

test("oversized headers/chunks and observer failures cancel bodies and never declare completion", async () => {
  for (const contentLength of ["17", "-1", "x", "1.1", "9007199254740992"]) {
    let cancelled = 0;
    const request = make({ fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled++; } }),
      { headers: { "Content-Length": contentLength } }) });
    await assert.rejects(request(urls[0], opts), /reservation/); assert.equal(cancelled, 1);
  }
  let cancelled = 0; let observed = 0;
  const request = make({ fetchImpl: async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(8)); c.enqueue(new Uint8Array(9)); }, cancel() { cancelled++; },
  })) });
  await assert.rejects(request(urls[0], { ...opts, onBytes: n => { observed += n; } }), /reservation/);
  assert.equal(observed, 17); assert.equal(cancelled, 1);
  await assert.rejects(request(urls[0], { ...opts, onBytes() { throw new Error("observer failed"); } }), /observer failed/);
  assert.equal(cancelled, 2);
});

test("timeout bounds stalled body reads independently of fetch abort support", { timeout: 2000 }, async () => {
  let cancelled = 0; let signal;
  const request = make({ timeoutMs: 15, fetchImpl: async (_url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({ cancel() { cancelled++; } }));
  } });
  await assert.rejects(request(urls[0], opts), error => error.name === "TimeoutError");
  assert.equal(signal.aborted, true); assert.equal(cancelled, 1);
  await assert.rejects(request(urls[1], opts), /timed out/); assert.equal(cancelled, 2);
});

test("uncooperative headers and failed cleanup fail closed; queued calls have their own deadline", { timeout: 2000 }, async () => {
  for (const kind of ["headers", "cancel-throws", "cancel-hangs", "release-lock-throws"]) {
    let starts = 0;
    const request = make({ timeoutMs: 15, fetchImpl: async () => {
      starts++;
      if (kind === "headers") return new Promise(() => {});
      if (kind === "release-lock-throws") return { ok: true, body: { getReader() { return {
        read: async () => ({ done: true }), releaseLock() { throw new Error("lock failed"); },
      }; } } };
      return { ok: false, body: { cancel() {
        if (kind === "cancel-hangs") return new Promise(() => {});
        throw new Error("cleanup failed");
      } } };
    } });
    const result = await Promise.all(urls.slice(0, 3).map(url => settle(request(url, opts))));
    assert.equal(starts, 2, kind);
    assert.equal(result[2].error?.name, "TimeoutError", kind);
    if (kind !== "release-lock-throws") assert.ok(result[0].error);
  }
});

test("low priority is optional, never escalates, and does not alter credential/cache/redirect semantics", async () => {
  for (const priority of [undefined, "low"]) {
    let init;
    const request = make({ priority, fetchImpl: async (_url, options) => { init = options; return new Response("a"); } });
    await request(urls[0], { ...opts, priority: "high" });
    assert.equal(Object.hasOwn(init, "priority"), priority === "low");
    assert.equal(init.priority, priority);
    assert.equal(init.method, "GET"); assert.equal(init.mode, "cors"); assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "default"); assert.equal(init.referrerPolicy, "no-referrer"); assert.equal(init.redirect, "error");
    assert.equal(Object.hasOwn(init, "headers"), false);
  }
  for (const priority of ["high", "auto", true, null]) assert.throws(() => make({ priority }), /priority/);
});

const target = Object.freeze({ id: "title-01", build: "synthetic-v1", locale: "en", tier: "1x" });
// Twelve test-only release records model the adapter contract, NOT audited bundle data.
const releaseAssets = Array.from({ length: 12 }, (_, i) => Object.freeze({
  url: `${origins[0]}/assets/early-${i}.bin`, stage: ["PRELOADER", "COMMON", "SPLASH"][Math.floor(i / 4)],
  estimatedBytes: 1, sha256: i.toString(16).padStart(64, "0"), releaseBuild: target.build,
}));
const manifestFor = (assets = releaseAssets) => ({ id: target.id, build: target.build,
  locales: { en: { tiers: { "1x": { assets } } } } });
const validateUrl = make({ allowedAssetUrls: releaseAssets.map(a => a.url) }).validateUrl;
function trusted(asset, identity) {
  return Object.keys(target).every(key => identity[key] === target[key])
    && releaseAssets.some(approved => Object.keys(approved).every(key => asset[key] === approved[key]));
}
const resolve = (manifest = manifestFor(), identity = target, callback = trusted) =>
  resolvePreparationIdentity(manifest, identity, { validateUrl, validateReleaseAsset: callback });

test("trusted release mapping approves twelve unhashed early assets without changing their consumption URLs", () => {
  const plan = resolve();
  assert.equal(plan.assets.length, 12);
  assert.deepEqual(plan.assets.map(a => a.url), releaseAssets.map(a => a.url));
  assert.equal(plan.assets.some(a => a.url.includes("?")), false);
  assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.assets));
  resolve(manifestFor(), target, (asset, identity) => {
    assert.ok(Object.isFrozen(asset)); assert.ok(Object.isFrozen(identity)); return trusted(asset, identity);
  });
});

test("release hashes and untrusted JSON flags cannot replace a literal true injected verdict", async () => {
  for (const callback of [null, false, true, () => false, () => undefined, () => "true", () => 1,
    () => ({ approved: true }), () => { throw new Error("private diagnostic"); },
    async () => true, async () => { throw new Error("late private diagnostic"); }]) {
    assert.throws(() => resolve(manifestFor(), target, callback), /trusted release/);
  }
  const json = manifestFor(releaseAssets.map(a => ({ ...a, trustedRelease: true, releaseApproved: true, validateReleaseAsset: true })));
  assert.throws(() => resolvePreparationIdentity(json, target, { validateUrl }), /trusted release/);
  assert.throws(() => resolvePreparationIdentity(json, target, { validateUrl, validateReleaseAsset: true }), /trusted release/);
  for (const patch of [{ sha256: undefined }, { sha256: "a".repeat(63) }, { sha256: "g".repeat(64) }, { sha256: "a".repeat(64) + "\n" },
    { releaseBuild: undefined }, { releaseBuild: "other" }]) {
    assert.throws(() => resolve(manifestFor([{ ...releaseAssets[0], ...patch }]), target, () => true), /trusted release/);
  }
  await tick(); // A rejected asynchronous verdict must not produce an unhandled rejection.
});

test("trusted mapping rejects metadata/path/hash tampering, even if a version is added", () => {
  for (const patch of [{ sha256: "f".repeat(64) }, { estimatedBytes: 2 }, { stage: "COMMON" },
    { stage: "PRIMARY", critical: true }, { url: `${releaseAssets[0].url}?v=1`, version: "1" },
    { url: releaseAssets[1].url }]) {
    assert.throws(() => resolve(manifestFor([{ ...releaseAssets[0], ...patch }])), /trusted release/);
  }
});

test("release validation preserves exact title/build/locale/tier/origin, duplicate, and byte boundaries", () => {
  for (const key of Object.keys(target)) {
    for (const value of [undefined, "", "other", "{unresolved}"]) assert.throws(() => resolve(manifestFor(), { ...target, [key]: value }));
  }
  for (const key of ["id", "build"]) assert.throws(() => resolve({ ...manifestFor(), [key]: "other" }), /mismatch/);
  assert.throws(() => resolve(manifestFor([releaseAssets[0], releaseAssets[0]])), /duplicate/);
  for (const estimatedBytes of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => resolve(manifestFor([{ ...releaseAssets[0], estimatedBytes }]), target, () => true));
  }
  assert.throws(() => resolve(manifestFor([{ ...releaseAssets[0], url: urls[1] }]), target, () => true), /approved/);
  assert.throws(() => resolvePreparationIdentity(manifestFor(), target, { validateReleaseAsset: trusted }), /URL validation/);
  assert.throws(() => resolvePreparationIdentity(manifestFor(), target, { validateReleaseAsset: trusted, validateUrl: () => false }), /approved/);
});

test("Vite eight-character URL-safe version tokens still match only exact suffixes/path components", () => {
  const version = "aB3_-xY8";
  const asset = { stage: "PRELOADER", estimatedBytes: 1, version, versionInPath: true };
  const resolveVersion = url => resolvePreparationIdentity(manifestFor([{ ...asset, url }]), target,
    { validateUrl: make({ allowedAssetUrls: [url] }).validateUrl });
  for (const path of [`/assets/index-${version}.js`, `/assets/index.${version}.css`, `/${version}/index.js`]) {
    assert.equal(resolveVersion(`${origins[0]}${path}`).assets[0].version, version);
  }
  for (const path of [`/assets/index-${version}X.js`, `/assets/index-X${version}.js`, `/${version}X/index.js`, `/assets/${version}tail.js`]) {
    assert.throws(() => resolveVersion(`${origins[0]}${path}`), /versioned URL/);
  }
  for (const invalid of ["short", "aB3.xY89", "aB3+xY89", "a".repeat(129)]) {
    const url = `${origins[0]}/index-${invalid}.js`;
    assert.throws(() => resolvePreparationIdentity(manifestFor([{ ...asset, version: invalid, url }]), target,
      { validateUrl: () => url }), /versioned URL/);
  }
  for (const suffix of ["?v=17", "?v=17&v=17", "?v=18", "?v=17x"]) {
    const url = `${origins[0]}/early.bin${suffix}`;
    const run = () => resolvePreparationIdentity(manifestFor([{ ...asset, version: "17", versionInPath: false, url }]), target,
      { validateUrl: () => url });
    if (suffix === "?v=17") assert.equal(run().assets[0].url, url); else assert.throws(run, /versioned URL/);
  }
});

function loaderFixture({ callback = trusted, assets = releaseAssets, requestAsset } = {}) {
  const catalogue = createSyntheticCatalogue({ origin: origins[0] });
  const calls = []; const authorization = createSyntheticAuthorization("GRANTED");
  const manifestSource = { marker: true, async resolve() { return manifestFor(assets); },
    validateReleaseAsset: typeof callback === "function" ? function (asset, identity) {
      assert.equal(this.marker, true, "source method receiver is preserved"); return callback(asset, identity);
    } : callback };
  const loader = createContentLoader({ catalogue, session: createSyntheticSession({ catalogue }),
    prior: createPopularityPrior(), manifestSource, authorization,
    requestAsset: requestAsset ?? make({ allowedAssetUrls: releaseAssets.map(a => a.url), fetchImpl: async url => {
      calls.push(url); return new Response("a");
    } }), environment: { read: () => ({ saveData: false, effectiveType: "4g", visibilityState: "visible" }) },
    byteBudget: 128, policy: "POPULAR_UNPLAYED" });
  loader.setEnabled(true);
  return { loader, calls, authorization, manifestSource, prepare: () => loader.prepare({ ...target, candidateId: target.id }) };
}

test("loader forwards bound trusted callback and warms no SECONDARY or unproven PRIMARY assets", async () => {
  const assets = [...releaseAssets].reverse();
  assets.push({ ...releaseAssets[0], stage: "SECONDARY", critical: true }, { ...releaseAssets[0], stage: "PRIMARY" });
  const f = loaderFixture({ assets });
  try {
    assert.equal((await f.prepare()).status, "REQUESTS_COMPLETE");
    const stages = f.calls.map(url => releaseAssets.find(a => a.url === url).stage);
    assert.deepEqual(stages, [...Array(4).fill("PRELOADER"), ...Array(4).fill("COMMON"), ...Array(4).fill("SPLASH")]);
    assert.equal(f.calls.length, 12); assert.equal(f.loader.snapshot().completedObjects, 12);
    assert.equal((await f.prepare()).status, "ALREADY_REQUESTED");
  } finally { f.loader.dispose(); }
  assert.throws(() => resolve(manifestFor([{ ...releaseAssets[0], stage: "SECONDARY", critical: true }])), /no eligible/);
});

test("loader invalid callbacks fail closed before requests or reservations, including throwing getters", async () => {
  for (const callback of [null, true, () => false, () => { throw new Error("private mapping"); }, async () => true]) {
    const f = loaderFixture({ callback });
    try {
      assert.equal((await f.prepare()).status, "IDENTITY_UNRESOLVED");
      assert.equal(f.calls.length, 0); assert.equal(f.loader.snapshot().reservedBodyBytes, 0);
    } finally { f.loader.dispose(); }
  }
  const f = loaderFixture();
  Object.defineProperty(f.manifestSource, "validateReleaseAsset", { get() { throw new Error("bad boundary"); } });
  try { assert.equal((await f.prepare()).status, "IDENTITY_UNRESOLVED"); assert.equal(f.calls.length, 0); }
  finally { f.loader.dispose(); }
});

test("live authorization revocation stops release-mapped preparation and never marks incomplete bodies complete", { timeout: 2000 }, async () => {
  let starts = 0; let cancelled = 0;
  const requestAsset = make({ allowedAssetUrls: releaseAssets.map(a => a.url), fetchImpl: async () => {
    starts++; return new Response(new ReadableStream({ cancel() { cancelled++; } }));
  } });
  const f = loaderFixture({ requestAsset });
  try {
    const running = f.prepare(); await tick(); assert.equal(starts, 2);
    f.authorization.setState("DENIED"); assert.equal((await running).status, "CANCELLED"); await tick();
    assert.equal(starts, 2); assert.equal(cancelled, 2); assert.equal(f.loader.snapshot().completedObjects, 0);
    assert.equal(f.loader.snapshot().reservedBodyBytes, 12);
    assert.equal((await f.prepare()).status, "AUTHORIZATION_BLOCKED"); assert.equal(starts, 2);
  } finally { f.loader.dispose(); }
});

test("URL approval is synchronous and exact, retaining existing void/true/exact-string validators", async () => {
  for (const validateUrl of [() => undefined, () => true, url => url]) {
    assert.equal(resolvePreparationIdentity(manifestFor(), target, { validateUrl, validateReleaseAsset: trusted }).assets.length, 12);
  }
  for (const validateUrl of [() => false, () => null, () => 1, () => ({ approved: true }),
    url => `${url}?changed=1`, async url => url, async () => { throw new Error("private async failure"); }]) {
    assert.throws(() => resolvePreparationIdentity(manifestFor(), target, { validateUrl, validateReleaseAsset: trusted }), /approved/);
  }
  await tick(); // Asynchronous rejection is suppressed, never treated as approval.
});

test("individual safe bounds cannot overflow the atomic aggregate reservation", () => {
  const assets = releaseAssets.slice(0, 2).map(a => ({ ...a, estimatedBytes: Number.MAX_SAFE_INTEGER }));
  assert.throws(() => resolve(manifestFor(assets), target, () => true), /aggregate body reservation/);
});

test("revoked consent holds the shared twenty-origin cleanup boundary across immediate re-enablement", { timeout: 2000 }, async () => {
  const cancels = []; let starts = 0;
  const requestAsset = make({ allowedAssetUrls: releaseAssets.map(a => a.url), fetchImpl: async () => {
    starts++;
    return starts <= 2
      ? new Response(new ReadableStream({ cancel() { return new Promise(resolve => cancels.push(resolve)); } }))
      : new Response("a");
  } });
  const f = loaderFixture({ requestAsset });
  try {
    const old = f.prepare(); await tick(); assert.equal(starts, 2);
    f.loader.setEnabled(false); f.loader.setEnabled(true);
    const next = f.prepare(); assert.equal((await old).status, "CANCELLED"); await tick();
    assert.equal(starts, 2); assert.equal(f.loader.snapshot().reservedBodyBytes, 12);
    assert.equal(f.loader.snapshot().completedObjects, 0);
    cancels[0](); await tick(); assert.equal(starts, 2);
    cancels[1](); assert.equal((await next).status, "REQUESTS_COMPLETE");
    assert.equal(starts, 14); assert.equal(f.loader.snapshot().reservedBodyBytes, 24);
    assert.equal(f.loader.snapshot().completedObjects, 12);
  } finally { cancels.forEach(resolve => resolve()); f.loader.dispose(); }
});

// Arbitrary hashes below are TEST FIXTURES, not assertions about the private archive.
function empireConfig() {
  const archiveSha256 = "a".repeat(64);
  const build = `empire-${archiveSha256.slice(0, 16)}`;
  return { lobbyOrigin: "http://127.0.0.1:18099", mode: "PROVIDER_EARLY_ASSETS", archiveSha256,
    build, locale: "en", tier: "1x", byteBudget: 10485760,
    entries: origins.map((origin, i) => ({ id: `title-${String(i + 1).padStart(2, "0")}`, origin,
      assets: EARLY_ASSETS.map(([path, stage, estimatedBytes], j) => ({ url: `${origin}/${path}`,
        stage, estimatedBytes, sha256: j.toString(16).padStart(64, "0"), releaseBuild: build })) })) };
}

test("actual Empire adapter binds every approved path across 20 origins to the exact instance/release mapping", async () => {
  const config = empireConfig();
  const source = createEmpireSource(config, { lobbyOrigin: config.lobbyOrigin });
  const request = createSandboxCatalogueRequester({ origins: source.origins, allowedAssetUrls: source.allowedAssetUrls,
    fetchImpl: () => { throw new Error("no network in identity validation"); } });
  assert.equal(source.allowedAssetUrls.length, 20 * EARLY_ASSETS.length);
  // The adapter must have snapshotted configuration, not trust later mutation.
  config.entries[0].assets[0].sha256 = "f".repeat(64);
  config.entries[0].assets[0].url += "?v=forged";
  for (const [index, entry] of source.catalogue.entries()) {
    const identity = { id: entry.id, build: source.catalogue[0].build, locale: "en", tier: "1x" };
    const manifest = await source.manifestSource.resolve(identity);
    const validators = { validateUrl: request.validateUrl, validateReleaseAsset: source.manifestSource.validateReleaseAsset };
    const plan = resolvePreparationIdentity(manifest, identity, validators);
    assert.equal(plan.assets.length, EARLY_ASSETS.length);
    assert.deepEqual(plan.assets.map(a => a.url), EARLY_ASSETS.map(([path]) => `${origins[index]}/${path}`));
    assert.equal(plan.assets.some(a => a.stage === "SECONDARY" || a.stage === "PRIMARY"), false);
    const other = source.catalogue[(index + 1) % 20].locales.en.tiers["1x"].assets[0];
    // Being approved for another instance does not approve this title's release.
    const forged = structuredClone(manifest); forged.locales.en.tiers["1x"].assets[0] = other;
    assert.throws(() => resolvePreparationIdentity(forged, identity, validators), /trusted release/);
    for (const patch of [{ sha256: "f".repeat(64) }, { releaseBuild: "other" }, { estimatedBytes: 1 },
      { stage: "PRIMARY", critical: true }, { url: `${plan.assets[0].url}?v=1`, version: "1" }]) {
      const tampered = structuredClone(manifest);
      Object.assign(tampered.locales.en.tiers["1x"].assets[0], patch);
      assert.throws(() => resolvePreparationIdentity(tampered, identity, validators), /trusted release/);
    }
  }
});
