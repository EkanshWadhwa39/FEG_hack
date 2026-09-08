#!/usr/bin/env node
/**
 * Test cache reuse with a persistent browser profile (real disk cache).
 * This matches how a real Chrome user would experience the lobby.
 */
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const GAME_ORIGIN = "http://127.0.0.1:8091";
const LOBBY_ORIGIN = "http://127.0.0.1:8090";

// Minimal manifest: just the JS modules + key visual assets
// This is what the game NEEDS to show something on screen
const CRITICAL_MANIFEST = [
  { path: "assets/vendor-pixi-C8WzrnZv.js", bytes: 1292928 },
  { path: "assets/core-engine-DXW-O-mj.js", bytes: 389215 },
  { path: "assets/index-canvas-_ynnR-4e.js", bytes: 7270 },
  { path: "assets/game-empireofgold-CK6MbOiD.js", bytes: 46080 },
  { path: "assets/images/loader.webp", bytes: 109568 },
  { path: "assets/images/@1x/splashAssets.webp", bytes: 869352 },
  { path: "assets/images/@1x/splashBG.jpg", bytes: 675111 },
];

async function run() {
  // Use a persistent user data dir for real disk cache
  const userDataDir = mkdtempSync(join(tmpdir(), "pw-cache-test-"));
  console.log(`User data dir: ${userDataDir}`);

  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: [
      "--disk-cache-size=104857600", // 100 MB disk cache
    ],
  });
  const page = await browser.newPage();
  const slotTag = `p_${Date.now()}`;
  const base = `${GAME_ORIGIN}/game/${slotTag}/`;

  await page.goto(`${LOBBY_ORIGIN}/lobby.html`, { waitUntil: "domcontentloaded" });

  // Phase 1: Warm critical assets
  console.log(`\nWarming ${CRITICAL_MANIFEST.length} critical assets...`);
  const warmResult = await page.evaluate(async ({ base, manifest }) => {
    const results = { ok: 0, fail: 0 };
    for (const asset of manifest) {
      const url = base + asset.path;
      try {
        const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "default" });
        if (!res.ok) { results.fail++; continue; }
        if (res.body) {
          if (typeof WritableStream !== "undefined") {
            await res.body.pipeTo(new WritableStream());
          } else {
            const reader = res.body.getReader();
            try { for (;;) { const { done } = await reader.read(); if (done) break; } }
            finally { reader.releaseLock?.(); }
          }
        }
        results.ok++;
      } catch (e) {
        results.fail++;
        results.lastError = e.message;
      }
    }
    return results;
  }, { base, manifest: CRITICAL_MANIFEST });
  console.log(`Warm: ${warmResult.ok}/${CRITICAL_MANIFEST.length} OK, ${warmResult.fail} failed`);

  // Phase 2: Verify each asset is cached (re-fetch)
  console.log("\nVerifying cache entries...");
  for (const asset of CRITICAL_MANIFEST) {
    const url = base + asset.path;
    const check = await page.evaluate(async (url) => {
      const t0 = performance.now();
      const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "default" });
      const buf = await res.arrayBuffer();
      const entry = performance.getEntriesByName(url).at(-1);
      return {
        elapsed: Math.round(performance.now() - t0),
        transferSize: entry?.transferSize ?? -1,
        size: buf.byteLength,
      };
    }, url);
    const name = asset.path.split("/").pop();
    const status = check.transferSize === 0 ? "✓ CACHED" : `✗ MISS (${check.transferSize}b, ${check.elapsed}ms)`;
    console.log(`  ${name}: ${status}`);
  }

  // Phase 3: Iframe test
  console.log("\nLaunching game iframe...");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");

  const reqs = new Map();
  cdp.on("Network.requestWillBeSent", (ev) => {
    if (!ev.request.url.includes(slotTag) || !ev.request.url.includes("assets/")) return;
    reqs.set(ev.requestId, { file: ev.request.url.split("/").pop(), cache: false, bytes: null });
  });
  cdp.on("Network.requestServedFromCache", (ev) => {
    const r = reqs.get(ev.requestId);
    if (r) r.cache = true;
  });
  cdp.on("Network.loadingFinished", (ev) => {
    const r = reqs.get(ev.requestId);
    if (r) r.bytes = ev.encodedDataLength;
  });

  await page.evaluate((src) => {
    const f = document.createElement("iframe");
    f.src = src;
    f.width = "800";
    f.height = "600";
    document.body.appendChild(f);
  }, base);

  await page.waitForTimeout(10000);

  const all = [...reqs.values()];
  const cached = all.filter(r => r.cache || r.bytes === 0);
  const network = all.filter(r => !r.cache && r.bytes > 0);

  console.log(`\nIframe: ${cached.length} cache hits, ${network.length} network`);

  // Check our critical assets specifically
  console.log("\nCritical asset iframe status:");
  for (const asset of CRITICAL_MANIFEST) {
    const name = asset.path.split("/").pop();
    const match = all.find(r => r.file === name || r.file?.startsWith(name));
    if (match) {
      console.log(`  ${name}: ${match.cache || match.bytes === 0 ? "✓ CACHED" : `✗ NETWORK (${match.bytes}b)`}`);
    } else {
      console.log(`  ${name}: not requested by iframe`);
    }
  }

  await browser.close();

  // Cleanup
  const { rmSync } = await import("node:fs");
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

run().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
