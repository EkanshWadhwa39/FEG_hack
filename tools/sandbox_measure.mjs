/**
 * Sandbox cold vs warm measurement against the FEG-provided game package.
 *
 * The package is served unmodified by tools/sandbox_server.py from an origin
 * separate from the lobby, so the browser sees a real cross-origin iframe
 * launch rather than a same-document fetch.
 *
 * Two numbers per arm:
 *   bytes   — CDP Network.loadingFinished encodedDataLength, real wire bytes.
 *   millis  — lobby click to the declared milestone.
 *
 * MILESTONE, stated precisely: the first <canvas> appearing inside #gameStage,
 * i.e. the engine has started and is rendering. This is NOT "playable" and is
 * NOT "interactive". The package's backend (api.spiniq.io) and its
 * offline-data module are both absent in the sandbox, so an input-accepted
 * signal does not exist here and is never claimed.
 *
 * Usage:
 *   node tools/sandbox_measure.mjs --runs 3
 *   node tools/sandbox_measure.mjs --runs 3 --lobby http://localhost:8090 \
 *        --game http://127.0.0.1:8091
 */

import { chromium } from "playwright";

function parseArgs(argv) {
  const args = {
    runs: 3,
    lobby: "http://localhost:8090",
    game: "http://127.0.0.1:8091",
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--runs") args.runs = Number.parseInt(argv[i + 1], 10);
    if (argv[i] === "--lobby") args.lobby = argv[i + 1];
    if (argv[i] === "--game") args.game = argv[i + 1];
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) {
    throw new RangeError("--runs must be a positive integer");
  }
  return args;
}

async function runArm({ lobby, game, warmUrls }) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");

    const requests = new Map();
    const discovered = new Set();
    let phase = "pre";
    let bytes = 0;
    let responses = 0;

    cdp.on("Network.requestWillBeSent", (event) => {
      requests.set(event.requestId, { url: event.request.url, phase });
    });
    cdp.on("Network.responseReceived", (event) => {
      const record = requests.get(event.requestId);
      if (!record || !record.url.startsWith(game)) return;
      if (event.response.status === 200) discovered.add(record.url);
    });
    cdp.on("Network.loadingFinished", (event) => {
      const record = requests.get(event.requestId);
      if (!record || !record.url.startsWith(game)) return;
      if (record.phase !== "launch" || event.encodedDataLength <= 0) return;
      bytes += event.encodedDataLength;
      responses += 1;
    });

    await page.goto(`${lobby}/sandbox.html?game=${encodeURIComponent(game)}`,
      { waitUntil: "load", timeout: 30_000 });

    if (warmUrls?.length) {
      await page.evaluate((urls) => { window.__WARM_MANIFEST__ = urls; }, warmUrls);
      await page.click("#warm");
      await page.waitForFunction(() => window.__WARM_DONE__ > 0, null, { timeout: 120_000 });
    }

    phase = "launch";
    const started = Date.now();
    await page.click("#launch");

    // The milestone is observed inside the game frame, not the lobby.
    let millis = null;
    try {
      const frame = await page.waitForSelector("#game", { timeout: 15_000 });
      const gameFrame = await frame.contentFrame();
      await gameFrame.waitForSelector("#gameStage canvas", { timeout: 90_000 });
      millis = Date.now() - started;
    } catch { /* milestone not reached; reported as null */ }

    // Let late assets settle so the byte figure covers the full load. This
    // must outlast a throttled link, or discovery misses the tail of the
    // manifest and the warm arm under-warms.
    await page.waitForTimeout(Number(process.env.SANDBOX_SETTLE_MS ?? 25_000));
    return { bytes, responses, millis, discovered: [...discovered] };
  } finally {
    await browser.close();
  }
}

const { runs, lobby, game } = parseArgs(process.argv.slice(2));
const controls = [];
const treatments = [];
let warmUrls = null;

for (let run = 1; run <= runs; run += 1) {
  const control = await runArm({ lobby, game, warmUrls: null });
  controls.push(control);
  console.log(
    `control run ${run}    bytes=${control.bytes.toLocaleString().padStart(11)} `
    + `responses=${String(control.responses).padStart(3)} `
    + `milestone=${control.millis ?? "MISSED"}ms`,
  );
  if (!warmUrls) warmUrls = control.discovered;

  const treatment = await runArm({ lobby, game, warmUrls });
  treatments.push(treatment);
  console.log(
    `treatment run ${run}  bytes=${treatment.bytes.toLocaleString().padStart(11)} `
    + `responses=${String(treatment.responses).padStart(3)} `
    + `milestone=${treatment.millis ?? "MISSED"}ms`,
  );
}

const median = (values) => {
  const sorted = [...values].filter((v) => v != null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

const cb = median(controls.map((r) => r.bytes));
const tb = median(treatments.map((r) => r.bytes));
const cm = median(controls.map((r) => r.millis));
const tm = median(treatments.map((r) => r.millis));

console.log(`\n--- median of ${runs} run(s) ---`);
console.log(`warmed manifest:   ${warmUrls?.length ?? 0} assets`);
console.log(`bytes   control ${cb?.toLocaleString()} -> treatment ${tb?.toLocaleString()}`
  + (cb ? `  (${((1 - tb / cb) * 100).toFixed(1)}% less)` : ""));
console.log(`to engine-canvas   control ${cm}ms -> treatment ${tm}ms`
  + (cm && tm ? `  (${((1 - tm / cm) * 100).toFixed(1)}% faster)` : ""));
console.log("\nMilestone is engine-canvas-present, not playable and not interactive.");
