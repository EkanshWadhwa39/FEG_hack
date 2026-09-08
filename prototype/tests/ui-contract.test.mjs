import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("simulated warming UI exposes an explicit accessible lifecycle", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const main = await readFile(new URL("src/main.js", root), "utf8");

  assert.match(html, /<button id="run-warming" type="button">Run simulated warming<\/button>/);
  assert.match(html, /id="warming-card" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /<time id="ist-clock" aria-label="Current India Standard Time">/);
  assert.match(html, /India Standard Time · <span class="label measured">MEASURED<\/span>/);
  assert.match(html, /NOT RUN · SIMULATED/);
  assert.match(main, /startIstClock\(clockElement\)/);
  assert.match(main, /RUNNING · SIMULATED/);
  assert.match(main, /COMPLETE · SIMULATED/);
  assert.match(main, /GOVERNOR BLOCKED · SIMULATED/);
  assert.match(main, /simulated successes/);
  assert.match(main, /target: DEMO_SELECTION/);
});

test("simulated execution path contains no browser request primitive", async () => {
  const sources = await Promise.all([
    readFile(new URL("src/main.js", root), "utf8"),
    readFile(new URL("src/simulation.js", root), "utf8"),
  ]);
  const executionSource = sources.join("\n");

  assert.doesNotMatch(executionSource, /\bfetch\s*\(/);
  assert.doesNotMatch(executionSource, /\bXMLHttpRequest\b/);
  assert.doesNotMatch(executionSource, /new\s+(?:Image|WebSocket|EventSource)\b/);
  assert.doesNotMatch(executionSource, /createElement\s*\(\s*["'](?:iframe|img|link|script)["']/i);
});
