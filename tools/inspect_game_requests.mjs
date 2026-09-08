import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const GAME_ORIGIN = "http://127.0.0.1:8091";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");

  const requests = new Map();

  cdp.on("Network.requestWillBeSent", (ev) => {
    requests.set(ev.requestId, {
      url: ev.request.url,
      method: ev.request.method,
      type: ev.type,
    });
  });

  cdp.on("Network.responseReceived", (ev) => {
    const r = requests.get(ev.requestId);
    if (r) {
      r.status = ev.response.status;
      r.mimeType = ev.response.mimeType;
      r.fromDiskCache = ev.response.fromDiskCache;
    }
  });

  cdp.on("Network.loadingFinished", (ev) => {
    const r = requests.get(ev.requestId);
    if (r) {
      r.encodedDataLength = ev.encodedDataLength;
    }
  });

  console.log("Navigating to game iframe...");
  await page.goto(`${GAME_ORIGIN}/game/inspect_slot/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(12000);

  console.log(`Total requests captured: ${requests.size}`);

  const list = [...requests.values()].filter(r => r.url.includes("assets/"));
  console.log(`Asset requests captured: ${list.length}`);

  const assets = list.map(r => {
    const u = new URL(r.url);
    const path = u.pathname.replace(/^\/game\/[^/]+\//, "") + (u.search || "");
    return {
      path,
      bytes: r.encodedDataLength || 0,
      mimeType: r.mimeType,
      type: r.type,
    };
  });

  console.log(JSON.stringify(assets, null, 2));

  await browser.close();
}

run().catch(console.error);
