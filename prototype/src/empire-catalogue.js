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

export const REVIEWED_EMPIRE_ARCHIVE_SHA256 = 'f0b4947f9d703af9c99419418293ac518189afe3c8dabfc9781f9558a9dacdba';
export const LOCAL_MODE = 'PROVIDER_EARLY_ASSETS';
export const CDN_MODE = 'PROVIDER_EARLY_ASSETS_CDN_ONE_TITLE';

function frozen(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') frozen(child);
  return Object.freeze(value);
}
function parsedExactOrigin(origin) {
  if (typeof origin !== 'string' || !origin || origin.trim() !== origin || origin.includes('\\')) throw new TypeError('Exact deployment origin required');
  let url;
  try { url = new URL(origin); } catch { throw new TypeError('Exact deployment origin required'); }
  if (url.origin !== origin || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('Exact deployment origin required');
  return url;
}
function exactLoopback(origin) {
  const url = parsedExactOrigin(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1024) {
    throw new TypeError('Explicit loopback deployment required');
  }
  return origin;
}
function exactLobbyOrigin(origin) {
  const url = parsedExactOrigin(origin);
  const local = url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new TypeError('Exact HTTPS or loopback lobby origin required');
  return origin;
}
function exactHttpsOrigin(origin) {
  const url = parsedExactOrigin(origin);
  if (url.protocol !== 'https:') throw new TypeError('Explicit HTTPS CDN origin required');
  return origin;
}
function commonConfiguration(config, lobbyOrigin) {
  if (config?.lobbyOrigin !== lobbyOrigin || !/^[a-f0-9]{64}$/.test(config.archiveSha256)
      || config.build !== `empire-${config.archiveSha256.slice(0, 16)}`
      || config.locale !== 'en' || config.tier !== '1x' || config.byteBudget !== 10485760
      || !Array.isArray(config.entries)) throw new TypeError('Unreviewed provider deployment configuration');
  return config.build;
}

/** Trusted deployment adapter. Local catalogue and one-title CDN are deliberately
 * separate modes so enabling HTTPS cannot relax the loopback trust boundary.
 */
export function createEmpireSource(config, { lobbyOrigin } = {}) {
  const local = config?.mode === LOCAL_MODE;
  const cdn = config?.mode === CDN_MODE;
  if (!local && !cdn) throw new TypeError('Unreviewed provider deployment configuration');
  if (local) exactLoopback(lobbyOrigin); else exactLobbyOrigin(lobbyOrigin);
  const build = commonConfiguration(config, lobbyOrigin);
  if (local && config.entries.length !== 20) throw new TypeError('Unreviewed provider deployment configuration');
  if (cdn && (config.entries.length !== 1 || config.archiveSha256 !== REVIEWED_EMPIRE_ARCHIVE_SHA256
      || config.delivery !== 'CDN' || config.cachePolicy !== 'public, max-age=31536000, immutable')) {
    throw new TypeError('Unreviewed CDN deployment configuration');
  }
  const origins = new Set();
  const catalogue = config.entries.map((entry, index) => {
    if (entry?.id !== `title-${String(index + 1).padStart(2, '0')}` || !Array.isArray(entry.assets)
        || entry.assets.length !== EARLY_ASSETS.length) throw new TypeError('Invalid stable instance');
    const origin = local ? exactLoopback(entry.origin) : exactHttpsOrigin(entry.origin);
    if (origin === lobbyOrigin || origins.has(origin)) throw new TypeError('Distinct instance origins required');
    origins.add(origin);
    let wrapperUrl, launchUrl, assetBaseUrl;
    if (local) {
      wrapperUrl = `${origin}/__vault/player.html`;
      launchUrl = `${origin}/?language=en`;
      assetBaseUrl = `${origin}/`;
    } else {
      assetBaseUrl = `${origin}/releases/${config.archiveSha256}/`;
      wrapperUrl = `${origin}/__vault/player.html`;
      launchUrl = `${assetBaseUrl}index.html?language=en`;
      if (entry.delivery !== 'CDN' || entry.wrapperUrl !== wrapperUrl || entry.launchUrl !== launchUrl
          || entry.assetBaseUrl !== assetBaseUrl) throw new TypeError('Unreviewed CDN launch identity');
    }
    const assets = entry.assets.map((asset, i) => {
      const [path, stage, size] = EARLY_ASSETS[i];
      if (asset?.url !== `${assetBaseUrl}${path}` || asset.stage !== stage || asset.estimatedBytes !== size
          || !/^[a-f0-9]{64}$/.test(asset.sha256) || asset.releaseBuild !== build) {
        throw new TypeError('Unreviewed early asset identity');
      }
      return { url: asset.url, stage, estimatedBytes: size, sha256: asset.sha256, releaseBuild: build };
    });
    return { id: entry.id, title: `Empire instance ${index + 1}`, provider: 'SpinIQ · one supplied build',
      label: 'SIMULATED', build, origin, wrapperUrl, launchUrl, assetBaseUrl,
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
      const entry = byId.get(target.id), known = approved.get(asset?.url);
      return !!known && asset.url.startsWith(entry.assetBaseUrl)
        && ['url', 'stage', 'estimatedBytes', 'sha256', 'releaseBuild'].every(key => known[key] === asset[key]);
    },
  });
  return Object.freeze({ catalogue, manifestSource, deployment: local ? 'LOCAL_CATALOGUE' : 'CDN_ONE_TITLE',
    origins: Object.freeze([...origins]), allowedAssetUrls: Object.freeze([...approved.keys()]),
    getPlayerCatalogue: () => getPlayerCatalogue(catalogue) });
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
