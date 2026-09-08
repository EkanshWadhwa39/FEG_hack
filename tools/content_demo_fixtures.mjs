import { createHash } from "node:crypto";

// ORIGINAL SIMULATED content, byte-for-byte counterpart of content_server.py.
// These fixtures do not establish provider readiness or production cache policy.
export const TITLE_IDS = Object.freeze(Array.from({ length: 20 }, (_, i) =>
  `title-${String(i + 1).padStart(2, "0")}`));
export const BUILD = "synthetic-v1";
export const LOCALES = Object.freeze(["hr-HR", "en"]);
export const TIERS = Object.freeze(["1x", "0.5x"]);
export const ASSET_SIZES = Object.freeze({ preloader: 16384, common: 32768, splash: 65536 });
export const IMMUTABLE = "public, max-age=3600, immutable";

export function fixtureManifest(titleId, locale = "hr-HR", tier = "1x") {
  if (!TITLE_IDS.includes(titleId) || !LOCALES.includes(locale) || !TIERS.includes(tier)) {
    throw new TypeError("unknown synthetic identity, locale or tier");
  }
  const base = `/synthetic/${titleId}/${BUILD}`;
  return {
    classification: "SIMULATED", id: titleId, build: BUILD, locale, tier,
    thumbnail: `${base}/thumbnail.svg?v=1`,
    assets: Object.entries(ASSET_SIZES).map(([type, bytes]) => ({
      type, url: `${base}/${locale}/${tier}/${type}.bin?v=1`, bytes,
    })),
  };
}

export function thumbnailSvg(titleId) {
  if (!TITLE_IDS.includes(titleId)) throw new TypeError("unknown synthetic identity");
  const digits = titleId.slice(-2);
  const color = `#${((Number(digits) * 731791) % 0x1000000).toString(16).padStart(6, "0")}`;
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" '
    + `viewBox="0 0 128 96" role="img" aria-label="SIMULATED title ${digits}">`
    + `<title>SIMULATED title ${digits}</title>`
    + `<rect width="128" height="96" rx="8" fill="${color}"/>`
    + '<circle cx="64" cy="34" r="25" fill="white"/>'
    + '<text x="64" y="42" text-anchor="middle" font-size="24" fill="black">'
    + `${digits}</text><rect y="68" width="128" height="28" fill="white"/>`
    + '<text x="64" y="86" text-anchor="middle" font-size="12" fill="black">'
    + 'SIMULATED</text></svg>', "utf8");
}

// Match the entire original target, not a decoded/normalized URL or query map.
export function resolveSyntheticFixture(target) {
  if (typeof target !== "string" || target.length > 256) return null;
  const thumbnail = /^\/synthetic\/(title-(?:0[1-9]|1[0-9]|20))\/synthetic-v1\/thumbnail\.svg\?v=1$/.exec(target);
  if (thumbnail && thumbnail[0] === target) {
    return { title: thumbnail[1], kind: "thumbnail", contentType: "image/svg+xml",
      body: thumbnailSvg(thumbnail[1]) };
  }
  const asset = /^\/synthetic\/(title-(?:0[1-9]|1[0-9]|20))\/synthetic-v1\/(hr-HR|en)\/(1x|0\.5x)\/(preloader|common|splash)\.bin\?v=1$/.exec(target);
  if (!asset || asset[0] !== target) return null;
  const kind = asset[4];
  // hashlib.shake_256(seed).digest(size) in the existing Python fixture host.
  const body = createHash("shake256", { outputLength: ASSET_SIZES[kind] })
    .update(`SIMULATED original fixture|${target}`, "utf8").digest();
  return { title: asset[1], kind, contentType: "application/octet-stream", body };
}
