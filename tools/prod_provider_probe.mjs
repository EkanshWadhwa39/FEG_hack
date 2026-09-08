/**
 * Production provider-bundle warming probe.
 *
 * `prod_cache_probe.mjs` proved same-site reuse for the ~92 KB container shell.
 * This measures the part that actually dominates load time: the multi-megabyte
 * provider bundle, served from a DIFFERENT site (`*.v1t.eu`) than the lobby
 * (`psk.hr`).
 *
 * Instrument: CDP `Network.loadingFinished.encodedDataLength`, i.e. real bytes
 * on the wire. Resource Timing is useless here — the provider CDN sends no
 * `Timing-Allow-Origin`, so cross-origin entries report zeros.
 *
 * Method, per arm, in a fresh browser process:
 *   1. Open the production lobby.
 *   2. Discovery/control: launch a public demo game, record every no-query
 *      200 asset URL on *.v1t.eu and the bytes they cost.
 *   3. Treatment: warm those exact URLs from the lobby page at concurrency 2,
 *      then launch and measure the same way.
 *
 * Scope: public demo play. No login, no credentials, no player data. Output is
 * aggregate counts and byte totals; URLs are written only to ignored private
 * storage when --save-urls is passed.
 *
 * Usage:
 *   node tools/prod_provider_probe.mjs --runs 2
 */

import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const LOBBY = "https://casino.psk.hr/";
const PROVIDER_MATCH = "v1t.eu";
const WARM_CONCURRENCY = 2;

function parseArgs(argv) {
  const args = { runs: 1, saveUrls: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--runs") args.runs = Number.parseInt(argv[i + 1], 10);
    if (argv[i] === "--save-urls") args.saveUrls = true;
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) {
    throw new RangeError("--runs must be a positive integer");
  }
  return args;
}

/**
 * Run one arm. `warmUrls` null means control (and doubles as discovery).
 */
async function runArm(warmUrls) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      locale: "hr-HR",
      viewport: { width: 1400, height: 900 },
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");

    const requests = new Map();
    const discovered = new Set();
    let phase = "pre";
    let networkBytes = 0;
    let networkResponses = 0;

    cdp.on("Network.requestWillBeSent", (event) => {
      requests.set(event.requestId, { url: event.request.url, phase });
    });
    cdp.on("Network.responseReceived", (event) => {
      const record = requests.get(event.requestId);
      if (!record || !record.url.includes(PROVIDER_MATCH)) return;
      // Only exact, query-free, successful assets are warmable.
      if (event.response.status === 200 && !record.url.includes("?")) {
        discovered.add(record.url);
      }
    });
    cdp.on("Network.loadingFinished", (event) => {
      const record = requests.get(event.requestId);
      if (!record || !record.url.includes(PROVIDER_MATCH)) return;
      if (record.phase !== "launch" || event.encodedDataLength <= 0) return;
      networkBytes += event.encodedDataLength;
      networkResponses += 1;
    });

    await page.goto(LOBBY, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(5_000);

    let warmSummary = null;
    if (warmUrls) {
      warmSummary = await page.evaluate(async ({ targets, concurrency }) => {
        let ok = 0;
        let failed = 0;
        let index = 0;
        async function worker() {
          while (index < targets.length) {
            const url = targets[index];
            index += 1;
            try {
              await fetch(url, { mode: "no-cors", credentials: "include" });
              ok += 1;
            } catch {
              failed += 1;
            }
          }
        }
        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        return { ok, failed, total: targets.length };
      }, { targets: warmUrls, concurrency: WARM_CONCURRENCY });
    }

    phase = "launch";
    await page.locator("text=/^DEMO$/i").first().click({ timeout: 20_000 });
    // The provider bundle streams in well after first paint.
    await page.waitForTimeout(24_000);

    return {
      warmSummary,
      networkResponses,
      networkBytes,
      discovered: [...discovered],
    };
  } finally {
    await browser.close();
  }
}

const { runs, saveUrls } = parseArgs(process.argv.slice(2));
const controls = [];
const treatments = [];
let warmUrls = null;

// Serial by design: concurrent runs share network state.
for (let run = 1; run <= runs; run += 1) {
  const control = await runArm(null);
  controls.push(control);
  console.log(
    `control run ${run}    responses=${control.networkResponses} `
    + `bytes=${control.networkBytes.toLocaleString()} discovered=${control.discovered.length}`,
  );
  if (!warmUrls) warmUrls = control.discovered;

  const treatment = await runArm(warmUrls);
  treatments.push(treatment);
  console.log(
    `treatment run ${run}  responses=${treatment.networkResponses} `
    + `bytes=${treatment.networkBytes.toLocaleString()} `
    + `warmed=${treatment.warmSummary.ok}/${treatment.warmSummary.total}`,
  );
}

if (saveUrls && warmUrls) {
  await writeFile(
    new URL("../evidence/private/provider-urls.json", import.meta.url),
    JSON.stringify(warmUrls, null, 1),
  );
  console.log(`\nwrote ${warmUrls.length} URLs to ignored private storage`);
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const controlBytes = median(controls.map((r) => r.networkBytes));
const treatmentBytes = median(treatments.map((r) => r.networkBytes));
const reduction = controlBytes > 0 ? 1 - treatmentBytes / controlBytes : 0;

console.log("\n--- summary (median of runs) ---");
console.log(`control provider bytes:   ${controlBytes.toLocaleString()}`);
console.log(`treatment provider bytes: ${treatmentBytes.toLocaleString()}`);
console.log(`reduction: ${(reduction * 100).toFixed(1)}%`);
