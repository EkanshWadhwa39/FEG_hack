import { createRequire } from "node:module";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const GAME_ORIGIN = "http://127.0.0.1:8091";
const LOBBY_ORIGIN = "http://127.0.0.1:8090";

const allAssets = JSON.parse(readFileSync("tools/all_game_assets.json"));
const warmupSet = allAssets.filter(a => 
  !a.path.includes("sounds/") && 
  !a.path.includes("bigwins") && 
  !a.path.includes("scatter") && 
  !a.path.includes("chest") && 
  !a.path.includes("book") && 
  !a.path.includes("shield") && 
  !a.path.includes("cup") && 
  !a.path.includes("low_")
);

async function run() {
  const userDataDir = mkdtempSync(join(tmpdir(), "pw-exact-cache-"));
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: ["--disk-cache-size=104857600"],
  });
  const page = await browser.newPage();
  const slotTag = `s_${Date.now()}`;
  const base = `${GAME_ORIGIN}/game/${slotTag}/`;

  await page.goto(`${LOBBY_ORIGIN}/lobby.html`, { waitUntil: "domcontentloaded" });

  console.log(`Warming ${warmupSet.length} assets for slot ${slotTag}...`);
  const t0 = performance.now();
  const warmResult = await page.evaluate(async ({ base, assets }) => {
    let ok = 0, fail = 0;
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
      while (next < assets.length) {
        const i = next++;
        const url = base + assets[i].path;
        try {
          const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "default" });
          if (!res.ok) { fail++; continue; }
          await drainBody(res).catch(() => {});
          ok++;
        } catch {
          fail++;
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return { ok, fail };
  }, { base, assets: warmupSet });

  const elapsed = Math.round(performance.now() - t0);
  console.log(`Warm complete: ${warmResult.ok}/${warmupSet.length} OK, ${warmResult.fail} failed in ${elapsed}ms`);

  // Now launch the iframe and measure cache hits
  console.log("\nLaunching game iframe...");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");

  const reqs = new Map();
  cdp.on("Network.requestWillBeSent", (ev) => {
    if (!ev.request.url.includes(slotTag) || !ev.request.url.includes("assets/")) return;
    reqs.set(ev.requestId, { url: ev.request.url, file: ev.request.url.split("/").pop(), cache: false, bytes: null });
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
    const frame = document.createElement("iframe");
    frame.src = src;
    frame.width = "800";
    frame.height = "600";
    document.body.appendChild(frame);
  }, base);

  await page.waitForTimeout(12000);

  const allReqs = [...reqs.values()];
  const cached = allReqs.filter(r => r.cache || r.bytes === 0);
  const network = allReqs.filter(r => !r.cache && r.bytes > 0);

  console.log(`\n============================================================`);
  console.log(`EXACT MANIFEST RESULTS`);
  console.log(`============================================================`);
  console.log(`Total iframe asset requests: ${allReqs.length}`);
  console.log(`Cache hits: ${cached.length}`);
  console.log(`Network fetches: ${network.length}`);

  // Check the warmed assets specifically
  let warmedHits = 0;
  let warmedMisses = 0;
  for (const asset of warmupSet) {
    const match = allReqs.find(r => r.url.endsWith(asset.path));
    if (match) {
      if (match.cache || match.bytes === 0) {
        warmedHits++;
      } else {
        warmedMisses++;
        console.log(`  MISS on warmed asset: ${asset.path} (${match.bytes} bytes)`);
      }
    }
  }

  console.log(`\nWarmed assets reused by iframe: ${warmedHits}/${warmupSet.length} (${warmedMisses} misses)`);
  console.log(`Unwarmed assets (sounds + secondary spines): ${network.length} network fetches`);

  await browser.close();
  const { rmSync } = await import("node:fs");
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

run().catch(console.error);
