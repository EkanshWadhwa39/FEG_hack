#!/usr/bin/env node
/** Run isolated browser HTTP-cache reuse arms with positive and negative controls. */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { platform, release } from "node:os";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROMIUM_ARGS = Object.freeze([
  "--host-resolver-rules=MAP lobby-a.test 127.0.0.1,MAP lobby-b.test 127.0.0.1,MAP asset.test 127.0.0.1",
  "--no-proxy-server",
]);

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

function isFixtureUrl(rawUrl) {
  try {
    return new URL(rawUrl).pathname.startsWith("/fixture");
  } catch {
    return false;
  }
}

async function attachFixtureMonitor(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Page.enable");

  const requests = [];
  const requestsById = new Map();
  let iframeFrameId = null;

  cdp.on("Page.frameNavigated", (event) => {
    if (event.frame.parentId && event.frame.url.includes("/frame.html")) {
      iframeFrameId = event.frame.id;
    }
  });
  cdp.on("Network.requestWillBeSent", (event) => {
    if (!isFixtureUrl(event.request.url)) return;
    const request = {
      frameId: event.frameId,
      servedFromCache: false,
      responseCacheFlag: false,
    };
    requestsById.set(event.requestId, request);
    requests.push(request);
  });
  cdp.on("Network.requestServedFromCache", (event) => {
    const request = requestsById.get(event.requestId);
    if (request) request.servedFromCache = true;
  });
  cdp.on("Network.responseReceived", (event) => {
    const request = requestsById.get(event.requestId);
    if (!request) return;
    request.responseCacheFlag = Boolean(
      event.response.fromDiskCache || event.response.fromPrefetchCache,
    );
  });

  return () => {
    const sanitized = requests.map((request) => ({
      request_context: request.frameId === iframeFrameId ? "IFRAME" : "PARENT_OR_OTHER",
      served_from_cache_event: request.servedFromCache,
      response_cache_flag: request.responseCacheFlag,
    }));
    const iframeRequests = sanitized.filter((request) => request.request_context === "IFRAME");
    return {
      iframe_frame_identified: iframeFrameId !== null,
      iframe_fixture_request_count: iframeRequests.length,
      iframe_fixture_request: iframeRequests.length === 1 ? iframeRequests[0] : null,
      fixture_requests: sanitized,
    };
  };
}

async function runArm(chromium, ready, mode, run, experimentCase = "exact") {
  await post(ready.asset_origin, "/reset");
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const monitorResult = await attachFixtureMonitor(context, page);

    await page.goto(
      `${ready.browser_lobby_origin}/?mode=${mode}&case=${experimentCase}`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForFunction(() => window.__experimentResult !== null, null, { timeout: 15_000 });
    const frameResult = await page.evaluate(() => window.__experimentResult);
    const serverMetrics = await metrics(ready.asset_origin);
    const browserEvidence = monitorResult();
    const version = browser.version();
    await context.close();
    return {
      arm: mode,
      case: experimentCase,
      run,
      fresh_browser_process: true,
      browser: version,
      server: serverMetrics,
      iframe_resource_timing: frameResult,
      browser_evidence: browserEvidence,
    };
  } finally {
    await browser.close();
  }
}

async function runPartitionBoundaryArm(chromium, ready, run) {
  await post(ready.asset_origin, "/reset");
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const prefetchPage = await context.newPage();
    await prefetchPage.goto(
      `${ready.browser_lobby_origin}/?mode=prefetch-only&case=exact`,
      { waitUntil: "domcontentloaded" },
    );
    await prefetchPage.waitForFunction(
      () => window.__experimentResult?.prefetchComplete === true,
      null,
      { timeout: 15_000 },
    );
    await prefetchPage.close();

    const launchPage = await context.newPage();
    const monitorResult = await attachFixtureMonitor(context, launchPage);
    await launchPage.goto(
      `${ready.partition_lobby_origin}/?mode=launch-only&case=exact`,
      { waitUntil: "domcontentloaded" },
    );
    await launchPage.waitForFunction(() => window.__experimentResult !== null, null, { timeout: 15_000 });
    const frameResult = await launchPage.evaluate(() => window.__experimentResult);
    const serverMetrics = await metrics(ready.asset_origin);
    const browserEvidence = monitorResult();
    const version = browser.version();
    await context.close();
    return {
      arm: "partition-boundary",
      case: "exact",
      run,
      fresh_browser_process: true,
      browser: version,
      server: serverMetrics,
      iframe_resource_timing: frameResult,
      browser_evidence: browserEvidence,
      top_level_partition_changed: true,
    };
  } finally {
    await browser.close();
  }
}

function iframeCacheMarked(arm) {
  const request = arm.browser_evidence.iframe_fixture_request;
  return Boolean(request?.served_from_cache_event || request?.response_cache_flag);
}

