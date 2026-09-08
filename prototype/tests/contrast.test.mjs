import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AA,
  checkContrast,
  contrastRatio,
  parseHex,
  relativeLuminance,
} from "../src/contrast.js";

const root = new URL("../", import.meta.url);

test("parseHex accepts short and long form and rejects anything else", () => {
  assert.deepEqual({ ...parseHex("#fff") }, { r: 255, g: 255, b: 255 });
  assert.deepEqual({ ...parseHex("0a0f19") }, { r: 10, g: 15, b: 25 });
  for (const bad of ["", "#gg0000", "#12345", "rgb(0,0,0)", null, 42]) {
    assert.throws(() => parseHex(bad), TypeError);
  }
});

test("relative luminance matches the WCAG anchors", () => {
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#ffffff"), 1);
  assert.throws(() => relativeLuminance({ r: 300, g: 0, b: 0 }), RangeError);
});

test("contrast ratio reproduces published WCAG reference values", () => {
  assert.equal(contrastRatio("#000000", "#ffffff").toFixed(2), "21.00");
  // #767676 is the canonical smallest grey passing AA on white.
  assert.equal(contrastRatio("#767676", "#ffffff").toFixed(2), "4.54");
  assert.equal(contrastRatio("#777777", "#ffffff").toFixed(2), "4.48");
  // Order must not matter.
  assert.equal(
    contrastRatio("#0a0f19", "#cbd5e1"),
    contrastRatio("#cbd5e1", "#0a0f19"),
  );
});

test("checkContrast rounds down so float noise cannot report a pass", () => {
  const result = checkContrast("#767676", "#ffffff", AA.NORMAL_TEXT);
  assert.equal(result.passes, true);
  assert.equal(result.required, AA.NORMAL_TEXT);
  assert.equal(checkContrast("#777777", "#ffffff", AA.NORMAL_TEXT).passes, false);
  assert.throws(() => checkContrast("#000", "#fff", 0), RangeError);
});

test("interactive control borders in app.css meet SC 1.4.11 non-text contrast", async () => {
  const css = await readFile(new URL("styles/app.css", root), "utf8");
  // The page, panel, and inset surfaces these controls are drawn on.
  const surfaces = ["#080b12", "#0c121d", "#0b101b"];

  // Boundaries of interactive controls, which SC 1.4.11 requires at 3:1.
  const controlBorders = [...css.matchAll(/border:\s*1px solid (#[0-9a-f]{6});/gi)]
    .map((match) => match[1].toLowerCase())
    .filter((colour) => colour === "#64748b");

  assert.ok(
    controlBorders.length >= 2,
    "expected the toggle/field and select control borders to use the AA-checked value",
  );
  for (const colour of controlBorders) {
    for (const surface of surfaces) {
      const result = checkContrast(colour, surface, AA.NON_TEXT);
      assert.ok(
        result.passes,
        `${colour} on ${surface} is ${result.ratio}:1, below ${AA.NON_TEXT}:1`,
      );
    }
  }
});
