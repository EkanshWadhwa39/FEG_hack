import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AA, checkContrast } from "../src/contrast.js";

const cssPath = new URL("../styles/player.css", import.meta.url);

const SURFACES = ["--surface-page", "--surface-panel", "--surface-inset", "--surface-raised"];
const TEXT = [
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--accent",
  "--ok",
  "--warn",
  "--danger",
];

/** Parse the `--token: #hex;` declarations out of the stylesheet. */
async function readTokens() {
  const css = await readFile(cssPath, "utf8");
  const tokens = Object.fromEntries(
    [...css.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{3,6});/gi)].map((m) => [m[1], m[2]]),
  );
  // Assert the tokens this file actually checks are present, so a renamed or
  // deleted token fails loudly instead of silently skipping its contrast check.
  for (const required of [...SURFACES, ...TEXT, "--border-control", "--focus-ring"]) {
    assert.ok(required in tokens, `missing colour token ${required} in player.css`);
  }
  return tokens;
}

test("every text token meets AA on every surface it can render on", async () => {
  const tokens = await readTokens();
  const failures = [];

  for (const surface of SURFACES) {
    for (const text of TEXT) {
      const result = checkContrast(tokens[text], tokens[surface], AA.NORMAL_TEXT);
      if (!result.passes) {
        failures.push(`${text} (${tokens[text]}) on ${surface} (${tokens[surface]}) = ${result.ratio}:1`);
      }
    }
  }

  assert.deepEqual(failures, [], `text contrast below ${AA.NORMAL_TEXT}:1`);
});

test("control borders and the focus ring meet non-text contrast on every surface", async () => {
  const tokens = await readTokens();
  const failures = [];

  for (const surface of SURFACES) {
    for (const token of ["--border-control", "--focus-ring"]) {
      const result = checkContrast(tokens[token], tokens[surface], AA.NON_TEXT);
      if (!result.passes) {
        failures.push(`${token} on ${surface} = ${result.ratio}:1`);
      }
    }
  }

  assert.deepEqual(failures, [], `non-text contrast below ${AA.NON_TEXT}:1`);
});

test("hard-coded accent pairs meet AA", async () => {
  // These pairs set both foreground and background together, so they are
  // checked as pairs rather than against the surface tokens.
  const pairs = [
    ["#a5f3fc", "#164e63", "SIMULATED label"],
    ["#fde68a", "#713f12", "UNKNOWN label"],
    ["#ecfeff", "#155e75", "primary button"],
    ["#ecfeff", "#164e63", "selected tab"],
  ];

  for (const [foreground, background, name] of pairs) {
    const result = checkContrast(foreground, background, AA.NORMAL_TEXT);
    assert.ok(result.passes, `${name} is ${result.ratio}:1, below ${AA.NORMAL_TEXT}:1`);
  }
});

test("surfaces are opaque so the tested ratios are the rendered ratios", async () => {
  const css = await readFile(cssPath, "utf8");
  const surfaceBlock = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
  // A translucent surface would composite to a colour no test ever checked.
  assert.doesNotMatch(surfaceBlock, /--surface-[a-z]+:\s*(rgba|hsla)/i);
});

test("reduced motion is honoured and leaves the state visible", async () => {
  const css = await readFile(cssPath, "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // The indeterminate pulse must stop animating but stay on screen.
  assert.match(css, /\.pulse span \{ width: 100%; animation: none; \}/);
  assert.match(css, /animation-iteration-count: 1 !important/);
});
