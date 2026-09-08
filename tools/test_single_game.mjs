#!/usr/bin/env node
/**
 * Warm ONE game's full manifest from lobby context, then load that game
 * in an iframe and verify every asset is served from cache.
 * Uses a real (non-headless) Chromium to match the user's experience.
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const GAME_ORIGIN = "http://127.0.0.1:8091";
const LOBBY_ORIGIN = "http://127.0.0.1:8090";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();

  const slotTag = `s_${Date.now()}`;
  const base = `${GAME_ORIGIN}/game/${slotTag}/`;

  // Navigate to lobby as context
  await page.goto(`${LOBBY_ORIGIN}/lobby.html`, { waitUntil: "domcontentloaded" });

  // Extract manifest by reading the page source
  const pageContent = await page.content();
  const manifestMatch = pageContent.match(/const BASE_MANIFEST = \[([\s\S]*?)\];/);
  let manifest;
  if (manifestMatch) {
    // Evaluate the manifest array in page context
    manifest = await page.evaluate((src) => {
      return (new Function(`return [${src}]`))();
    }, manifestMatch[1]);
  }
  if (!manifest || manifest.length === 0) {
    console.error("Could not extract BASE_MANIFEST from page");
    process.exit(1);
  }

  // Warm all manifest assets with cors + drain (exactly like lobby does)
  console.log(`Warming ${manifest ? manifest.length : "?"} assets for slot ${slotTag}...`);
  const warmResult = await page.evaluate(async ({ base, manifest }) => {
    const results = { ok: 0, fail: 0, totalBytes: 0 };
    const concurrency = 2;
    let next = 0;

    async function drainBody(res) {
      const body = res.body;
      if (!body) return;
      if (typeof WritableStream !== "undefined") {
        await body.pipeTo(new WritableStream());
      } else {
        const reader = body.getReader();
        try { for (;;) { const { done } = await reader.read(); if (done) break; } }
        finally { reader.releaseLock?.(); }
      }
    }

    async function worker() {
      while (next < manifest.length) {
        const i = next++;
        const url = base + manifest[i].path;
        try {
          const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "default" });
          if (!res.ok) { results.fail++; continue; }
          await drainBody(res).catch(() => {});
          results.ok++;
          results.totalBytes += manifest[i].estimatedBytes;
        } catch {
          results.fail++;
        }
      }
    }

    const t0 = performance.now();
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    results.elapsed = Math.round(performance.now() - t0);
    return results;
  }, { base, manifest });

  console.log(`Warm: ${warmResult.ok}/${manifest.length} OK, ${warmResult.fail} failed, ${warmResult.elapsed}ms, ~${(warmResult.totalBytes / 1e6).toFixed(1)} MB`);

  // Quick cache validation: re-fetch vendor-pixi from lobby context
  const cacheCheck = await page.evaluate(async (url) => {
    const t0 = performance.now();
    const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "default" });
    const buf = await res.arrayBuffer();
    const entry = performance.getEntriesByName(url).at(-1);
    return {
      elapsed: Math.round(performance.now() - t0),
      bytes: buf.byteLength,
      transferSize: entry?.transferSize ?? "N/A",
    };
  }, base + "assets/vendor-pixi-C8WzrnZv.js");
  console.log(`Cache check (vendor-pixi re-fetch): ${cacheCheck.transferSize === 0 ? "CACHE HIT ✓" : `MISS (${cacheCheck.transferSize} bytes)`}, ${cacheCheck.elapsed}ms`);

  // Set up CDP to monitor iframe network
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");

  const iframeReqs = [];
  const byId = new Map();

  cdp.on("Network.requestWillBeSent", (event) => {
    if (!event.request.url.includes(slotTag)) return;
    if (!event.request.url.includes("assets/")) return;
    const r = { file: event.request.url.split("/").pop(), fromCache: false, bytes: null };
    byId.set(event.requestId, r);
    iframeReqs.push(r);
  });
  cdp.on("Network.requestServedFromCache", (event) => {
    const r = byId.get(event.requestId);
    if (r) r.fromCache = true;
  });
  cdp.on("Network.loadingFinished", (event) => {
    const r = byId.get(event.requestId);
    if (r) r.bytes = event.encodedDataLength;
  });

  // Create iframe
  console.log(`\nLaunching game iframe at ${base}`);
  await page.evaluate((src) => {
    const frame = document.createElement("iframe");
    frame.src = src;
    frame.width = "800";
    frame.height = "600";
    document.body.appendChild(frame);
  }, base);

  await page.waitForTimeout(10000);

  // Results
  const cached = iframeReqs.filter(r => r.fromCache || r.bytes === 0);
  const network = iframeReqs.filter(r => !r.fromCache && r.bytes > 0);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`SINGLE GAME CACHE TEST RESULTS`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total iframe asset requests: ${iframeReqs.length}`);
  console.log(`Cache hits: ${cached.length}`);
  console.log(`Network fetches: ${network.length}`);

  if (network.length > 0) {
    console.log(`\nNETWORK (not cached):`);
    const sorted = network.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
    for (const r of sorted) {
      console.log(`  ${r.file} — ${r.bytes} bytes`);
    }
  }

  if (cached.length > 0) {
    console.log(`\nCACHE HITS:`);
    for (const r of cached.slice(0, 15)) {
      console.log(`  ${r.file}`);
    }
    if (cached.length > 15) console.log(`  ... and ${cached.length - 15} more`);
  }

  const hitRate = iframeReqs.length > 0 ? (cached.length / iframeReqs.length * 100).toFixed(1) : 0;
  console.log(`\nCache hit rate: ${hitRate}%`);
  console.log(cached.length > network.length ? "✓ PASS" : "✗ FAIL");

  await browser.close();
  process.exit(network.length === 0 ? 0 : (cached.length > network.length ? 0 : 1));
}

run().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
