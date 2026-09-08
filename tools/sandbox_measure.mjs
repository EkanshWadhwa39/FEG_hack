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
 * Two milestones are reported:
 *   engine-canvas   first <canvas> inside #gameStage — the engine is rendering.
 *   assets-quiet    2s with no further response from the game origin — the
 *                   package has finished streaming. This is the one that
 *                   matches what a human watching the spinner experiences.
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
  let arms = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--runs") args.runs = Number.parseInt(argv[i + 1], 10);
    if (argv[i] === "--lobby") args.lobby = argv[i + 1];
    if (argv[i] === "--game") args.game = argv[i + 1];
    if (argv[i] === "--arms") arms = argv[i + 1]?.split(",").map((a) => a.trim());
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) {
    throw new RangeError("--runs must be a positive integer");
  }
  args.arms = arms ?? ["cold", "warm", "preinit"];
  const known = new Set(["cold", "warm", "preinit"]);
  for (const arm of args.arms) {
    if (!known.has(arm)) throw new RangeError(`unknown arm: ${arm}`);
  }
  return args;
}

/**
 * Arms, and what each one isolates.
 *
 *   cold     speculation disabled entirely. The honest baseline.
 *   warm     the ladder capped at byte warming, so the engine rung is excluded
 *            and the measured difference is attributable to bytes alone.
 *   preinit  the full ladder, including speculative engine initialisation.
 *
 * Every arm is driven through the page's own intent path — a real hover on a
 * real tile — rather than a test-only button. A number produced by a control
 * the product does not have is not evidence about the product.
 */
export const Arm = Object.freeze({
  COLD: "cold",
  WARM: "warm",
  PREINIT: "preinit",
});

async function runArm({ lobby, game, arm }) {
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
    let lastResponseAt = null;
    // Every game-origin response, whichever phase it belongs to. The browse
    // phase needs this to know when a speculative engine has stopped working.
    let lastGameResponseAt = null;
    cdp.on("Network.loadingFinished", (event) => {
      const record = requests.get(event.requestId);
      if (!record || !record.url.startsWith(game)) return;
      lastGameResponseAt = Date.now();
      if (record.phase !== "launch") return;
      lastResponseAt = Date.now();
      if (event.encodedDataLength <= 0) return;
      bytes += event.encodedDataLength;
      responses += 1;
    });

    const cap = arm === Arm.WARM ? "&maxrung=WARM" : "";
    await page.goto(`${lobby}/sandbox.html?game=${encodeURIComponent(game)}${cap}`,
      { waitUntil: "load", timeout: 30_000 });

    // The lobby only knows a title exists once its tile has rendered.
    const tile = page.locator("#grid button[data-game-id]").first();
    await tile.waitFor({ timeout: 30_000 });

    if (arm === Arm.COLD) {
      await page.check("#disable-spec");
    } else {
      // Drive the product's own intent path: rest the pointer on the tile and
      // let the ladder climb. `#override` forces the FULL governor tier, which
      // a headless loopback browser would otherwise deny for lack of a
      // plausible connection.
      await page.check("#override");
      await tile.hover();
      if (arm === Arm.WARM) {
        await page.waitForFunction(() => window.__WARM_DONE__ > 0, null, { timeout: 300_000 });
      } else {
        await page.waitForFunction(
          () => window.__SPECULATION__().preinit.state === "PREPARED",
          null,
          { timeout: 300_000 },
        );
        // The iframe `load` event is not the end of the engine's work: this
        // package keeps streaming assets well past it. Clicking at `load`
        // would measure a half-built engine and report the fast path as a
        // failure. Wait for the game origin to go quiet, which is what a
        // player who actually browsed for a few seconds would have given it.
        const browseDeadline = Date.now() + 300_000;
        while (Date.now() < browseDeadline) {
          if (lastGameResponseAt != null && Date.now() - lastGameResponseAt > 2_000) break;
          await page.waitForTimeout(250);
        }
      }
    }

    phase = "launch";
    const started = Date.now();
    await tile.click();

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

    // assets-quiet: when the game origin stopped responding for 2s.
    const quietMillis = lastResponseAt ? (lastResponseAt + 2_000) - started : null;
    return { bytes, responses, millis, quietMillis, discovered: [...discovered] };
  } finally {
    await browser.close();
  }
}


const { runs, lobby, game, arms } = parseArgs(process.argv.slice(2));
const results = new Map(arms.map((arm) => [arm, []]));

for (let run = 1; run <= runs; run += 1) {
  for (const arm of arms) {
    const result = await runArm({ lobby, game, arm });
    results.get(arm).push(result);
    console.log(
      `${arm.padEnd(8)} run ${run}  bytes=${result.bytes.toLocaleString().padStart(11)} `
      + `responses=${String(result.responses).padStart(3)} `
      + `canvas=${result.millis ?? "MISSED"}ms `
      + `assets-quiet=${result.quietMillis ?? "n/a"}ms`,
    );
  }
}

const median = (values) => {
  const sorted = [...values].filter((v) => v != null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

const summary = (arm) => {
  const armRuns = results.get(arm);
  return {
    bytes: median(armRuns.map((r) => r.bytes)),
    millis: median(armRuns.map((r) => r.millis)),
    quiet: median(armRuns.map((r) => r.quietMillis)),
  };
};

const baseline = results.has(Arm.COLD) ? summary(Arm.COLD) : null;
const relative = (value, base) =>
  (base != null && value != null ? `  (${((1 - value / base) * 100).toFixed(1)}% less)` : "");

console.log(`\n--- median of ${runs} run(s), milestone: first canvas in #gameStage ---`);
for (const arm of arms) {
  const stats = summary(arm);
  console.log(
    `${arm.padEnd(8)} launch-phase bytes=${String(stats.bytes?.toLocaleString()).padStart(11)}`
    + `${relative(stats.bytes, baseline?.bytes)}`,
  );
  console.log(
    `${"".padEnd(8)} click->canvas=${stats.millis ?? "MISSED"}ms`
    + `${relative(stats.millis, baseline?.millis)}`
    + `   click->assets-quiet=${stats.quiet ?? "n/a"}ms`,
  );
}

console.log(
  "\nMilestone is engine-canvas-present, not playable and not interactive."
  + "\nThe `warm` arm is capped at byte warming, so the engine rung is excluded"
  + "\nand its difference is attributable to bytes alone. `preinit` adds the"
  + "\nengine rung: its launch-phase bytes approach zero because the transfer"
  + "\nalready happened during browse, before the click was measured.",
);
