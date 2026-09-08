/**
 * Production parent-to-iframe cache-reuse probe.
 *
 * Answers the one question the whole architecture rests on: can the prototype's
 * own warmer, running in the top-level PSK lobby page, create cache entries
 * that the cross-origin game container iframe later reuses?
 *
 * Method, per arm, in a fresh browser process:
 *   1. Open the production lobby (top-level site psk.hr).
 *   2. Treatment only: execute prototype/src/warmer.js inside that page against
 *      an exact, query-free, content-hashed asset list.
 *   3. Launch a public demo game (no login, no player data).
 *   4. Read Resource Timing from inside the game container frame.
 *
 * A treatment transferSize of 0 with a non-zero decodedBodySize means the frame
 * received the full object without touching the network.
 *
 * Scope: public demo play only. No credentials, no account, no player data. The
 * asset URLs below are public static files. Output is aggregate; pass --verbose
 * for per-asset rows.
 *
 * Usage:
 *   node tools/prod_cache_probe.mjs --runs 2
 *   node tools/prod_cache_probe.mjs --runs 1 --verbose
 */

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const LOBBY = "https://casino.psk.hr/";
const CONTAINER_ORIGIN = "https://gamecontainer-eu.psk.hr";

/** Exact, query-free, content-hashed container assets observed in production. */
const ASSET_PATHS = Object.freeze([
  "/assets/index-DlGwAGUR.css",
  "/assets/index-DXmOoSYl.js",
  "/assets/GameView-BvlG2JmM.css",
  "/assets/_plugin-vue_export-helper-DujmiWZO.js",
  "/assets/GameView-BNDNRzPb.js",
  "/assets/MainProvidersContainer-D42T7zDF.css",
  "/assets/MainProvidersContainer-Dpz1BeIZ.js",
  "/assets/wrapperMessageHelper-DB1zbVy0.js",
  "/assets/apiHelper-BLnDqoxp.js",
]);

function parseArgs(argv) {
  const args = { runs: 2, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--runs") args.runs = Number.parseInt(argv[i + 1], 10);
    if (argv[i] === "--verbose") args.verbose = true;
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) {
    throw new RangeError("--runs must be a positive integer");
  }
  return args;
}

async function runArm(mode) {
  const urls = ASSET_PATHS.map((path) => CONTAINER_ORIGIN + path);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      locale: "hr-HR",
      viewport: { width: 1400, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(LOBBY, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(5_000);

    let warmSummary = null;
    if (mode === "treatment") {
      // Execute the shipped warmer, not a reimplementation of it, so the
      // evidence is about our code rather than about a bespoke test script.
      const warmerSource = await readFile(
        new URL("../prototype/src/warmer.js", import.meta.url),
        "utf8",
      );
      warmSummary = await page.evaluate(async ({ source, targets }) => {
        const blob = new Blob([source], { type: "text/javascript" });
        const module = await import(URL.createObjectURL(blob));
        const plan = {
          locale: "hr-HR",
          tier: "1x",
          assets: targets.map((url) => ({ url, stage: "COMMON", estimatedBytes: 1 })),
        };
        const result = await module.warmAssets({
          plan,
          target: { locale: "hr-HR", tier: "1x" },
          concurrency: 2,
          requestAsset: (url) => fetch(url, { mode: "no-cors", credentials: "include" }),
        });
        return { attempted: result.attempted, requested: result.requested, failed: result.failed };
      }, { source: warmerSource, targets: urls });
    }

    await page.locator("text=/^DEMO$/i").first().click({ timeout: 20_000 });
    await page.waitForTimeout(16_000);

    const frame = page.frames().find((f) => f.url().includes("gamecontainer-eu.psk.hr"));
    if (!frame) return { mode, ok: false, reason: "game container frame not found" };

    const rows = await frame.evaluate(() => performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/assets/"))
      .map((entry) => ({
        // Filename only; never emit full URLs or query strings.
        asset: entry.name.split("/").pop(),
        transferSize: entry.transferSize,
        decodedBodySize: entry.decodedBodySize,
      })));

    return {
      mode,
      ok: true,
      warmSummary,
      assetCount: rows.length,
      totalTransferSize: rows.reduce((sum, row) => sum + row.transferSize, 0),
      totalDecodedBodySize: rows.reduce((sum, row) => sum + row.decodedBodySize, 0),
      rows,
    };
  } finally {
    await browser.close();
  }
}

const { runs, verbose } = parseArgs(process.argv.slice(2));
const results = [];

// Serial by design: concurrent browser runs share network state and would
// invalidate the comparison.
for (let run = 1; run <= runs; run += 1) {
  for (const mode of ["control", "treatment"]) {
    const result = await runArm(mode);
    results.push({ run, ...result });
    const label = `${mode} run ${run}`.padEnd(22);
    if (!result.ok) {
      console.log(`${label} FAILED — ${result.reason}`);
      continue;
    }
    console.log(
      `${label} assets=${result.assetCount} `
      + `transfer=${result.totalTransferSize} decoded=${result.totalDecodedBodySize}`,
    );
    if (verbose) {
      for (const row of result.rows) {
        console.log(`    ${row.asset.padEnd(42)} ${String(row.transferSize).padStart(8)}`);
      }
    }
  }
}

const control = results.filter((r) => r.ok && r.mode === "control");
const treatment = results.filter((r) => r.ok && r.mode === "treatment");
const reused = treatment.length > 0 && treatment.every((r) => r.totalTransferSize === 0);
const decodedMatches = treatment.every((r) => r.totalDecodedBodySize > 0);

console.log("\n--- summary ---");
console.log(`control arms:   ${control.map((r) => r.totalTransferSize).join(", ")} bytes transferred`);
console.log(`treatment arms: ${treatment.map((r) => r.totalTransferSize).join(", ")} bytes transferred`);
console.log(`verdict: ${reused && decodedMatches ? "REUSE CONFIRMED" : "NOT CONFIRMED"}`);
process.exitCode = reused && decodedMatches ? 0 : 1;
