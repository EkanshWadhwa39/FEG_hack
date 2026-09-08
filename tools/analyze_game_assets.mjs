import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
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
    }
  });

  cdp.on("Network.loadingFinished", (ev) => {
    const r = requests.get(ev.requestId);
    if (r) {
      r.encodedDataLength = ev.encodedDataLength;
    }
  });

  console.log("Loading game in iframe...");
  await page.goto(`${GAME_ORIGIN}/game/inspect_slot_full/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(15000);

  const list = [...requests.values()].filter(r => r.url.includes("assets/"));
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

  writeFileSync("tools/all_game_assets.json", JSON.stringify(assets, null, 2));

  console.log(`Total asset requests: ${assets.length}`);
  
  // Categorize
  const categories = {
    js: assets.filter(a => a.path.endsWith(".js")),
    css: assets.filter(a => a.path.includes(".css")),
    fonts: assets.filter(a => a.path.includes("fonts/")),
    splash_images: assets.filter(a => a.path.includes("assets/images/") && !a.path.includes("spines")),
    spines: assets.filter(a => a.path.includes("assets/spines/")),
    sounds: assets.filter(a => a.path.includes("assets/sounds/")),
    locale: assets.filter(a => a.path.includes("assets/locale/")),
    other: assets.filter(a => 
      !a.path.endsWith(".js") && 
      !a.path.includes(".css") && 
      !a.path.includes("fonts/") && 
      !a.path.includes("assets/images/") && 
      !a.path.includes("assets/spines/") && 
      !a.path.includes("assets/sounds/") && 
      !a.path.includes("assets/locale/")
    ),
  };

  for (const [cat, arr] of Object.entries(categories)) {
    const bytes = arr.reduce((sum, a) => sum + (a.bytes || 0), 0);
    console.log(`${cat.padEnd(15)}: ${arr.length.toString().padStart(3)} assets, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
  }

  await browser.close();
}

run().catch(console.error);
