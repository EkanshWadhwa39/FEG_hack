#!/usr/bin/env node
/**
 * Test whether the lobby's CORS+drain warm creates cache entries
 * reusable by the game iframe's <script type="module" crossorigin> loads.
 *
 * Uses the RUNNING sandbox server on ports 8090/8091.
 * Emits a concise pass/fail verdict.
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const LOBBY_ORIGIN = "http://127.0.0.1:8090";
const GAME_ORIGIN  = "http://127.0.0.1:8091";
const ASSET_FILE   = "assets/vendor-pixi-C8WzrnZv.js";  // 1.29 MB

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page    = await context.newPage();

  // Use a unique slot so no previous cache exists
  const slotTag = `test_${Date.now()}`;
  const assetUrl = `${GAME_ORIGIN}/game/${slotTag}/${ASSET_FILE}`;

  // Navigate to lobby (just need a page context to run fetch from)
  await page.goto(`${LOBBY_ORIGIN}/lobby.html`, { waitUntil: "domcontentloaded" });

  // ── Phase 1: Warm one asset (CORS + drain) from the lobby context ──
  console.log(`\nPhase 1: Warming ${assetUrl}`);
  const warmResult = await page.evaluate(async (url) => {
    const t0 = performance.now();
    const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "default" });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    // Drain body
    if (res.body) {
      if (typeof WritableStream !== "undefined") {
        await res.body.pipeTo(new WritableStream());
      } else {
        const reader = res.body.getReader();
        try { for (;;) { const { done } = await reader.read(); if (done) break; } }
        finally { reader.releaseLock?.(); }
      }
    }
    const elapsed = Math.round(performance.now() - t0);
    return { ok: true, elapsed, type: res.type };
  }, assetUrl);
  console.log("  Warm result:", warmResult);

  // ── Phase 2: Fetch the SAME asset again from the SAME page (fetch→fetch test) ──
  console.log("\nPhase 2: Re-fetch same URL from lobby context (should be cache hit)");
  const refetchResult = await page.evaluate(async (url) => {
    const t0 = performance.now();
    const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "default" });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buf = await res.arrayBuffer();
    const elapsed = Math.round(performance.now() - t0);
    // Check Resource Timing
    const entry = performance.getEntriesByName(url).at(-1);
    return {
      elapsed,
      bodyBytes: buf.byteLength,
      transferSize: entry?.transferSize ?? "N/A",
      type: res.type,
    };
  }, assetUrl);
  console.log("  Re-fetch result:", refetchResult);

  // ── Phase 3: Create iframe at game origin, check if asset loads from cache ──
  console.log("\nPhase 3: Creating game iframe and checking asset cache status");

  // Set up CDP to monitor network requests inside the iframe
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");

  const iframeRequests = [];
  const requestsById = new Map();

  cdp.on("Network.requestWillBeSent", (event) => {
    if (event.request.url.includes(ASSET_FILE)) {
      const req = { url: event.request.url, frameId: event.frameId, fromCache: false, transferSize: null };
      requestsById.set(event.requestId, req);
      iframeRequests.push(req);
    }
  });
  cdp.on("Network.requestServedFromCache", (event) => {
    const req = requestsById.get(event.requestId);
    if (req) req.fromCache = true;
  });
  cdp.on("Network.loadingFinished", (event) => {
    const req = requestsById.get(event.requestId);
    if (req) req.transferSize = event.encodedDataLength;
  });

  // Create the iframe
  const iframeUrl = `${GAME_ORIGIN}/game/${slotTag}/`;
  await page.evaluate((src) => {
    const frame = document.createElement("iframe");
    frame.src = src;
    frame.width = "800";
    frame.height = "600";
    document.body.appendChild(frame);
  }, iframeUrl);

  // Wait for the game to start loading (give it time to request vendor-pixi)
  await page.waitForTimeout(5000);

  console.log(`\n${"=".repeat(60)}`);
  console.log("RESULTS");
  console.log("=".repeat(60));
  console.log(`Asset URL: ${assetUrl}`);
  console.log(`Warm: ${warmResult.ok ? "OK" : "FAILED"} (${warmResult.elapsed}ms, type=${warmResult.type})`);
  console.log(`Re-fetch from lobby: transferSize=${refetchResult.transferSize}, elapsed=${refetchResult.elapsed}ms`);
  console.log(`\nIframe requests for ${ASSET_FILE}:`);

  if (iframeRequests.length === 0) {
    console.log("  ⚠ NO iframe requests for this asset detected!");
    console.log("  This could mean the game HTML didn't load or the asset name differs.");
  }

  for (const req of iframeRequests) {
    const cacheStatus = req.fromCache ? "CACHE HIT ✓" : `NETWORK (${req.transferSize} bytes)`;
    console.log(`  ${cacheStatus} — frame=${req.frameId}`);
  }

  const iframeCacheHit = iframeRequests.some(r => r.fromCache || r.transferSize === 0);
  console.log(`\n${iframeCacheHit ? "✓ PASS: iframe reused warm cache" : "✗ FAIL: iframe did NOT reuse warm cache"}`);

  await browser.close();
  process.exit(iframeCacheHit ? 0 : 1);
}

run().catch(err => {
  console.error("Test failed:", err.message);
  process.exit(1);
});
