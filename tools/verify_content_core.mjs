#!/usr/bin/env node
// Serial browser verification and controlled asset-body milestone, NEVER game readiness.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import assert from "node:assert/strict";

if (process.argv.includes("--help")) {
  console.log("Usage: node tools/verify_content_core.mjs [--runs 3] [--out evidence/derived/content-core.json]\nSerial isolated Chromium, original synthetic content only; raw HARs ignored in evidence/private/content-core.");
  process.exit(0);
}
const arg = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const runs = Number(arg("--runs", "3"));
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error("invalid bounded run count");
const out = arg("--out", "evidence/derived/content-core.json");
const experimentId = new Date().toISOString().replace(/[:.]/g, "-");
const privateDir = `evidence/private/content-core/${experimentId}`;
await mkdir(privateDir, { recursive: true });
await mkdir("evidence/derived", { recursive: true });
const server = spawn(".venv/bin/python", ["tools/content_server.py", "--port", "0", "--missing-thumbnail", "title-07"], { stdio: ["ignore", "pipe", "pipe"] });
let browser;
async function waitFor(page, predicate, arg) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, arg)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Browser condition timed out");
}
const variant = { build: "synthetic-v1", locale: "hr-HR", tier: "1x" };
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("content server startup timeout")), 10000);
    server.once("exit", () => { clearTimeout(timer); reject(new Error("content server exited")); });
    createInterface({ input: server.stdout }).once("line", line => {
      clearTimeout(timer); try { resolve(JSON.parse(line).port); } catch { reject(new Error("invalid server readiness")); }
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const serverMetrics = async () => (await fetch(`${origin}/__metrics`)).json();
  const assetRequests = m => ["preloader", "common", "splash"].reduce((sum, key) => sum + m.by_type[key].requests, 0);
  async function boot(harName) {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 720 },
      recordHar: { path: `${privateDir}/${harName}.har`, content: "omit", mode: "full" } });
    const page = await context.newPage();
    await page.goto(`${origin}/health`);
    await page.evaluate(async ({ origin, variant }) => {
      const { createSyntheticCatalogue } = await import("/src/catalogue.js");
      const { createPopularityPrior, createSyntheticSession } = await import("/src/candidate-policy.js");
      const { createSyntheticManifestSource, createSyntheticAuthorization } = await import("/src/content-adapters.js");
      const { createSandboxBrowserRequester } = await import("/src/browser-requester.js");
      const { createContentLoader } = await import("/src/content-loader.js");
      const { bindContentLoading } = await import("/src/content-integration.js");
      const { bindThumbnailFallback } = await import("/src/catalogue-bindings.js");
      const catalogue = createSyntheticCatalogue({ origin });
      const session = createSyntheticSession({ catalogue });
      const authorization = createSyntheticAuthorization("GRANTED");
      // Controlled fixture values, NOT a claim about navigator capability/real authorization.
      const environment = { read: () => ({ saveData: false, effectiveType: "4g", visibilityState: document.visibilityState }) };
      const loader = createContentLoader({ catalogue, session, prior: createPopularityPrior(),
        manifestSource: createSyntheticManifestSource(catalogue), requestAsset: createSandboxBrowserRequester({ origin }),
        authorization, environment, policy: "POPULAR_UNPLAYED", byteBudget: 3_000_000 });
      loader.setEnabled(true);
      document.body.replaceChildren();
      const root = document.createElement("div"); root.id = "test-catalogue"; document.body.append(root);
      const thumbnails = [];
      for (const entry of catalogue) {
        const button = document.createElement("button"); button.dataset.gameId = entry.id; button.textContent = entry.title;
        const image = document.createElement("img"); image.width = 64; image.height = 48;
        const fallback = document.createElement("span"); fallback.hidden = true; fallback.textContent = "SIMULATED thumbnail unavailable";
        button.append(image, fallback); root.append(button);
        bindThumbnailFallback({ image, fallback }); image.src = entry.thumbnailUrl;
        thumbnails.push({ image, fallback });
      }
      const state = { catalogue, session, authorization, loader, root, thumbnails, variant, lastLaunch: null, events: [], clickAt: null };
      root.addEventListener("click", () => { state.clickAt = performance.now(); }, true);
      state.binding = bindContentLoading({ root, catalogue, loader, readVariant: () => variant,
        onLaunch: grant => { state.lastLaunch = grant; }, onOperatorEvent: event => state.events.push(event) });
      window.contentTest = state;
    }, { origin, variant });
    return { page, context };
  }
  async function close(context) { await context.close(); await browser.close(); browser = undefined; }
  const verification = {};
  {
    const { page, context } = await boot("catalogue-verification");
    await waitFor(page, () => contentTest.thumbnails.every(({ image, fallback }) => image.complete && (image.naturalWidth > 0 || (!fallback.hidden && image.hidden))));
    verification.thumbnails = await page.evaluate(() => ({ total: contentTest.thumbnails.length,
      loaded: contentTest.thumbnails.filter(({ image }) => image.naturalWidth > 0).length,
      isolatedFallbacks: contentTest.thumbnails.filter(({ fallback }) => !fallback.hidden).length }));
    assert.deepEqual(verification.thumbnails, { total: 20, loaded: 19, isolatedFallbacks: 1 });
    const beforeOrder = await page.locator("[data-game-id]").evaluateAll(nodes => nodes.map(n => n.dataset.gameId));
    for (const gameId of beforeOrder) {
      await page.evaluate(() => { contentTest.loader.resumeBrowsing(); contentTest.lastLaunch = null; contentTest.events = []; });
      await page.locator(`[data-game-id="${gameId}"]`).hover();
      await waitFor(page, () => contentTest.events.some(e => e.status === "REQUESTS_COMPLETE"));
      await page.locator(`[data-game-id="${gameId}"]`).click();
      await waitFor(page, id => contentTest.lastLaunch?.plan.id === id, gameId);
    }
    verification.allTwentyPrepareAndAuthorizeClick = true;
    verification.preparation = await page.evaluate(() => contentTest.loader.snapshot());
    await page.evaluate(() => { contentTest.loader.setPolicy("FAVOURITE"); contentTest.loader.setPolicy("POPULAR_UNPLAYED"); });
    assert.deepEqual(await page.locator("[data-game-id]").evaluateAll(nodes => nodes.map(n => n.dataset.gameId)), beforeOrder);
    verification.policyDoesNotReorderDOM = true;
    const beforeDeny = assetRequests(await serverMetrics());
    await page.evaluate(() => { contentTest.loader.resumeBrowsing(); contentTest.authorization.setState("DENIED"); contentTest.lastLaunch = null; contentTest.events = []; });
    await page.locator('[data-game-id="title-07"]').click();
    await waitFor(page, () => contentTest.events.some(e => e.status === "AUTHORIZATION_BLOCKED"));
    assert.equal(await page.evaluate(() => contentTest.lastLaunch), null);
    assert.equal(assetRequests(await serverMetrics()), beforeDeny);
    verification.denialBlocksLaunchAndSpeculation = true;
    await close(context);
  }

  const results = [];
  let browserVersion;
  for (let run = 1; run <= runs; run++) {
    // Alternate which arm is first while never sharing a browser/profile between arms.
    for (const arm of run % 2 ? ["CONTROL", "TREATMENT"] : ["TREATMENT", "CONTROL"]) {
      const { page, context } = await boot(`${arm.toLowerCase()}-${run}`);
      browserVersion = browser.version();
      const initial = assetRequests(await serverMetrics());
      await page.evaluate(arm => contentTest.loader.setPolicy(arm === "CONTROL" ? "OFF" : "POPULAR_UNPLAYED"), arm);
      const browseStart = await page.evaluate(() => performance.now());
      await page.locator('[data-game-id="title-01"]').hover();
      await waitFor(page, start => performance.now() - start >= 1000, browseStart);
      if (arm === "TREATMENT") assert.equal(await page.evaluate(() => contentTest.loader.snapshot().completedObjects), 3, "treatment must complete within common browsing window");
      const afterWarm = assetRequests(await serverMetrics());
      const snapshot = await page.evaluate(() => contentTest.loader.snapshot());
      await page.locator('[data-game-id="title-01"]').click();
      await waitFor(page, () => contentTest.lastLaunch?.status === "LAUNCH_AUTHORIZED");
      const urls = await page.evaluate(() => contentTest.lastLaunch.plan.assets.map(a => a.url));
      await page.evaluate(() => { const iframe = document.createElement("iframe"); iframe.id = "asset-frame"; iframe.src = "/health"; document.body.append(iframe); });
      await waitFor(page, () => document.querySelector("iframe")?.contentWindow?.location.href.endsWith("/health") && document.querySelector("iframe")?.contentDocument?.readyState === "complete");
      const frame = page.frames().find(f => f !== page.mainFrame());
      const milestone = await frame.evaluate(async urls => {
        const start = performance.now();
        const sizes = await Promise.all(urls.map(async url => {
          const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "default", redirect: "error", referrerPolicy: "no-referrer" });
          if (!response.ok) throw new Error("foreground fixture failed");
          return (await response.arrayBuffer()).byteLength;
        }));
        return { bodyFetchIntervalMs: performance.now() - start, bodyBytes: sizes.reduce((a, b) => a + b, 0),
          resources: performance.getEntriesByType("resource").filter(e => urls.includes(e.name)).map(e => ({ transferSize: e.transferSize, encodedBodySize: e.encodedBodySize })) };
      }, urls);
      const clickToBodiesCompleteMs = await page.evaluate(() => performance.now() - contentTest.clickAt);
      const afterLaunch = assetRequests(await serverMetrics());
      const launchServerRequests = afterLaunch - afterWarm;
      assert.equal(launchServerRequests, arm === "TREATMENT" ? 0 : 3);
      assert.equal(afterWarm - initial, arm === "TREATMENT" ? 3 : 0);
      assert.equal(milestone.bodyBytes, 114688);
      assert.equal(milestone.resources.length, 3);
      assert.ok(milestone.resources.every(r => arm === "TREATMENT" ? r.transferSize === 0 && r.encodedBodySize > 0 : r.transferSize > 0));
      results.push({ label: "MEASURED", run, arm, title: "title-01", build: variant.build, locale: variant.locale, tier: variant.tier,
        preparationServerRequests: afterWarm - initial, preparationReservedBodyBytes: snapshot.reservedBodyBytes,
        launchServerRequests, totalSessionAssetServerRequests: afterLaunch - initial, clickToBodiesCompleteMs,
        ...milestone, authoritativeInputAcceptedMs: null });
      await close(context);
    }
  }
  // Exact-key and no-store negative controls, in a separate clean process.
  const { page, context } = await boot("negative-controls");
  const negative = await page.evaluate(async ({ origin, variant }) => {
    const { createSandboxBrowserRequester } = await import("/src/browser-requester.js");
    const request = createSandboxBrowserRequester({ origin });
    const normal = `${origin}/synthetic/title-01/${variant.build}/${variant.locale}/${variant.tier}/preloader.bin?v=1`;
    const wrongKey = normal.replace("title-01", "title-02");
    await request(normal, { estimatedBytes: 16384 });
    await request(wrongKey, { estimatedBytes: 16384 });
    for (let i = 0; i < 2; i++) await request(`${origin}/__test/no-store`, { estimatedBytes: 4096 });
    let redirectRejected = false;
    try { await request(`${origin}/__test/redirect`, { estimatedBytes: 4096 }); } catch { redirectRejected = true; }
    const entries = performance.getEntriesByType("resource");
    const noStore = entries.filter(e => e.name.endsWith("/__test/no-store"));
    return { exactDifferentTitleMiss: entries.find(e => e.name === wrongKey)?.transferSize > 0,
      noStoreRepeatedTransfers: noStore.length === 2 && noStore.every(e => e.transferSize > 0), redirectRejected };
  }, { origin, variant });
  assert.deepEqual(negative, { exactDifferentTitleMiss: true, noStoreRepeatedTransfers: true, redirectRejected: true });
  await close(context);
  const report = { label: "MEASURED", experimentId, workloadLabel: "SIMULATED", scope: { browser: browserVersion, runsPerArm: runs,
    benchmarkTitles: 1, catalogueVerificationTitles: 20, providerGamesBenchmarked: 0, originTopology: "same-loopback-origin parent and iframe",
    serviceWorkers: "blocked", routing: "not installed", throttle: "none", browseIntervalMs: 1000 },
    milestone: "click event to original synthetic iframe asset bodies consumed (includes runner orchestration); NOT interactive or provider gameplay",
    conditions: ["Fresh browser process/context per arm, cache enabled; only policy preparation differs", "Static original generated fixture bytes, immutable exact URLs", "SIMULATED authorization, fast-network governor inputs and catalogue", "No store/redirect and distinct-title exact-key negative controls", "Reserved/readable body bytes are not wire bytes; no game CPU/readiness claim", "Raw HARs stay ignored; this report contains only safe aggregates"],
    verification, negativeControls: negative, results };
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: "PASS", output: out, runsPerArm: runs, verification, negativeControls: negative }, null, 2));
} finally {
  await browser?.close(); server.kill("SIGTERM");
}
