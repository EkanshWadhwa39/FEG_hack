export const PROACTIVE_STAGES = Object.freeze([
  "PRELOADER",
  "COMMON",
  "SPLASH",
  "PRIMARY",
]);

const proactiveStages = new Set(PROACTIVE_STAGES);

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requireRecord(value, name) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

/**
 * Resolve one exact locale and tier. It does not normalize or fall back because
 * a fallback could warm the wrong browser cache keys.
 */
export function resolveManifest(manifest, { locale, tier } = {}) {
  requireRecord(manifest, "manifest");
  if (typeof locale !== "string" || locale.length === 0) {
    throw new TypeError("locale must be an exact non-empty string");
  }
  if (typeof tier !== "string" || tier.length === 0) {
    throw new TypeError("tier must be an exact non-empty string");
  }

  const locales = requireRecord(manifest.locales, "manifest.locales");
  if (!own(locales, locale)) throw new RangeError(`unsupported locale: ${locale}`);

  const localeBranch = requireRecord(locales[locale], `locale ${locale}`);
  const tiers = requireRecord(localeBranch.tiers, `locale ${locale}.tiers`);
  if (!own(tiers, tier)) throw new RangeError(`unsupported tier: ${tier}`);

  const branch = requireRecord(tiers[tier], `tier ${tier}`);
  if (!Array.isArray(branch.assets)) throw new TypeError("tier assets must be an array");

  const assets = branch.assets.map((asset, index) => {
    requireRecord(asset, `asset ${index}`);
    if (typeof asset.url !== "string" || asset.url.length === 0) {
      throw new TypeError(`asset ${index} requires an exact URL`);
    }
    if (typeof asset.stage !== "string") {
      throw new TypeError(`asset ${index} requires a stage`);
    }
    if (!Number.isFinite(asset.estimatedBytes) || asset.estimatedBytes < 0) {
      throw new TypeError(`asset ${index} requires non-negative estimatedBytes`);
    }
    return Object.freeze({ ...asset });
  }).filter((asset) => {
    if (!proactiveStages.has(asset.stage)) return false;
    return asset.stage !== "PRIMARY" || asset.critical === true;
  });

  return Object.freeze({
    locale,
    tier,
    assets: Object.freeze(assets),
  });
}
