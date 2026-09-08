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

/** Strict content-loading interface layered on the original locale/tier resolver.
 * A source adapter provides exact immutable version metadata; never infer a build,
 * locale, tier, version or URL from a display name or the browser defaults.
 */
export function resolvePreparationIdentity(manifest, target, { validateUrl, validateReleaseAsset } = {}) {
  requireRecord(target, "target");
  target = Object.freeze({ ...target });
  for (const key of ["id", "build", "locale", "tier"]) {
    if (typeof target[key] !== "string" || !target[key] || /[{}\s]/.test(target[key])) {
      throw new TypeError(`unresolved target ${key}`);
    }
  }
  if (manifest?.id !== target.id || manifest?.build !== target.build) {
    throw new RangeError("title/build identity mismatch");
  }
  // Trusted callbacks see the fixed identity validated above.
  const plan = resolveManifest(manifest, target);
  if (!plan.assets.length) throw new RangeError("no eligible startup assets");
  const seen = new Set();
  let reservedBytes = 0;
  for (const asset of plan.assets) {
    if (/[{}]/.test(asset.url) || !Number.isSafeInteger(asset.estimatedBytes) || asset.estimatedBytes <= 0) {
      throw new TypeError("unresolved asset identity or body bound");
    }
    reservedBytes += asset.estimatedBytes;
    if (!Number.isSafeInteger(reservedBytes)) throw new RangeError("aggregate body reservation exceeds safe integer bounds");
    const url = new URL(asset.url);
    // Exact immutable version contract. A real adapter may supply content-hash
    // identity instead of a query; validate it explicitly, not by guessing.
    const versionKey = asset.versionKey ?? "v";
    const exactQuery = typeof versionKey === "string" && url.searchParams.getAll(versionKey).length === 1
      && url.searchParams.get(versionKey) === asset.version;
    // Vite's supplied build uses URL-safe mixed-case eight-character tokens,
    // not hex hashes. Match an exact path component or final filename suffix;
    // never append a query or rewrite an unchanged provider consumption URL.
    const exactPathHash = asset.versionInPath === true && typeof asset.version === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(asset.version)
      && (url.pathname.split("/").includes(asset.version)
        || new RegExp(`[-.]${asset.version.replaceAll("-", "\\-")}\\.[A-Za-z0-9]+$`).test(url.pathname));
    const releaseIdentity = own(asset, "releaseBuild") || own(asset, "sha256");
    if (releaseIdentity) {
      // Unhashed provider paths stay unchanged. Only a trusted, injected release
      // mapping can approve them; neither a JSON flag nor a hash is authority.
      // Release-tagged metadata cannot escape this check by adding ?v= metadata.
      if (typeof asset.sha256 !== "string" || asset.sha256.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(asset.sha256)
          || asset.releaseBuild !== target.build || typeof validateReleaseAsset !== "function") {
        throw new TypeError("unresolved trusted release identity");
      }
      let approved = false;
      try {
        const verdict = validateReleaseAsset(asset, target);
        approved = verdict === true;
        // Async validation is NOT this synchronous contract; suppress an invalid
        // callback's late rejection, but never accept its eventual value.
        if (verdict && typeof verdict.then === "function") Promise.resolve(verdict).catch(() => {});
      } catch { /* Callback failure is not authorization. */ }
      if (!approved) throw new TypeError("unresolved trusted release identity");
    } else if (typeof asset.version !== "string" || !asset.version
        || !(asset.versionInPath === true ? exactPathHash : exactQuery)) {
      throw new TypeError("unresolved versioned URL");
    }
    if (seen.has(asset.url)) throw new RangeError("duplicate exact asset URL");
    seen.add(asset.url);
    if (typeof validateUrl !== "function") throw new TypeError("URL validation boundary required");
    const verdict = validateUrl(asset.url);
    // Preserve synchronous throw-to-reject validators (void), literal true, and
    // the existing requester API returning the unchanged exact URL. A Promise,
    // truthy object or rewritten URL is never approval at this sync boundary.
    if (verdict && typeof verdict.then === "function") Promise.resolve(verdict).catch(() => {});
    if (verdict !== undefined && verdict !== true && verdict !== asset.url) {
      throw new RangeError("asset URL is not approved synchronously and exactly");
    }
  }
  return Object.freeze({ ...plan, id: target.id, build: target.build });
}
