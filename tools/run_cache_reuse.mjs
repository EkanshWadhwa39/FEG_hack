#!/usr/bin/env node
/** Run isolated control/treatment browser cache-reuse arms with Playwright. */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { platform, release } from "node:os";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const result = { output: null, python: ".venv/bin/python", runs: 2, serverArgs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") result.output = argv[++index];
    else if (argument === "--python") result.python = argv[++index];
    else if (argument === "--runs") result.runs = Number(argv[++index]);
    else result.serverArgs.push(argument);
  }
  if (!Number.isInteger(result.runs) || result.runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  return result;
}

function loadPlaywright() {
  const moduleName = process.env.PLAYWRIGHT_MODULE || "playwright";
  try {
    return {
      api: require(moduleName),
      version: require(`${moduleName}/package.json`).version,
    };
  } catch {
    throw new Error(
      "Playwright is required only for this browser experiment. Install it outside the repository and set PLAYWRIGHT_MODULE to its package directory.",
    );
  }
}

async function startServer(python, serverArgs) {
  const child = spawn(
    python,
    ["tools/cache_reuse_server.py", ...serverArgs],
    { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const lines = createInterface({ input: child.stdout });
  const ready = await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error("server readiness timed out")), 10_000);
    lines.once("line", (line) => {
      clearTimeout(timeout);
      try {
        resolveReady(JSON.parse(line));
      } catch {
        rejectReady(new Error(`invalid server readiness output; ${stderr || "no diagnostic"}`));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectReady(new Error(`server exited before readiness (${code}); ${stderr || "no diagnostic"}`));
    });
  });
  return { child, ready };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function post(origin, path) {
  const response = await fetch(`${origin}${path}`, { method: "POST", cache: "no-store" });
  if (!response.ok) throw new Error(`experiment server returned ${response.status}`);
}

async function metrics(origin) {
  const response = await fetch(`${origin}/metrics`, { cache: "no-store" });
  if (!response.ok) throw new Error(`metrics server returned ${response.status}`);
  return response.json();
}

async function runArm(chromium, ready, mode, run) {
  await post(ready.asset_origin, "/reset");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");

    const fixtureRequests = [];
    const requestIndexes = new Map();
    cdp.on("Network.requestWillBeSent", (event) => {
      if (!event.request.url.includes("/fixture.bin?")) return;
      requestIndexes.set(event.requestId, fixtureRequests.length);
      fixtureRequests.push({ servedFromCache: false, responseCacheFlag: false });
    });
    cdp.on("Network.requestServedFromCache", (event) => {
      const index = requestIndexes.get(event.requestId);
      if (index !== undefined) fixtureRequests[index].servedFromCache = true;
    });
    cdp.on("Network.responseReceived", (event) => {
      const index = requestIndexes.get(event.requestId);
      if (index === undefined) return;
      fixtureRequests[index].responseCacheFlag = Boolean(
        event.response.fromDiskCache || event.response.fromPrefetchCache,
      );
    });

    await page.goto(`${ready.lobby_origin}/?mode=${mode}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__experimentResult !== null, null, { timeout: 15_000 });
    const frameResult = await page.evaluate(() => window.__experimentResult);
    const serverMetrics = await metrics(ready.asset_origin);
    const version = browser.version();
    await context.close();
    return {
      arm: mode,
      run,
      fresh_browser_process: true,
      browser: version,
      server: serverMetrics,
      iframe_resource_timing: frameResult,
      browser_fixture_requests: fixtureRequests,
    };
  } finally {
    await browser.close();
  }
}

function treatmentReused(ready, arm) {
  const launchRequest = arm.browser_fixture_requests.at(-1);
  const browserMarkedCached = launchRequest?.servedFromCache
    || launchRequest?.responseCacheFlag;
  return arm.server.requests.launch === 0
    && arm.iframe_resource_timing.transferSize === 0
    && arm.iframe_resource_timing.receivedBytes === ready.asset_bytes
    && Boolean(browserMarkedCached);
}

function summarize(ready, controls, treatments, playwrightVersion) {
  const controlLaunchBytes = controls.map((arm) => arm.server.response_body_bytes.launch);
  const treatmentPrefetchBytes = treatments.map((arm) => arm.server.response_body_bytes.prefetch);
  const treatmentLaunchBytes = treatments.map((arm) => arm.server.response_body_bytes.launch);
  const reuseByRun = treatments.map((arm) => treatmentReused(ready, arm));
  return {
    schema_version: 2,
    evidence_label: "MEASURED",
    scope: {
      environment: "LOCAL_CONTROLLED",
      fixture_source: ready.source,
      fixture_bytes: ready.asset_bytes,
      browser: `Chromium ${controls[0].browser}`,
      playwright: playwrightVersion,
      os: `${platform()} ${release()}`,
      headless: true,
      arms_per_condition: controls.length,
      topology: "127.0.0.1 parent and iframe on distinct ports",
      service_workers: "blocked",
      request_semantics: "GET; cors; credentials omit; cache default; exact URL",
      response_headers: {
        label: "SIMULATED",
        value: "public max-age immutable; CORS and Resource Timing allowed",
      },
    },
    result: {
      control_launch_response_body_bytes_by_run: controlLaunchBytes,
      treatment_prefetch_response_body_bytes_by_run: treatmentPrefetchBytes,
      treatment_launch_response_body_bytes_by_run: treatmentLaunchBytes,
      launch_response_body_byte_difference_by_run: treatmentLaunchBytes.map(
        (bytes, index) => bytes - controlLaunchBytes[index],
      ),
      treatment_launch_reused_cached_response_by_run: reuseByRun,
      all_treatment_launches_reused_cached_response: reuseByRun.every(Boolean),
    },
    arms: { control: controls, treatment: treatments },
    limitations: [
      "Local synthetic headers and origins are not production or staging behavior.",
      "Server response-body bytes are not HAR wire bytes and exclude headers.",
      "Local repetitions are diagnostic and not a production performance benchmark.",
      "No exclusion-register integration or latency was measured.",
      "No interactive game milestone was measured.",
    ],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const playwright = loadPlaywright();
  const { chromium } = playwright.api;
  const { child, ready } = await startServer(options.python, options.serverArgs);
  try {
    const controls = [];
    const treatments = [];
    for (let run = 1; run <= options.runs; run += 1) {
      controls.push(await runArm(chromium, ready, "control", run));
      treatments.push(await runArm(chromium, ready, "treatment", run));
    }
    const summary = summarize(ready, controls, treatments, playwright.version);
    const output = `${JSON.stringify(summary, null, 2)}\n`;
    if (options.output) await writeFile(options.output, output, { encoding: "utf8", flag: "wx" });
    process.stdout.write(output);
    if (!summary.result.all_treatment_launches_reused_cached_response) process.exitCode = 2;
  } finally {
    await stopServer(child);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
