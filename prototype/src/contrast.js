/**
 * WCAG 2.1 contrast maths, kept pure so the accessibility claims in this
 * prototype are computed and testable rather than eyeballed.
 *
 * Reference: WCAG 2.1 SC 1.4.3 (Contrast Minimum, AA) and SC 1.4.11
 * (Non-text Contrast). This module makes no DOM or browser assumptions.
 */

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Minimum ratios required by WCAG 2.1 level AA. */
export const AA = Object.freeze({
  NORMAL_TEXT: 4.5,
  LARGE_TEXT: 3,
  NON_TEXT: 3,
});

/**
 * Parse `#rgb` or `#rrggbb` into 0-255 channels. Throws on anything else so a
 * malformed token fails a test instead of silently scoring as passing.
 */
export function parseHex(value) {
  if (typeof value !== "string") throw new TypeError("colour must be a string");
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) throw new TypeError(`unsupported colour: ${value}`);

  const digits = match[1].length === 3
    ? match[1].split("").map((digit) => digit + digit).join("")
    : match[1];

  return Object.freeze({
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  });
}

function channelLuminance(channel) {
  const ratio = channel / 255;
  return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB colour. */
export function relativeLuminance(colour) {
  const { r, g, b } = typeof colour === "string" ? parseHex(colour) : colour;
  for (const channel of [r, g, b]) {
    if (!Number.isFinite(channel) || channel < 0 || channel > 255) {
      throw new RangeError("channels must be finite values within 0-255");
    }
  }
  return (
    0.2126 * channelLuminance(r)
    + 0.7152 * channelLuminance(g)
    + 0.0722 * channelLuminance(b)
  );
}

/** Contrast ratio between two colours, always >= 1 and <= 21. */
export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Evaluate a pair against a required ratio. `ratio` is rounded down to two
 * decimals so a value that only passes through float noise is not reported as
 * passing.
 */
export function checkContrast(foreground, background, required = AA.NORMAL_TEXT) {
  if (!Number.isFinite(required) || required <= 0) {
    throw new RangeError("required ratio must be a positive finite number");
  }
  const ratio = Math.floor(contrastRatio(foreground, background) * 100) / 100;
  return Object.freeze({
    foreground,
    background,
    ratio,
    required,
    passes: ratio >= required,
  });
}
