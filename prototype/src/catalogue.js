import { PLAYER_VISIBLE_FIELDS } from "./drawer.js";

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") deepFreeze(child);
  }
  return Object.freeze(value);
}

function requireOrigin(origin) {
  const message = "Explicit credential-free HTTPS or HTTP loopback origin required";
  if (typeof origin !== "string") throw new TypeError(message);
  let url;
  try { url = new URL(origin); } catch { throw new TypeError(message); }
  const loopback = url.hostname === "localhost" || url.hostname === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
      || (origin !== url.origin && origin !== `${url.origin}/`)) {
    throw new TypeError(message);
  }
  return url.origin;
}

/** Synthetic fixture identities only; no provider assets or real catalogue data. */
export function createSyntheticCatalogue({ origin } = {}) {
  const base = requireOrigin(origin);
  const build = "synthetic-v1";
  return deepFreeze(Array.from({ length: 20 }, (_, index) => {
    const id = `title-${String(index + 1).padStart(2, "0")}`;
    const prefix = `${base}/synthetic/${id}/${build}`;
    const locales = Object.fromEntries(["hr-HR", "en"].map(locale => [locale, {
      tiers: Object.fromEntries(["1x", "0.5x"].map(tier => [tier, {
        assets: [
          ["preloader", 16384], ["common", 32768], ["splash", 65536],
        ].map(([kind, estimatedBytes]) => ({
          url: `${prefix}/${locale}/${tier}/${kind}.bin?v=1`,
          stage: kind.toUpperCase(), estimatedBytes, version: "1",
        })),
      }])),
    }]));
    return {
      id, title: `Synthetic Title ${String(index + 1).padStart(2, "0")}`,
      provider: "Synthetic Provider", label: "SIMULATED", build,
      thumbnailUrl: `${prefix}/thumbnail.svg?v=1`, locales,
    };
  }));
}

/** Same fixed ordering, drawer whitelist only. Policy metadata cannot cross. */
export function getPlayerCatalogue(catalogue) {
  return deepFreeze(catalogue.map(entry => Object.fromEntries(
    PLAYER_VISIBLE_FIELDS.map(field => [field, entry[field]]),
  )));
}
