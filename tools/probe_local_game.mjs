#!/usr/bin/env node
// Read-only bundle boot diagnostic. Routing and no-store deliberately disable cache.
// Never use this diagnostic to claim CONTROL/TREATMENT cache or interactive gains.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { chromium } from "playwright";

const args = process.argv.slice(2);
if (args.includes("--help") || !args.includes("--zip")) {
  console.log("Usage: node tools/probe_local_game.mjs --zip <private archive> [--runs 3] [--observe-ms 15000]");
  process.exit(args.includes("--help") ? 0 : 1);
}
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const runs = Number(value("--runs", 3));
const observeMs = Number(value("--observe-ms", 15000));
if (!Number.isInteger(runs) || runs < 1 || runs > 10 || !Number.isFinite(observeMs) || observeMs < 1000 || observeMs > 60000) {
  throw new Error("Invalid bounded run count or observation window");
}
const server = spawn(".venv/bin/python", ["tools/local_game_probe_server.py", "--zip", value("--zip")], {
  stdio: ["ignore", "pipe", "ignore"],
});
let browser;
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local diagnostic server startup timed out")), 10000);
    server.once("exit", () => { clearTimeout(timer); reject(new Error("Local diagnostic server exited")); });
    const lines = createInterface({ input: server.stdout });
    lines.once("line", line => {
      clearTimeout(timer);
      try { resolve(JSON.parse(line).port); } catch { reject(new Error("Invalid server startup response")); }
      lines.close();
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const results = [];
  let browserVersion;
  for (let run = 1; run <= runs; run += 1) {
    browser = await chromium.launch({ headless: true });
    browserVersion = browser.version();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    let externalBlocked = 0;
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
      externalBlocked += 1;
      return route.abort("blockedbyclient");
    });
    await context.addInitScript(() => {
      window.__localBootDiagnostic = { canvasAttachedMs: null, longTasks: [] };
      new MutationObserver(() => {
        if (document.querySelector("canvas") && window.__localBootDiagnostic.canvasAttachedMs === null) {
          window.__localBootDiagnostic.canvasAttachedMs = performance.now();
        }
      }).observe(document, { subtree: true, childList: true });
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) window.__localBootDiagnostic.longTasks.push(entry.duration);
        }).observe({ type: "longtask", buffered: true });
      } catch { /* Diagnostic reports capability absence via scope; never crashes the game. */ }
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Network.enable");
    const statusCounts = {};
    let completedEncodedBytes = 0;
    let runtimeErrorCount = 0;
    let bookImage404 = false;
    let requestCount = 0;
    let failedRequests = 0;
    cdp.on("Network.loadingFinished", event => { completedEncodedBytes += event.encodedDataLength; });
    page.on("request", () => { requestCount += 1; });
    page.on("requestfailed", () => { failedRequests += 1; });
    page.on("pageerror", () => { runtimeErrorCount += 1; });
    page.on("response", response => {
      statusCounts[response.status()] = (statusCounts[response.status()] || 0) + 1;
      if (response.status() === 404 && new URL(response.url()).pathname.endsWith("/book.png")) bookImage404 = true;
    });
    let navigationTimedOut = false;
    try { await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30000 }); }
    catch { navigationTimedOut = true; }
    await page.waitForTimeout(observeMs);
    const timings = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const firstPaint = performance.getEntriesByName("first-contentful-paint")[0];
      const resources = performance.getEntriesByType("resource");
      const diagnostic = window.__localBootDiagnostic;
      const byInitiator = {};
      for (const entry of resources) byInitiator[entry.initiatorType] = (byInitiator[entry.initiatorType] || 0) + 1;
      return {
        observationEndMs: performance.now(),
        domContentLoadedMs: nav?.domContentLoadedEventEnd || null,
        windowLoadMs: nav?.loadEventEnd || null,
        firstContentfulPaintMs: firstPaint?.startTime ?? null,
        canvasAttachedMs: diagnostic.canvasAttachedMs,
        canvasCount: document.querySelectorAll("canvas").length,
        canvasDimensions: [...document.querySelectorAll("canvas")].map(c => [c.width, c.height]),
        completedResourceEntries: resources.length,
        resourceEntriesByInitiator: byInitiator,
        lastResourceCompletionMs: resources.length ? Math.max(...resources.map(e => e.responseEnd)) : null,
        longTaskCount: diagnostic.longTasks.length,
        longTaskTotalMs: diagnostic.longTasks.reduce((a, b) => a + b, 0),
        longTaskMaxMs: diagnostic.longTasks.length ? Math.max(...diagnostic.longTasks) : 0,
        totalBlockingTimeApproxMs: diagnostic.longTasks.reduce((a, b) => a + Math.max(0, b - 50), 0),
      };
    });
    const metrics = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(e => [e.name, e.value]));
    results.push({
      run, navigationTimedOut, requestCount, statusCounts, failedRequests, externalBlockedByRoute: externalBlocked,
      runtimeErrorCount, bookImage404, completedEncodedBytes, ...timings,
      scriptDurationMs: metrics.ScriptDuration * 1000,
      taskDurationMs: metrics.TaskDuration * 1000,
      jsHeapUsedBytes: metrics.JSHeapUsedSize,
      authoritativeInputAcceptedMs: null,
      authoritativeInputAcceptedLabel: "UNKNOWN",
    });
    await browser.close();
    browser = undefined;
  }
  console.log(JSON.stringify({
    label: "MEASURED",
    scope: { title: "Empire of Gold", provider: "SpinIQ", browser: browserVersion, runs, viewport: "1280x720", deviceScaleFactor: 1, headless: true, observeMsAfterDOMContentLoaded: observeMs },
    conditions: [
      "Unchanged bytes read directly from supplied ZIP; no patch or placeholder",
      "Loopback HTTP, no network/CPU throttle, simulated no-store/CSP response headers",
      "External requests blocked by routing and CSP; service workers blocked",
      "Routing disables HTTP cache: fresh-boot diagnostic only, not a cache comparison",
      "Canvas attachment, paint, window load and response completion do not mean playable",
      "No click anchor, authorization integration, input probe, or authoritative game milestone",
      "Local ZIP decompression/server work and shared-host/software-rendering effects included",
    ],
    results,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
