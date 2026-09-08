/**
 * A poster that always exists.
 *
 * The lobby's real posters are generated from the FEG-provided package by
 * `tools/sandbox_server.py` at startup and served from `/posters/gN.webp`. Any
 * other way of opening the page — `python -m http.server`, `scripts/serve.sh`,
 * a static file host, a copy of `prototype/` on its own — has no such route,
 * every poster 404s, and the lobby renders as a grid of empty rectangles.
 *
 * That is exactly what it looked like the first time someone opened it on the
 * wrong port, and "the demo looks broken unless you started the right server"
 * is not an acceptable property for the thing you show a judge.
 *
 * So every tile also has a poster drawn here, in the page, from nothing but its
 * index: a deterministic SVG emblem on a graded ground, in the same palette the
 * generated posters use. It is used as the tile's background immediately and as
 * the `src` if the real poster fails to load. When the sandbox server *is*
 * running, the package-derived artwork loads over the top and this is never
 * seen.
 *
 * It is deliberately abstract. A fallback that imitated real game art would be
 * inventing a product; these are plainly stylised marks that stand in for one.
 */

/** Same palette as `tools/poster_builder.py`, so the two sets look related. */
export const ACCENTS = Object.freeze([
  [212, 160, 23],   // gold
  [176, 38, 42],    // crimson
  [28, 122, 138],   // teal
  [108, 58, 168],   // violet
  [30, 122, 58],    // emerald
  [198, 96, 24],    // amber
  [36, 82, 178],    // PSK blue
  [168, 44, 120],   // magenta
]);

/** Emblem outlines on a 100x100 box, centred. */
const EMBLEMS = Object.freeze([
  // hexagon
  "M50 8 L86 29 L86 71 L50 92 L14 71 L14 29 Z",
  // shield
  "M50 8 L88 22 V56 C88 76 70 88 50 94 C30 88 12 76 12 56 V22 Z",
  // diamond
  "M50 6 L94 50 L50 94 L6 50 Z",
  // rounded square, rotated
  "M50 10 L90 50 L50 90 L10 50 Z M50 24 L76 50 L50 76 L24 50 Z",
  // eight-point star
  "M50 4 L61 32 L89 21 L78 49 L96 50 L78 51 L89 79 L61 68 L50 96 L39 68 L11 79 L22 51 L4 50 L22 49 L11 21 L39 32 Z",
  // ring
  "M50 6 A44 44 0 1 1 49.9 6 Z M50 26 A24 24 0 1 0 50.1 26 Z",
]);

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));

function shade([r, g, b], amount) {
  return amount >= 0
    ? `rgb(${clamp(r + (255 - r) * amount)},${clamp(g + (255 - g) * amount)},${clamp(b + (255 - b) * amount)})`
    : `rgb(${clamp(r * (1 + amount))},${clamp(g * (1 + amount))},${clamp(b * (1 + amount))})`;
}

/** The accent this index gets, matching the generated posters' cycle. */
export function accentFor(index) {
  if (!Number.isInteger(index) || index < 0) throw new RangeError("index must be a non-negative integer");
  return ACCENTS[index % ACCENTS.length];
}

/**
 * A CSS background for the tile, applied immediately.
 *
 * This paints before any image request resolves, so a tile is never a grey
 * rectangle even for the moment its poster is in flight.
 */
export function posterBackground(index) {
  const accent = accentFor(index);
  return `radial-gradient(circle at 50% 38%, ${shade(accent, 0.18)} 0%, `
    + `${shade(accent, -0.45)} 55%, ${shade(accent, -0.78)} 100%)`;
}

/**
 * A complete poster as an SVG data URI.
 *
 * Kept small enough to sit in an attribute without bloating the document, and
 * deterministic so a reload never reshuffles the lobby.
 */
export function posterDataUri(index) {
  const accent = accentFor(index);
  const emblem = EMBLEMS[index % EMBLEMS.length];
  const light = shade(accent, 0.22);
  const mid = shade(accent, -0.4);
  const dark = shade(accent, -0.8);
  const gold = shade([214, 172, 70], 0.05);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320">`
    + `<defs>`
    + `<radialGradient id="g" cx="50%" cy="38%" r="72%">`
    + `<stop offset="0" stop-color="${light}"/>`
    + `<stop offset="0.55" stop-color="${mid}"/>`
    + `<stop offset="1" stop-color="${dark}"/>`
    + `</radialGradient>`
    + `<linearGradient id="e" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${shade(accent, 0.42)}"/>`
    + `<stop offset="1" stop-color="${shade(accent, -0.25)}"/>`
    + `</linearGradient>`
    + `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0.45" stop-color="rgb(8,8,12)" stop-opacity="0"/>`
    + `<stop offset="1" stop-color="rgb(8,8,12)" stop-opacity="0.82"/>`
    + `</linearGradient>`
    + `</defs>`
    + `<rect width="320" height="320" fill="url(#g)"/>`
    // Faint rays, so the ground has some structure rather than being flat.
    + `<g opacity="0.13" fill="#fff">`
    + `<path d="M160 122 L214 -40 L106 -40 Z"/><path d="M160 122 L300 40 L246 -18 Z"/>`
    + `<path d="M160 122 L20 40 L74 -18 Z"/>`
    + `</g>`
    + `<g transform="translate(160 128) scale(1.05) translate(-50 -50)">`
    + `<path d="${emblem}" fill="url(#e)" stroke="${gold}" stroke-width="4"`
    + ` stroke-linejoin="round"/>`
    + `</g>`
    + `<rect width="320" height="320" fill="url(#s)"/>`
    + `</svg>`;

  // encodeURIComponent rather than base64: smaller for SVG, and no btoa
  // dependency, which matters because this must work in any context.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Attach the fallback to a poster image.
 *
 * The background paints straight away; the data URI is swapped in only if the
 * real poster fails, so the package-derived artwork always wins when it exists.
 */
export function applyPosterFallback(image, index) {
  if (image == null || typeof image.addEventListener !== "function") {
    throw new TypeError("image must be an element");
  }
  if (image.style) image.style.background = posterBackground(index);
  image.addEventListener("error", () => {
    // Guard against a loop if the data URI itself somehow fails.
    if (image.dataset && image.dataset.posterFallback === "applied") return;
    if (image.dataset) image.dataset.posterFallback = "applied";
    image.src = posterDataUri(index);
  }, { once: false });
  return image;
}
