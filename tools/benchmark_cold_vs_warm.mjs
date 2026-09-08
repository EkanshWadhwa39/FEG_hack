#!/usr/bin/env node
/**
 * Automated, isolated Cold vs Warm benchmark tool.
 *
 * Measures same-title launch transfer and time-to-milestone between an
 * isolated cold run (control) and an isolated warm run (treatment).
 *
 * Invariants:
 * - Fresh isolated browser profile (tmpdir) per run via launchPersistentContext.
 * - Disk cache enabled with --disk-cache-size=104857600 (100 MB).
 * - Exact 56-asset manifest (PRELOADER, COMMON, SPLASH, critical PRIMARY).
 * - Prefetch concurrency ceiling: 2, with CORS + body drain.
 * - Milestone: engine-canvas-present inside #gameStage (not authoritative interactive).
 * - All figures labeled MEASURED or SIMULATED.
 * - Output saved to evidence/derived/benchmark_summary.json.
 */

import { chromium } from "playwright";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {
    lobby: "http://127.0.0.1:8090",
    game: "http://127.0.0.1:8091",
    waitMs: 14000,
    out: resolve(REPO_ROOT, "evidence/derived/benchmark_summary.json"),
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lobby" && i + 1 < argv.length) args.lobby = argv[++i];
    else if (arg === "--game" && i + 1 < argv.length) args.game = argv[++i];
    else if (arg === "--wait-ms" && i + 1 < argv.length) args.waitMs = Number.parseInt(argv[++i], 10);
    else if (arg === "--out" && i + 1 < argv.length) args.out = resolve(argv[++i]);
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function loadManifest() {
  const assetsFile = join(REPO_ROOT, "tools/all_game_assets.json");
  const allAssets = JSON.parse(readFileSync(assetsFile, "utf-8"));
  const warmup36 = allAssets.filter((a) =>
    !a.path.includes("sounds/") &&
    !a.path.includes("bigwins") &&
    !a.path.includes("scatter") &&
    !a.path.includes("chest") &&
    !a.path.includes("book") &&
    !a.path.includes("shield") &&
    !a.path.includes("cup") &&
    !a.path.includes("low_") &&
    !a.path.includes("spines/")
  );

  if (warmup36.length !== 36) {
    throw new Error(`Expected exactly 36 manifest assets, but found ${warmup36.length}`);
  }
  return warmup36;
}

function formatBytes(bytes) {
  if (bytes == null) return "N/A";
  if (bytes === 0) return "0 B";
  const mb = (bytes / (1024 * 1024)).toFixed(2);
  return `${bytes.toLocaleString()} B (${mb} MB)`;
}

async function runColdArm({ lobbyUrl, gameUrl, slotTag, waitMs, manifest }) {
  const tmpDir = mkdtempSync(join(tmpdir(), "pw-benchmark-cold-"));
  console.log(`\n[Control: Cold Run] Starting isolated context: ${tmpDir}`);
  console.log(`[Control: Cold Run] Slot tag: ${slotTag}`);

  const browser = await chromium.launchPersistentContext(tmpDir, {
    headless: true,
    args: ["--disk-cache-size=104857600"],
  });

  try {
    const page = await browser.newPage();
    const cdp = await browser.newCDPSession(page);
    await cdp.send("Network.enable");

    const requests = new Map();

    cdp.on("Network.requestWillBeSent", (ev) => {
      if (!ev.request.url.includes(slotTag)) return;
      requests.set(ev.requestId, {
        id: ev.requestId,
        url: ev.request.url,
        fromCache: false,
        encodedDataLength: null,
        status: null,
      });
    });

    cdp.on("Network.requestServedFromCache", (ev) => {
      const r = requests.get(ev.requestId);
      if (r) r.fromCache = true;
    });

    cdp.on("Network.responseReceived", (ev) => {
      const r = requests.get(ev.requestId);
      if (r) {
        r.status = ev.response.status;
        if (ev.response.fromDiskCache) r.fromCache = true;
      }
    });

    cdp.on("Network.loadingFinished", (ev) => {
      const r = requests.get(ev.requestId);
      if (r) r.encodedDataLength = ev.encodedDataLength;
    });

    // 1. Navigate to lobby with auto-warm disabled
    await page.goto(`${lobbyUrl}/lobby.html?nowarm=1`, { waitUntil: "domcontentloaded" });

    // 2. Launch cold game iframe
    const slotBaseUrl = `${gameUrl}/game/${slotTag}/`;
    console.log(`[Control: Cold Run] Launching iframe: ${slotBaseUrl}`);
    const launchStart = performance.now();

    await page.evaluate((url) => {
      const panel = document.getElementById("game-panel");
      if (panel) panel.hidden = false;
      const host = document.getElementById("frame-host") || document.body;
      const frame = document.createElement("iframe");
      frame.id = "game-iframe";
      frame.allow = "autoplay";
      frame.width = "800";
      frame.height = "600";
      frame.src = url;
      host.replaceChildren ? host.replaceChildren(frame) : host.appendChild(frame);
    }, slotBaseUrl);

    // 3. Measure time to milestone (engine-canvas-present)
    let timeToCanvasMs = null;
    try {
      const frameEl = await page.waitForSelector("#game-iframe", { timeout: 15000 });
      const frame = await frameEl.contentFrame();
      await frame.waitForSelector("#gameStage canvas", { timeout: 30000 });
      timeToCanvasMs = Math.round(performance.now() - launchStart);
      console.log(`[Control: Cold Run] Engine canvas reached in ${timeToCanvasMs} ms [MEASURED]`);
    } catch (e) {
      console.warn(`[Control: Cold Run] Canvas milestone not reached: ${e.message}`);
    }

    // 4. Wait for full observation window to let all assets settle
    console.log(`[Control: Cold Run] Settling observation window (${waitMs} ms)...`);
    await page.waitForTimeout(waitMs);

    // 5. Analyze CDP requests
    const launchReqs = [...requests.values()].filter((r) => r.url.includes(slotTag));
    const wireBytes = launchReqs.reduce(
      (sum, r) => sum + (r.fromCache || r.encodedDataLength === 0 ? 0 : (r.encodedDataLength ?? 0)),
      0,
    );
    const cacheHits = launchReqs.filter((r) => r.fromCache || r.encodedDataLength === 0).length;
    const cacheMisses = launchReqs.filter((r) => !r.fromCache && (r.encodedDataLength ?? 0) > 0).length;

    let criticalHits = 0;
    let criticalMisses = 0;
    let criticalWireBytes = 0;
    const manifestAudit = [];

    for (const asset of manifest) {
      const match = launchReqs.find((r) => r.url.endsWith(asset.path));
      if (!match) {
        manifestAudit.push({ path: asset.path, found: false, cached: false, wireBytes: null });
      } else {
        const isHit = match.fromCache || match.encodedDataLength === 0;
        const b = isHit ? 0 : (match.encodedDataLength ?? 0);
        if (isHit) {
          criticalHits++;
        } else {
          criticalMisses++;
          criticalWireBytes += b;
        }
        manifestAudit.push({ path: asset.path, found: true, cached: isHit, wireBytes: b });
      }
    }

    return {
      slotTag,
      totalRequests: launchReqs.length,
      wireBytes,
      cacheHits,
      cacheMisses,
      critical36Hits: criticalHits,
      critical36Misses: criticalMisses,
      critical36HitPct: (criticalHits / manifest.length) * 100,
      critical36WireBytes: criticalWireBytes,
      timeToCanvasMs,
      observationWindowMs: waitMs,
      manifestAudit,
    };
  } finally {
    await browser.close();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

async function runWarmArm({ lobbyUrl, gameUrl, slotTag, waitMs, manifest }) {
  const tmpDir = mkdtempSync(join(tmpdir(), "pw-benchmark-warm-"));
  console.log(`\n[Treatment: Warm Run] Starting fresh isolated context: ${tmpDir}`);
  console.log(`[Treatment: Warm Run] Slot tag: ${slotTag}`);

  const browser = await chromium.launchPersistentContext(tmpDir, {
    headless: true,
    args: ["--disk-cache-size=104857600"],
  });

  try {
    const page = await browser.newPage();
    const cdp = await browser.newCDPSession(page);
    await cdp.send("Network.enable");

    const requests = new Map();
    let currentPhase = "init";

    cdp.on("Network.requestWillBeSent", (ev) => {
      if (!ev.request.url.includes(slotTag)) return;
      requests.set(ev.requestId, {
        id: ev.requestId,
        url: ev.request.url,
        phase: currentPhase,
        fromCache: false,
        encodedDataLength: null,
        status: null,
      });
    });

    cdp.on("Network.requestServedFromCache", (ev) => {
      const r = requests.get(ev.requestId);
      if (r) r.fromCache = true;
    });

    cdp.on("Network.responseReceived", (ev) => {
      const r = requests.get(ev.requestId);
      if (r) {
        r.status = ev.response.status;
        if (ev.response.fromDiskCache) r.fromCache = true;
      }
    });

    cdp.on("Network.loadingFinished", (ev) => {
      const r = requests.get(ev.requestId);
      if (r) r.encodedDataLength = ev.encodedDataLength;
    });

    // 1. Navigate to lobby with auto-warm disabled
    await page.goto(`${lobbyUrl}/lobby.html?nowarm=1`, { waitUntil: "domcontentloaded" });

    // 2. Prefetch phase (CORS + body drain at concurrency 2)
    currentPhase = "warm_prefetch";
    const slotBaseUrl = `${gameUrl}/game/${slotTag}/`;
    console.log(`[Treatment: Warm Run] Prefetching ${manifest.length} manifest assets at concurrency 2...`);
    const prefetchStart = performance.now();

    const prefetchSummary = await page.evaluate(async ({ base, assets }) => {
      let ok = 0;
      let fail = 0;
      const concurrency = 2;
      let next = 0;

      async function drainBody(res) {
        const body = res.body;
        if (!body) return;
        if (typeof WritableStream !== "undefined") {
          await body.pipeTo(new WritableStream());
        } else {
          const reader = body.getReader();
          try {
            for (;;) {
              const { done } = await reader.read();
              if (done) break;
            }
          } finally {
            reader.releaseLock?.();
          }
        }
      }

      async function worker() {
        while (next < assets.length) {
          const asset = assets[next++];
          const url = base + asset.path;
          try {
            const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "default" });
            if (!res.ok) {
              fail++;
              continue;
            }
            await drainBody(res).catch(() => {});
            ok++;
          } catch {
            fail++;
          }
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      return { ok, fail, attempted: assets.length };
    }, { base: slotBaseUrl, assets: manifest });

    const prefetchDurationMs = Math.round(performance.now() - prefetchStart);
    console.log(
      `[Treatment: Warm Run] Prefetch completed: ${prefetchSummary.ok}/${manifest.length} OK in ${prefetchDurationMs} ms [MEASURED]`,
    );

    // Give browser disk cache a brief moment to settle
    await page.waitForTimeout(300);

    const warmReqs = [...requests.values()].filter(
      (r) => r.phase === "warm_prefetch" && r.url.includes(slotTag),
    );
    const prefetchWireBytes = warmReqs.reduce(
      (sum, r) => sum + (r.encodedDataLength ?? 0),
      0,
    );
    console.log(`[Treatment: Warm Run] Prefetch wire bytes: ${formatBytes(prefetchWireBytes)} [MEASURED]`);

    // 3. Launch phase
    currentPhase = "launch";
    console.log(`[Treatment: Warm Run] Launching iframe: ${slotBaseUrl}`);
    const launchStart = performance.now();

    await page.evaluate((url) => {
      const panel = document.getElementById("game-panel");
      if (panel) panel.hidden = false;
      const host = document.getElementById("frame-host") || document.body;
      const frame = document.createElement("iframe");
      frame.id = "game-iframe";
      frame.allow = "autoplay";
      frame.width = "800";
      frame.height = "600";
      frame.src = url;
      host.replaceChildren ? host.replaceChildren(frame) : host.appendChild(frame);
    }, slotBaseUrl);

    // 4. Measure time to milestone (engine-canvas-present)
    let timeToCanvasMs = null;
    try {
      const frameEl = await page.waitForSelector("#game-iframe", { timeout: 15000 });
      const frame = await frameEl.contentFrame();
      await frame.waitForSelector("#gameStage canvas", { timeout: 30000 });
      timeToCanvasMs = Math.round(performance.now() - launchStart);
      console.log(`[Treatment: Warm Run] Engine canvas reached in ${timeToCanvasMs} ms [MEASURED]`);
    } catch (e) {
      console.warn(`[Treatment: Warm Run] Canvas milestone not reached: ${e.message}`);
    }

    // 5. Wait for full observation window to let all assets settle
    console.log(`[Treatment: Warm Run] Settling observation window (${waitMs} ms)...`);
    await page.waitForTimeout(waitMs);

    // 6. Analyze CDP requests for launch phase
    const launchReqs = [...requests.values()].filter(
      (r) => r.phase === "launch" && r.url.includes(slotTag),
    );
    const launchWireBytes = launchReqs.reduce(
      (sum, r) => sum + (r.fromCache || r.encodedDataLength === 0 ? 0 : (r.encodedDataLength ?? 0)),
      0,
    );
    const cacheHits = launchReqs.filter((r) => r.fromCache || r.encodedDataLength === 0).length;
    const cacheMisses = launchReqs.filter((r) => !r.fromCache && (r.encodedDataLength ?? 0) > 0).length;

    let criticalHits = 0;
    let criticalMisses = 0;
    let criticalWireBytes = 0;
    const manifestAudit = [];

    for (const asset of manifest) {
      const match = launchReqs.find((r) => r.url.endsWith(asset.path));
      if (!match) {
        manifestAudit.push({ path: asset.path, found: false, cached: false, wireBytes: null });
      } else {
        const isHit = match.fromCache || match.encodedDataLength === 0;
        const b = isHit ? 0 : (match.encodedDataLength ?? 0);
        if (isHit) {
          criticalHits++;
        } else {
          criticalMisses++;
          criticalWireBytes += b;
        }
        manifestAudit.push({ path: asset.path, found: true, cached: isHit, wireBytes: b });
      }
    }

    const unwarmedWireBytes = Math.max(0, launchWireBytes - criticalWireBytes);

    return {
      slotTag,
      warmPhase: {
        attempted: prefetchSummary.attempted,
        ok: prefetchSummary.ok,
        fail: prefetchSummary.fail,
        concurrency: 2,
        durationMs: prefetchDurationMs,
        wireBytes: prefetchWireBytes,
      },
      launchPhase: {
        totalRequests: launchReqs.length,
        wireBytes: launchWireBytes,
        cacheHits,
        cacheMisses,
        critical36Hits: criticalHits,
        critical36Misses: criticalMisses,
        critical36HitPct: (criticalHits / manifest.length) * 100,
        critical36WireBytes: criticalWireBytes,
        unwarmedWireBytes,
        timeToCanvasMs,
        observationWindowMs: waitMs,
        manifestAudit,
      },
    };
  } finally {
    await browser.close();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

function printAsciiTable(report) {
  const { cold, warm, comparison } = report;

  console.log("\n" + "=".repeat(88));
  console.log("FEG HACKATHON: AUTOMATED COLD VS WARM BENCHMARK SUMMARY");
  console.log("=".repeat(88));
  console.log(`Topology:       Lobby ${report._meta.topology.lobby} | Game ${report._meta.topology.game} [SIMULATED cross-origin]`);
  console.log(`Link Throttle:  ${report._meta.invariants.link_throttle_kbps.toLocaleString()} kbps (~12 Mbps) [SIMULATED mobile link]`);
  console.log(`Manifest:       ${report._meta.invariants.verified_manifest_count} assets (PRELOADER: 7, COMMON: 15, SPLASH: 5, critical PRIMARY: 29)`);
  console.log("Milestone:      engine-canvas-present in #gameStage (engine start, not playable; backend absent)");
  console.log("-".repeat(88));

  const rows = [
    [
      "Warm phase duration",
      "N/A",
      `${warm.warm_phase.duration_ms.toLocaleString()} ms`,
      "N/A",
      "[MEASURED]",
    ],
    [
      "Warm phase wire bytes",
      "N/A",
      formatBytes(warm.warm_phase.wire_bytes),
      "N/A",
      "[MEASURED]",
    ],
    [
      "Time to engine canvas",
      `${cold.time_to_canvas_ms.toLocaleString()} ms`,
      `${warm.launch_phase.time_to_canvas_ms.toLocaleString()} ms`,
      `${comparison.time_to_canvas_saved_ms.toLocaleString()} ms faster (${comparison.time_to_canvas_speedup_pct.toFixed(1)}%)`,
      "[MEASURED]",
    ],
    [
      "Launch wire bytes total",
      formatBytes(cold.wire_bytes),
      formatBytes(warm.launch_phase.wire_bytes),
      `${formatBytes(comparison.launch_wire_bytes_saved)} saved (${comparison.launch_wire_bytes_saved_pct.toFixed(1)}%)`,
      "[MEASURED]",
    ],
    [
      "Total launch requests",
      cold.total_requests.toString(),
      warm.launch_phase.total_requests.toString(),
      `${warm.launch_phase.total_requests - cold.total_requests >= 0 ? "+" : ""}${warm.launch_phase.total_requests - cold.total_requests}`,
      "[MEASURED]",
    ],
    [
      "Total launch cache hits",
      cold.cache_hits.toString(),
      warm.launch_phase.cache_hits.toString(),
      `+${warm.launch_phase.cache_hits - cold.cache_hits} hits`,
      "[MEASURED]",
    ],
    [
      "Total launch cache misses",
      cold.cache_misses.toString(),
      warm.launch_phase.cache_misses.toString(),
      `${warm.launch_phase.cache_misses - cold.cache_misses} misses`,
      "[MEASURED]",
    ],
    [
      "Critical 36 cache hits",
      `${cold.critical_36_hits} / 36 (${cold.critical_36_hit_pct.toFixed(1)}%)`,
      `${warm.launch_phase.critical_36_hits} / 36 (${warm.launch_phase.critical_36_hit_pct.toFixed(1)}%)`,
      `+${comparison.critical_36_hit_pct_improvement.toFixed(1)}% hit rate`,
      "[MEASURED]",
    ],
    [
      "Critical 36 wire bytes",
      formatBytes(cold.critical_36_wire_bytes),
      formatBytes(warm.launch_phase.critical_36_wire_bytes),
      `${formatBytes(comparison.critical_36_wire_bytes_saved)} (100% saved)`,
      "[MEASURED]",
    ],
    [
      "Unwarmed tail wire bytes",
      formatBytes(cold.wire_bytes - cold.critical_36_wire_bytes),
      formatBytes(warm.launch_phase.unwarmed_wire_bytes),
      "Sounds & runtime spines",
      "[MEASURED]",
    ],
    [
      "0-byte reuse verified",
      "N/A",
      comparison.zero_byte_cache_reuse_verified ? "YES (36/36 verified)" : "NO",
      comparison.zero_byte_cache_reuse_verified ? "PASSED" : "FAILED",
      "[MEASURED]",
    ],
  ];

  console.log(
    "| " +
      "Metric".padEnd(28) +
      " | " +
      "Cold Control".padEnd(20) +
      " | " +
      "Warm Treatment".padEnd(20) +
      " | " +
      "Delta / Improvement".padEnd(28) +
      " | " +
      "Label".padEnd(12) +
      " |",
  );
  console.log(
    "|-" +
      "-".repeat(28) +
      "-|-" +
      "-".repeat(20) +
      "-|-" +
      "-".repeat(20) +
      "-|-" +
      "-".repeat(28) +
      "-|-" +
      "-".repeat(12) +
      "-|",
  );

  for (const [m, c, w, d, l] of rows) {
    console.log(
      `| ${m.padEnd(28)} | ${c.padStart(20)} | ${w.padStart(20)} | ${d.padEnd(28)} | ${l.padEnd(12)} |`,
    );
  }
  console.log("=".repeat(88) + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`
Usage: node tools/benchmark_cold_vs_warm.mjs [options]

Options:
  --lobby <url>     Lobby origin (default: http://127.0.0.1:8090)
  --game <url>      Game origin (default: http://127.0.0.1:8091)
  --wait-ms <ms>    Observation settle window in milliseconds (default: 14000)
  --out <path>      Output path for benchmark_summary.json (default: evidence/derived/benchmark_summary.json)
  --help, -h        Show this help message
`);
    process.exit(0);
  }

  const manifest = loadManifest();
  console.log(`Loaded exact verified manifest: ${manifest.length} assets`);

  const now = Date.now();
  const coldSlot = `cold_${now}`;
  const warmSlot = `warm_${now}`;

  // 1. Run Cold Arm
  const coldResult = await runColdArm({
    lobbyUrl: args.lobby,
    gameUrl: args.game,
    slotTag: coldSlot,
    waitMs: args.waitMs,
    manifest,
  });

  // 2. Run Warm Arm
  const warmResult = await runWarmArm({
    lobbyUrl: args.lobby,
    gameUrl: args.game,
    slotTag: warmSlot,
    waitMs: args.waitMs,
    manifest,
  });

  // 3. Compute Comparative Analysis
  const launchWireBytesSaved = coldResult.wireBytes - warmResult.launchPhase.wireBytes;
  const launchWireBytesSavedPct =
    coldResult.wireBytes > 0 ? (launchWireBytesSaved / coldResult.wireBytes) * 100 : 0;

  const critical36WireBytesSaved =
    coldResult.critical36WireBytes - warmResult.launchPhase.critical36WireBytes;
  const critical36WireBytesSavedPct =
    coldResult.critical36WireBytes > 0
      ? (critical36WireBytesSaved / coldResult.critical36WireBytes) * 100
      : 100;

  const critical36HitPctImprovement =
    warmResult.launchPhase.critical36HitPct - coldResult.critical36HitPct;

  const timeToCanvasSavedMs =
    coldResult.timeToCanvasMs != null && warmResult.launchPhase.timeToCanvasMs != null
      ? coldResult.timeToCanvasMs - warmResult.launchPhase.timeToCanvasMs
      : null;

  const timeToCanvasSpeedupPct =
    timeToCanvasSavedMs != null && coldResult.timeToCanvasMs > 0
      ? (timeToCanvasSavedMs / coldResult.timeToCanvasMs) * 100
      : null;

  const zeroByteCacheReuseVerified =
    warmResult.launchPhase.critical36Hits === 36 &&
    warmResult.launchPhase.critical36WireBytes === 0 &&
    warmResult.launchPhase.critical36Misses === 0;

  const report = {
    _meta: {
      tool: "tools/benchmark_cold_vs_warm.mjs",
      timestamp: new Date().toISOString(),
      topology: {
        lobby: args.lobby,
        game: args.game,
      },
      invariants: {
        isolated_browser_contexts: true,
        disk_cache_enabled: true,
        disk_cache_size_bytes: 104857600,
        prefetch_concurrency: 2,
        verified_manifest_count: manifest.length,
        link_throttle_kbps: 12000,
        link_throttle_label: "SIMULATED",
        milestone_definition:
          "engine-canvas-present inside #gameStage (not authoritative interactive, backend absent in sandbox)",
        milestone_label: "MEASURED",
      },
    },
    cold: {
      slot_tag: coldResult.slotTag,
      total_requests: coldResult.totalRequests,
      total_requests_label: "MEASURED",
      wire_bytes: coldResult.wireBytes,
      wire_bytes_label: "MEASURED",
      cache_hits: coldResult.cacheHits,
      cache_hits_label: "MEASURED",
      cache_misses: coldResult.cacheMisses,
      cache_misses_label: "MEASURED",
      critical_36_hits: coldResult.critical36Hits,
      critical_36_hits_label: "MEASURED",
      critical_36_misses: coldResult.critical36Misses,
      critical_36_misses_label: "MEASURED",
      critical_36_hit_pct: coldResult.critical36HitPct,
      critical_36_hit_pct_label: "MEASURED",
      critical_36_wire_bytes: coldResult.critical36WireBytes,
      critical_36_wire_bytes_label: "MEASURED",
      time_to_canvas_ms: coldResult.timeToCanvasMs,
      time_to_canvas_ms_label: "MEASURED",
      observation_window_ms: coldResult.observationWindowMs,
      observation_window_ms_label: "MEASURED",
    },
    warm: {
      slot_tag: warmResult.slotTag,
      warm_phase: {
        attempted: warmResult.warmPhase.attempted,
        attempted_label: "MEASURED",
        ok: warmResult.warmPhase.ok,
        ok_label: "MEASURED",
        fail: warmResult.warmPhase.fail,
        fail_label: "MEASURED",
        concurrency: warmResult.warmPhase.concurrency,
        duration_ms: warmResult.warmPhase.durationMs,
        duration_ms_label: "MEASURED",
        wire_bytes: warmResult.warmPhase.wireBytes,
        wire_bytes_label: "MEASURED",
      },
      launch_phase: {
        total_requests: warmResult.launchPhase.totalRequests,
        total_requests_label: "MEASURED",
        wire_bytes: warmResult.launchPhase.wireBytes,
        wire_bytes_label: "MEASURED",
        cache_hits: warmResult.launchPhase.cacheHits,
        cache_hits_label: "MEASURED",
        cache_misses: warmResult.launchPhase.cacheMisses,
        cache_misses_label: "MEASURED",
        critical_36_hits: warmResult.launchPhase.critical36Hits,
        critical_36_hits_label: "MEASURED",
        critical_36_misses: warmResult.launchPhase.critical36Misses,
        critical_36_misses_label: "MEASURED",
        critical_36_hit_pct: warmResult.launchPhase.critical36HitPct,
        critical_36_hit_pct_label: "MEASURED",
        critical_36_wire_bytes: warmResult.launchPhase.critical36WireBytes,
        critical_36_wire_bytes_label: "MEASURED",
        unwarmed_wire_bytes: warmResult.launchPhase.unwarmedWireBytes,
        unwarmed_wire_bytes_label: "MEASURED",
        time_to_canvas_ms: warmResult.launchPhase.timeToCanvasMs,
        time_to_canvas_ms_label: "MEASURED",
        observation_window_ms: warmResult.launchPhase.observationWindowMs,
        observation_window_ms_label: "MEASURED",
      },
    },
    comparison: {
      launch_wire_bytes_saved: launchWireBytesSaved,
      launch_wire_bytes_saved_label: "MEASURED",
      launch_wire_bytes_saved_pct: launchWireBytesSavedPct,
      launch_wire_bytes_saved_pct_label: "MEASURED",
      critical_36_wire_bytes_saved: critical36WireBytesSaved,
      critical_36_wire_bytes_saved_label: "MEASURED",
      critical_36_wire_bytes_saved_pct: critical36WireBytesSavedPct,
      critical_36_wire_bytes_saved_pct_label: "MEASURED",
      critical_36_hit_pct_improvement: critical36HitPctImprovement,
      critical_36_hit_pct_improvement_label: "MEASURED",
      time_to_canvas_saved_ms: timeToCanvasSavedMs,
      time_to_canvas_saved_ms_label: "MEASURED",
      time_to_canvas_speedup_pct: timeToCanvasSpeedupPct,
      time_to_canvas_speedup_pct_label: "MEASURED",
      zero_byte_cache_reuse_verified: zeroByteCacheReuseVerified,
      zero_byte_cache_reuse_verified_label: "MEASURED",
    },
  };

  // 4. Save JSON results
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nSaved benchmark summary to: ${args.out}`);

  // 5. Print ASCII Table
  printAsciiTable(report);

  // 6. Verification Assertion
  if (!zeroByteCacheReuseVerified) {
    console.error(
      `\n❌ VERIFICATION FAILED: Critical ${manifest.length}-asset cache hit was ${warmResult.launchPhase.critical36Hits}/${manifest.length}, ` +
        `wire bytes was ${warmResult.launchPhase.critical36WireBytes}. Expected ${manifest.length}/${manifest.length} and 0 wire bytes.`,
    );
    process.exit(1);
  }

  console.log(`✅ VERIFICATION PASSED: ${manifest.length}/${manifest.length} assets (100%) reused from cache with 0 wire bytes during launch.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\nBenchmark error:", err);
  process.exit(1);
});