function iframeAttributionValid(arm) {
  return arm.browser_evidence.iframe_frame_identified
    && arm.browser_evidence.iframe_fixture_request_count === 1;
}

function treatmentReused(ready, arm) {
  return iframeAttributionValid(arm)
    && arm.server.requests.launch === 0
    && arm.iframe_resource_timing.transferSize === 0
    && arm.iframe_resource_timing.receivedBytes === ready.asset_bytes
    && iframeCacheMarked(arm);
}

function negativeControlMissed(ready, arm) {
  return iframeAttributionValid(arm)
    && arm.server.requests.prefetch === 1
    && arm.server.requests.launch === 1
    && arm.server.response_body_bytes.launch === ready.asset_bytes
    && arm.iframe_resource_timing.transferSize > 0
    && arm.iframe_resource_timing.receivedBytes === ready.asset_bytes
    && !iframeCacheMarked(arm);
}

function summarize(
  ready,
  controls,
  treatments,
  mismatchControls,
  noStoreControls,
  partitionControls,
  playwrightVersion,
) {
  const controlLaunchBytes = controls.map((arm) => arm.server.response_body_bytes.launch);
  const treatmentPrefetchBytes = treatments.map((arm) => arm.server.response_body_bytes.prefetch);
  const treatmentLaunchBytes = treatments.map((arm) => arm.server.response_body_bytes.launch);
  const reuseByRun = treatments.map((arm) => treatmentReused(ready, arm));
  const mismatchByRun = mismatchControls.map((arm) => negativeControlMissed(ready, arm));
  const noStoreByRun = noStoreControls.map((arm) => negativeControlMissed(ready, arm));
  const partitionReuseByRun = partitionControls.map((arm) => treatmentReused(ready, arm));
  const partitionNetworkByRun = partitionControls.map((arm) => negativeControlMissed(ready, arm));
  const attributionByRun = [
    ...controls,
    ...treatments,
    ...mismatchControls,
    ...noStoreControls,
    ...partitionControls,
  ].map(iframeAttributionValid);
  const allDeterministicControlsPassed = reuseByRun.every(Boolean)
    && mismatchByRun.every(Boolean)
    && noStoreByRun.every(Boolean)
    && attributionByRun.every(Boolean);

  return {
    schema_version: 3,
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
      topology: "loopback servers with mapped .test hosts; distinct top-level sites for partition boundary",
      service_workers: "blocked",
      request_semantics: "GET; cors; credentials omit; cache default; exact URL unless mismatch control",
      response_headers: {
        label: "SIMULATED",
        value: "cacheable except explicit no-store control; CORS and Resource Timing allowed",
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
      exact_url_mismatch_forced_network_by_run: mismatchByRun,
      no_store_forced_network_by_run: noStoreByRun,
      top_level_partition_boundary_reused_cached_response_by_run: partitionReuseByRun,
      top_level_partition_boundary_forced_network_by_run: partitionNetworkByRun,
      top_level_partition_boundary_result: partitionReuseByRun.every(Boolean)
        ? "CACHE_REUSED"
        : "MIXED_OR_NETWORK",
      iframe_cdp_attribution_valid_for_every_arm: attributionByRun.every(Boolean),
      all_deterministic_controls_passed: allDeterministicControlsPassed,
    },
    arms: {
      control: controls,
      treatment: treatments,
      exact_url_mismatch: mismatchControls,
      no_store: noStoreControls,
      top_level_partition_boundary: partitionControls,
    },
    limitations: [
      "Local synthetic headers and origins are not production or staging behavior.",
      "Server response-body bytes are not HAR wire bytes and exclude headers.",
      "Local repetitions are diagnostic and not a production performance benchmark.",
      "The mapped .test top-level partition boundary tests this Chromium build only; cache reuse was observed and must not be generalized to staging.",
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
    const mismatchControls = [];
    const noStoreControls = [];
    const partitionControls = [];
    for (let run = 1; run <= options.runs; run += 1) {
      controls.push(await runArm(chromium, ready, "control", run));
      treatments.push(await runArm(chromium, ready, "treatment", run));
      mismatchControls.push(await runArm(chromium, ready, "treatment", run, "mismatch"));
      noStoreControls.push(await runArm(chromium, ready, "treatment", run, "no-store"));
      partitionControls.push(await runPartitionBoundaryArm(chromium, ready, run));
    }
    const summary = summarize(
      ready,
      controls,
      treatments,
      mismatchControls,
      noStoreControls,
      partitionControls,
      playwright.version,
    );
    const output = `${JSON.stringify(summary, null, 2)}\n`;
    if (options.output) await writeFile(options.output, output, { encoding: "utf8", flag: "wx" });
    process.stdout.write(output);
    if (!summary.result.all_deterministic_controls_passed) process.exitCode = 2;
  } finally {
    await stopServer(child);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
