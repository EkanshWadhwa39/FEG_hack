import test from "node:test";
import assert from "node:assert/strict";
import { createContentLoader } from "../src/content-loader.js";
import { createSyntheticAuthorization, createSyntheticManifestSource, createBrowserEnvironment } from "../src/content-adapters.js";
import { createSyntheticCatalogue } from "../src/catalogue.js";
import { createSyntheticSession, createPopularityPrior } from "../src/candidate-policy.js";
import { createSandboxBrowserRequester } from "../src/browser-requester.js";
const origin = "http://127.0.0.1:8092";
const variant = { build: "synthetic-v1", locale: "hr-HR", tier: "1x" };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(overrides = {}) {
  const catalogue = createSyntheticCatalogue({ origin });
  const session = createSyntheticSession({ catalogue });
  const authorization = createSyntheticAuthorization("GRANTED");
  let env = { saveData: false, effectiveType: "4g", visibilityState: "visible" };
  const listeners = new Set();
  const environment = { read: () => env, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  const urls = [];
  const requestAsset = createSandboxBrowserRequester({ origin, fetchImpl: async url => { urls.push(url); return new Response(new Uint8Array(4)); } });
  const options = { catalogue, session, prior: createPopularityPrior(), authorization, environment,
    manifestSource: createSyntheticManifestSource(catalogue), requestAsset, byteBudget: 10_000_000,
    policy: "POPULAR_UNPLAYED", ...overrides };
  const loader = createContentLoader(options); loader.setEnabled(true);
  return { ...options, loader, urls, setEnvironment(patch) { env = { ...env, ...patch }; for (const fn of listeners) fn(); } };
}
function prepare(loader, id, patch = {}) { return loader.prepare({ ...variant, intent: { gameId: id, kind: "HOVER_DWELL" }, ...patch }); }

test("every one of 20 entries resolves before requesting; duplicate preparation is metadata-deduped", async () => {
  const f = setup();
  for (const item of f.catalogue) {
    const start = f.urls.length;
    const result = await prepare(f.loader, item.id);
    assert.equal(result.status, "REQUESTS_COMPLETE", item.id);
    assert.equal(result.cacheReuse, "UNKNOWN");
    assert.equal(f.urls.length - start, 3);
    assert.ok(f.urls.slice(start).every(url => url.includes(`/${item.id}/${variant.build}/${variant.locale}/${variant.tier}/`)));
    assert.equal((await prepare(f.loader, item.id)).status, "ALREADY_REQUESTED");
  }
  assert.equal(new Set(f.urls).size, 60);
  assert.equal(f.loader.snapshot().observedBodyBytes, 240);
  assert.equal(f.loader.snapshot().completedObjects, 60);
});

test("all 20 entries fail closed on missing locale, tier, build or exact version", async () => {
  const f = setup();
  for (const item of f.catalogue) {
    for (const key of ["locale", "tier", "build"]) {
      assert.equal((await prepare(f.loader, item.id, { [key]: undefined })).status, "IDENTITY_UNRESOLVED");
    }
    assert.equal((await prepare(f.loader, item.id, { locale: "unresolved" })).status, "IDENTITY_UNRESOLVED");
    assert.equal((await prepare(f.loader, item.id, { build: "wrong" })).status, "IDENTITY_UNRESOLVED");
  }
  assert.equal(f.urls.length, 0); assert.equal(f.loader.snapshot().reservedBodyBytes, 0);
});

test("malformed/denied/error/timed-out authorization never accesses manifest or sends requests", async () => {
  for (const state of ["DENIED", "UNKNOWN", undefined, { state: "GRANTED" }, "TIMEOUT", "ERROR"]) {
    const authorization = { subscribe: () => () => {}, isGranted: () => state === "GRANTED", check: async () => {
      if (state === "ERROR") throw new Error("private payload");
      if (state === "TIMEOUT") return new Promise(() => {});
      return state;
    } };
    const f = setup({ authorization, operationTimeoutMs: 5,
      manifestSource: { resolve() { throw new Error("must not read manifest"); } } });
    assert.equal((await prepare(f.loader, "title-01")).status, "AUTHORIZATION_BLOCKED");
    assert.equal((await f.loader.beginLaunch({ ...variant, gameId: "title-01" })).status, "AUTHORIZATION_BLOCKED");
    assert.equal(f.urls.length, 0);
  }
});

test("all governor bounds remain effective and launch is independent of preparation opt-out", async () => {
  for (const patch of [{ saveData: true }, { effectiveType: "3g" }, { effectiveType: undefined },
    { visibilityState: "hidden" }, { visibilityState: undefined }, { performanceBusy: true }]) {
    const f = setup(); f.setEnvironment(patch);
    assert.equal((await prepare(f.loader, "title-01")).status, "GOVERNOR_BLOCKED"); assert.equal(f.urls.length, 0);
  }
  const f = setup({ byteBudget: 1 });
  assert.equal((await prepare(f.loader, "title-01")).reason, "BUDGET_EXCEEDED");
  f.loader.setEnabled(false);
  assert.equal((await prepare(f.loader, "title-01")).reason, "DISABLED");
  assert.equal((await f.loader.beginLaunch({ ...variant, gameId: "title-01" })).status, "LAUNCH_AUTHORIZED");
  assert.equal(f.urls.length, 0);
});

test("policy toggle selects favourite vs most popular unplayed without changing catalogue", async () => {
  const f = setup(); const before = JSON.stringify(f.catalogue);
  f.session.recordPlayed("title-08"); f.session.recordPlayed("title-08");
  f.loader.setPolicy("FAVOURITE");
  const favourite = await f.loader.prepare(variant);
  assert.equal(favourite.candidate.gameId, "title-08");
  f.loader.setPolicy("POPULAR_UNPLAYED");
  const popular = await f.loader.prepare(variant);
  assert.equal(popular.candidate.gameId, "title-01");
  assert.equal(JSON.stringify(f.catalogue), before);
  f.loader.setPolicy("OFF"); assert.equal((await prepare(f.loader, "title-20")).status, "NO_CANDIDATE");
});

test("live revocation/disablement/hidden state cancels active work, no third request starts", async () => {
  for (const reason of ["deny", "disable", "hidden", "saveData"]) {
    const bodies = []; let starts = 0;
    const requestAsset = createSandboxBrowserRequester({ origin, fetchImpl: async (_url, { signal }) => {
      starts++;
      return new Response(new ReadableStream({ start(c) {
        bodies.push(c); signal.addEventListener("abort", () => c.error(new Error("aborted")), { once: true });
      } }));
    } });
    const f = setup({ requestAsset });
    const run = prepare(f.loader, "title-01"); await tick();
    assert.equal(starts, 2);
    if (reason === "deny") f.authorization.setState("DENIED");
    if (reason === "disable") f.loader.setEnabled(false);
    if (reason === "hidden") f.setEnvironment({ visibilityState: "hidden" });
    if (reason === "saveData") f.setEnvironment({ saveData: true });
    assert.equal((await run).status, "CANCELLED");
    assert.equal(starts, 2);
    assert.equal(f.loader.snapshot().reservedBodyBytes, 114688);
    assert.equal(f.loader.snapshot().completedObjects, 0);
  }
});

test("replacement aborts old candidate; late manifest response cannot trigger requests", async () => {
  const f = setup(); let release;
  const manifestSource = { async resolve(target) {
    if (target.id === "title-01") await new Promise(r => { release = r; });
    return f.catalogue.find(e => e.id === target.id);
  } };
  const g = setup({ manifestSource });
  const old = prepare(g.loader, "title-01"); await tick();
  const replacement = prepare(g.loader, "title-02");
  assert.equal((await replacement).status, "REQUESTS_COMPLETE");
  release(); assert.equal((await old).status, "CANCELLED");
  assert.ok(g.urls.every(url => url.includes("/title-02/")));
});

test("retains reservations after failures; cannot recycle failed-download budget", async () => {
  const requestAsset = createSandboxBrowserRequester({ origin, fetchImpl: async () => { throw new Error("offline"); } });
  const f = setup({ requestAsset, byteBudget: 114688 });
  assert.equal((await prepare(f.loader, "title-01")).status, "PARTIAL_FAILURE");
  assert.equal(f.loader.snapshot().reservedBodyBytes, 114688);
  assert.equal((await prepare(f.loader, "title-02")).reason, "BUDGET_EXCEEDED");
});

test("click grants exact foreground launch only after fresh authorization, and stops speculation", async () => {
  const f = setup();
  const launch = await f.loader.beginLaunch({ ...variant, gameId: "title-20" });
  assert.equal(launch.status, "LAUNCH_AUTHORIZED"); assert.equal(launch.candidate.reason, "CLICK");
  assert.equal(launch.plan.id, "title-20"); assert.equal(f.urls.length, 0);
  assert.equal((await prepare(f.loader, "title-01")).status, "DISABLED");
  f.loader.resumeBrowsing();
  f.authorization.setState("DENIED");
  assert.equal((await f.loader.beginLaunch({ ...variant, gameId: "title-20" })).status, "AUTHORIZATION_BLOCKED");
});

test("browser adapter missing capabilities is conservative and live events propagate", () => {
  const documentImpl = new EventTarget(); documentImpl.visibilityState = "visible";
  const connection = new EventTarget(); connection.saveData = false; connection.effectiveType = "4g";
  let n = 0;
  const env = createBrowserEnvironment({ documentImpl, navigatorImpl: { connection }, PerformanceObserverImpl: null });
  env.subscribe(() => n++);
  connection.saveData = true; connection.dispatchEvent(new Event("change"));
  documentImpl.visibilityState = "hidden"; documentImpl.dispatchEvent(new Event("visibilitychange"));
  assert.equal(n, 2); assert.equal(env.read().saveData, true); assert.equal(env.read().visibilityState, "hidden");
  env.dispose(); connection.dispatchEvent(new Event("change")); assert.equal(n, 2);
  const missing = createBrowserEnvironment({ documentImpl, navigatorImpl: {}, PerformanceObserverImpl: null });
  assert.equal(missing.read().effectiveType, undefined); missing.dispose();
});

test("all twenty versionless manifests and any disallowed origin reject atomically", async () => {
  const catalogue = createSyntheticCatalogue({ origin });
  const manifestSource = { async resolve({ id }) {
    const entry = structuredClone(catalogue.find(item => item.id === id));
    entry.locales["hr-HR"].tiers["1x"].assets[2].version = undefined;
    return entry;
  } };
  const f = setup({ manifestSource });
  for (const { id } of catalogue) assert.equal((await prepare(f.loader, id)).status, "IDENTITY_UNRESOLVED");
  assert.equal(f.urls.length, 0);
  const evil = setup({ manifestSource: { async resolve({ id }) {
    const entry = structuredClone(catalogue.find(item => item.id === id));
    entry.locales["hr-HR"].tiers["1x"].assets[2].url = "https://not-approved.test/a?v=1";
    return entry;
  } } });
  assert.equal((await prepare(evil.loader, "title-01")).status, "IDENTITY_UNRESOLVED");
  assert.equal(evil.urls.length, 0);
});

test("candidate replacement retains global two-slot limit until aborted fetches settle", async () => {
  const resolvers = []; let calls = 0;
  const requestAsset = createSandboxBrowserRequester({ origin, fetchImpl: async () => {
    calls++;
    if (calls <= 2) return new Promise(resolve => resolvers.push(resolve));
    return new Response("a");
  } });
  const f = setup({ requestAsset });
  const first = prepare(f.loader, "title-01"); await tick(); assert.equal(calls, 2);
  const duplicate = prepare(f.loader, "title-01"); assert.equal(first, duplicate);
  const second = prepare(f.loader, "title-02"); await tick();
  assert.equal(calls, 2, "header-incomplete old requests still own both slots");
  assert.equal((await first).status, "CANCELLED");
  for (const resolve of resolvers) resolve(new Response("a"));
  assert.equal((await second).status, "REQUESTS_COMPLETE"); assert.equal(calls, 5);
});

test("body-overrun accounting halts the session and disposal blocks further work", async () => {
  const requestAsset = createSandboxBrowserRequester({ origin, fetchImpl: async () => new Response(new Uint8Array(200000)) });
  const f = setup({ requestAsset });
  assert.equal((await prepare(f.loader, "title-01")).status, "CANCELLED");
  assert.equal(f.loader.snapshot().bodyBoundExceeded, true);
  assert.ok(f.loader.snapshot().observedBodyBytes >= 200000);
  assert.equal((await prepare(f.loader, "title-02")).reason, "BODY_BOUND_EXCEEDED");
  f.loader.dispose(); assert.equal((await prepare(f.loader, "title-01")).status, "DISABLED");
  assert.equal((await f.loader.beginLaunch({ ...variant, gameId: "title-01" })).status, "LAUNCH_BLOCKED");
});

test("launch grants carry a live revocation signal; throwing authorization remains fail closed", async () => {
  const f = setup();
  const grant = await f.loader.beginLaunch({ ...variant, gameId: "title-01" });
  assert.equal(grant.signal.aborted, false);
  f.authorization.setState("DENIED"); assert.equal(grant.signal.aborted, true);
  const g = setup({ authorization: { subscribe: () => () => {}, async check() { return "GRANTED"; }, isGranted() { throw new Error("private diagnostic"); } } });
  assert.equal((await prepare(g.loader, "title-01")).status, "AUTHORIZATION_BLOCKED");
  assert.equal(g.urls.length, 0);
});

test("authorization adapters must expose live revocation and explicit cancel aborts delayed grants", async () => {
  assert.throws(() => setup({ authorization: { check: async () => "GRANTED", isGranted: () => true } }), /adapters/);
  assert.throws(() => setup({ authorization: { check: async () => "GRANTED", isGranted: () => true, subscribe() {} } }), /subscription/);
  let resolve;
  const f = setup({ authorization: { check: () => new Promise(r => { resolve = r; }), isGranted: () => true, subscribe: () => () => {} } });
  const pending = f.loader.beginLaunch({ ...variant, gameId: "title-01" }); await tick();
  f.loader.cancelLaunch(); resolve("GRANTED");
  assert.equal((await pending).status, "AUTHORIZATION_BLOCKED"); assert.equal(f.urls.length, 0);
});

test('explicit policy queue candidates keep exact identity and cannot bypass off, authorization or consent', async () => {
  const f = setup();
  const chosen = await f.loader.prepare({ ...variant, candidateId: 'title-17' });
  assert.equal(chosen.status, 'REQUESTS_COMPLETE'); assert.equal(chosen.candidate.reason, 'POLICY_QUEUE');
  assert.ok(f.urls.every(url => url.includes('/title-17/')));
  const count = f.urls.length;
  assert.equal((await f.loader.prepare({ ...variant, candidateId: 'unknown' })).status, 'NO_CANDIDATE');
  f.loader.setPolicy('OFF'); assert.equal((await f.loader.prepare({ ...variant, candidateId: 'title-18' })).status, 'NO_CANDIDATE');
  f.loader.setPolicy('POPULAR_UNPLAYED'); f.authorization.setState('DENIED');
  assert.equal((await f.loader.prepare({ ...variant, candidateId: 'title-18' })).status, 'AUTHORIZATION_BLOCKED');
  f.authorization.setState('GRANTED'); f.loader.setEnabled(false);
  assert.equal((await f.loader.prepare({ ...variant, candidateId: 'title-18' })).reason, 'DISABLED');
  assert.equal(f.urls.length, count);
});

test('replacement preparation drains non-cooperative old workers: global concurrency stays at two', async () => {
  let active = 0; let peak = 0; const release = []; const urls = [];
  const requestAsset = async (url, options) => {
    urls.push(url); peak = Math.max(peak, ++active);
    if (url.includes('/title-01/')) await new Promise(resolve => release.push(resolve));
    active--; options.onBytes?.(4); return { completed: true };
  };
  requestAsset.validateUrl = createSandboxBrowserRequester({ origin }).validateUrl;
  const f = setup({ requestAsset });
  const old = prepare(f.loader, 'title-01'); await tick(); assert.equal(active, 2);
  const next = prepare(f.loader, 'title-02'); await tick(); assert.equal(urls.length, 2);
  release.forEach(resolve => resolve());
  assert.equal((await old).status, 'CANCELLED'); assert.equal((await next).status, 'REQUESTS_COMPLETE');
  assert.equal(peak, 2); assert.equal(active, 0); assert.equal(urls.length, 5);
});
