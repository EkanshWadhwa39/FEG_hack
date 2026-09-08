import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCENTS,
  accentFor,
  applyPosterFallback,
  posterBackground,
  posterDataUri,
} from "../src/poster-fallback.js";

function fakeImage() {
  const handlers = new Set();
  return {
    src: "/posters/g1.webp",
    style: {},
    dataset: {},
    addEventListener(type, handler) { if (type === "error") handlers.add(handler); },
    fail() { for (const handler of [...handlers]) handler(); },
  };
}

test("every tile has a poster even when nothing is served", () => {
  // The lobby renders as empty rectangles without this, which is what happens
  // on any server other than tools/sandbox_server.py.
  const uri = posterDataUri(0);
  assert.match(uri, /^data:image\/svg\+xml,/);
  assert.match(decodeURIComponent(uri), /<svg[^>]*viewBox="0 0 320 320"/);
});

test("posters are deterministic and distinct across the palette", () => {
  assert.equal(posterDataUri(3), posterDataUri(3));
  const distinct = new Set(Array.from({ length: ACCENTS.length }, (_, i) => posterDataUri(i)));
  assert.equal(distinct.size, ACCENTS.length);
});

test("the palette cycles, so a long catalogue never runs out", () => {
  assert.deepEqual(accentFor(0), accentFor(ACCENTS.length));
  assert.throws(() => accentFor(-1), RangeError);
  assert.throws(() => accentFor(1.5), RangeError);
});

test("a background paints before any image request resolves", () => {
  assert.match(posterBackground(2), /^radial-gradient\(/);
});

test("the fallback replaces a poster that failed and cannot loop", () => {
  const image = fakeImage();
  applyPosterFallback(image, 1);
  assert.match(image.style.background, /^radial-gradient\(/);
  assert.equal(image.src, "/posters/g1.webp", "the real poster is still preferred");

  image.fail();
  assert.match(image.src, /^data:image\/svg\+xml,/);

  // A second failure must not re-enter and rewrite src forever.
  const swapped = image.src;
  image.fail();
  assert.equal(image.src, swapped);
});

test("attaching rejects a non-element", () => {
  assert.throws(() => applyPosterFallback(null, 0), TypeError);
});
