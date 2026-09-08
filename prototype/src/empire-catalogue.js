import { getPlayerCatalogue } from './catalogue.js';

// STATICALLY-INFERRED from this supplied executable's native stage definitions.
// Partial COMMON subset; no bootstrap relabelling, PRIMARY or SECONDARY warming.
export const EARLY_ASSETS = Object.freeze([
  ['assets/locale/en/gameContent.json', 'PRELOADER', 3997],
  ['assets/locale/en/commonContent.json', 'PRELOADER', 14865],
  ['assets/fonts/en/Mulish.ttf', 'PRELOADER', 210380],
  ['assets/images/@1x/brandLogo.png', 'PRELOADER', 10611],
  ['assets/fonts/en/NewRocker-Regular.ttf', 'COMMON', 168128],
  ['assets/fonts/en/Oswald-Bold.ttf', 'COMMON', 87600],
  ['assets/images/@1x/controlPanelPrimaryAssets.json', 'COMMON', 1633],
  ['assets/images/@1x/controlPanelPrimaryAssets.webp', 'COMMON', 26726],
].map(Object.freeze));

function frozen(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') frozen(child);
  return Object.freeze(value);
}
function exactLoopback(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== origin
      || !url.port || Number(url.port) < 1024) throw new TypeError('Explicit loopback deployment required');
  return origin;
}

/** Trusted local deployment adapter. Never derive versions from display titles.
 * Unhashed consumption paths are bound to a reviewed release by exact URL,
 * build, decoded byte size and content digest; no version query is invented.
 */
export function createEmpireSource(config, { lobbyOrigin } = {}) {
  exactLoopback(lobbyOrigin);
  if (config?.lobbyOrigin !== lobbyOrigin || config.mode !== 'PROVIDER_EARLY_ASSETS'
      || !/^[a-f0-9]{64}$/.test(config.archiveSha256)
      || config.build !== `empire-${config.archiveSha256.slice(0, 16)}`
      || config.locale !== 'en' || config.tier !== '1x' || config.byteBudget !== 10485760
      || !Array.isArray(config.entries) || config.entries.length !== 20) {
    throw new TypeError('Unreviewed provider deployment configuration');
  }
  const build = config.build;
  const origins = new Set();
  const catalogue = config.entries.map((entry, index) => {
    if (entry?.id !== `title-${String(index + 1).padStart(2, '0')}` || !Array.isArray(entry.assets)
        || entry.assets.length !== EARLY_ASSETS.length) throw new TypeError('Invalid stable instance');
    const origin = exactLoopback(entry.origin);
    if (origin === lobbyOrigin || origins.has(origin)) throw new TypeError('Distinct instance origins required');
    origins.add(origin);
    const assets = entry.assets.map((asset, i) => {
      const [path, stage, size] = EARLY_ASSETS[i];
      if (asset?.url !== `${origin}/${path}` || asset.stage !== stage || asset.estimatedBytes !== size
          || !/^[a-f0-9]{64}$/.test(asset.sha256) || asset.releaseBuild !== build) {
        throw new TypeError('Unreviewed early asset identity');
      }
      return { url: asset.url, stage, estimatedBytes: size, sha256: asset.sha256, releaseBuild: build };
    });
    return { id: entry.id, title: `Empire instance ${index + 1}`, provider: 'SpinIQ · one supplied build',
      label: 'SIMULATED', build: build, origin,
      thumbnailUrl: `${lobbyOrigin}/__vault/cover/${entry.id}.svg`,
      locales: { en: { tiers: { '1x': { assets } } } } };
  });
  frozen(catalogue);
  const byId = new Map(catalogue.map(entry => [entry.id, entry]));
  const approved = new Map(catalogue.flatMap(entry => entry.locales.en.tiers['1x'].assets.map(asset => [asset.url, asset])));
  const matchesTarget = target => byId.has(target?.id) && target.build === build && target.locale === 'en' && target.tier === '1x';
  const manifestSource = Object.freeze({
    async resolve(target, { signal } = {}) {
      if (signal?.aborted || !matchesTarget(target)) throw new TypeError('Provider variant is unresolved');
      return byId.get(target.id);
    },
    validateReleaseAsset(asset, target) {
      if (!matchesTarget(target)) return false;
      const known = approved.get(asset?.url);
      return !!known && asset.url.startsWith(`${byId.get(target.id).origin}/`)
        && ['url', 'stage', 'estimatedBytes', 'sha256', 'releaseBuild'].every(key => known[key] === asset[key]);
    },
  });
  return Object.freeze({ catalogue, manifestSource, origins: Object.freeze([...origins]),
    allowedAssetUrls: Object.freeze([...approved.keys()]), getPlayerCatalogue: () => getPlayerCatalogue(catalogue) });
}

/** Conservative support scope, not a reimplementation of provider mobile detection.
 * Normal authorized launch remains available when speculative variant support is absent.
 */
export function supportsAuditedDesktop(navigatorLike = globalThis.navigator) {
  const ua = navigatorLike?.userAgent;
  return typeof ua === 'string' && /Windows|X11|Linux|Macintosh/.test(ua)
    && !/Android|Mobile|iPhone|iPad|iPod/.test(ua)
    && navigatorLike.userAgentData?.mobile !== true
    && !(navigatorLike.platform === 'MacIntel' && navigatorLike.maxTouchPoints > 1);
}
