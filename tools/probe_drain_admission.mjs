#!/usr/bin/env node
/**
 * Does a speculative fetch whose body is never read still get admitted to the
 * browser HTTP cache?
 *
 * ADR-008 added a body drain to the credential-free requester on the reasoning
 * that an unread response may never be cached, which would mean warming
 * silently does nothing. No browser specification was found stating the
 * admission rule, so this probe measures it instead of assuming it.
 *
 * Arms differ in exactly one thing: whether the prefetch-phase response body is
 * piped to a discarding sink. Everything else — URL, request options, browser
 * process, server state — is identical and reset between runs.
 *
 * Emits aggregate counters only. No URLs, headers, credentials, or bodies.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_PATH = "/fixture.bin?v=local-proof-1";

function parseArgs(argv) {
  const parsed = { python: ".venv/Scripts/python.exe", runs: 2, settleMs: 750 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--python") parsed.python = argv[++index];
    else if (argument === "--runs") parsed.runs = Number(argv[++index]);
    else if (argument === "--settle-ms") parsed.settleMs = Number(argv[++index]);
  }
  if (!Number.isInteger(parsed.runs) || parsed.runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  return parsed;
}

async function startServer(python) {
  const child = spawn(python, ["tools/cache_reuse_server.py"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const lines = createInterface({ input: child.stdout });
  const ready = await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error("server readiness timed out")), 10_000);
    lines.once("line", (line) => {
      clearTimeout(timeout);
      try { resolveReady(JSON.parse(line)); }
      catch { rejectReady(new Error(`invalid readiness output; ${stderr || "no diagnostic"}`)); }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectReady(new Error(`server exited before readiness (${code}); ${stderr || "no diagnostic"}`));
    });
  });
  return { child, ready };
}

async function post(origin, path) {
  const response = await fetch(`${origin}${path}`, { method: "POST", cache: "no-store" });
  if (!response.ok) throw new Error(`server returned ${response.status} for ${path}`);
}

async function metrics(origin) {
  const response = await fetch(`${origin}/metrics`, { cache: "no-store" });
  if (!response.ok) throw new Error(`metrics returned ${response.status}`);
  return response.json();
}

/** One arm: prefetch (drained or not), settle, then a launch-phase re-request. */
async function runArm(chromium, ready, drain, run, settleMs) {
  await post(ready.asset_origin, "/reset");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    await page.goto(ready.lobby_origin, { waitUntil: "domcontentloaded" });

    const assetUrl = `${ready.asset_origin}${ASSET_PATH}`;

    await post(ready.asset_origin, "/phase/prefetch");
    const prefetch = await page.evaluate(async ({ url, shouldDrain }) => {
      const response = await fetch(url, { method: "GET", mode: "cors", credentials: "omit", cache: "default" });
      if (shouldDrain && response.body) {
        await response.body.pipeTo(new WritableStream());
        return { drained: true, ok: response.ok };
      }
      return { drained: false, ok: response.ok };
    }, { url: assetUrl, shouldDrain: drain });

    await page.waitForTimeout(settleMs);

    await post(ready.asset_origin, "/phase/launch");
    await page.evaluate(async (url) => {
      const response = await fetch(url, { method: "GET", mode: "cors", credentials: "omit", cache: "default" });
      if (response.body) await response.body.pipeTo(new WritableStream());
    }, assetUrl);

    const snapshot = await metrics(ready.asset_origin);
    const version = browser.version();
    await context.close();

    return {
      arm: drain ? "DRAINED" : "UNDRAINED",
      run,
      fresh_browser_process: true,
      browser: version,
      prefetch_drained: prefetch.drained,
      prefetch_requests: snapshot.requests.prefetch,
      prefetch_body_bytes: snapshot.response_body_bytes.prefetch,
      launch_requests: snapshot.requests.launch,
      launch_body_bytes: snapshot.response_body_bytes.launch,
      asset_bytes: snapshot.asset_bytes,
      // The load-bearing observation: zero launch-phase body bytes means the
      // prefetch was admitted to cache and reused.
      reused_from_cache: snapshot.response_body_bytes.launch === 0,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = require("playwright");
  const playwrightVersion = require("playwright/package.json").version;
  const { child, ready } = await startServer(args.python);

  try {
    const results = [];
    for (const drain of [false, true]) {
      for (let run = 1; run <= args.runs; run += 1) {
        results.push(await runArm(chromium, ready, drain, run, args.settleMs));
      }
    }

    const byArm = (name) => results.filter((result) => result.arm === name);
    const allReused = (name) => byArm(name).every((result) => result.reused_from_cache);
    process.stdout.write(`${JSON.stringify({
      label: "MEASURED",
      scope: "local fixture server, loopback, one asset, one browser build",
      playwright: playwrightVersion,
      platform: `${platform()} ${release()}`,
      settle_ms: args.settleMs,
      runs_per_arm: args.runs,
      undrained_reused_every_run: allReused("UNDRAINED"),
      drained_reused_every_run: allReused("DRAINED"),
      results,
    }, null, 2)}\n`);
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
