/** The legacy tier field describes the manifest, never an observed provider choice. */
export function empireVariantMetadata(selected, desktopSupported) {
  return {
    locale: selected.locale, tier: selected.tier, manifestTier: selected.tier,
    actualProviderTier: 'UNKNOWN',
    tierNote: 'STATICALLY-INFERRED — tier / manifestTier identify the desktop manifest, not the runtime provider tier',
    variantSupport: desktopSupported === true
      ? 'STATICALLY-INFERRED — audited desktop en / 1x'
      : 'UNKNOWN — normal launch only; no speculation or desktop early-batch milestone',
    milestone: desktopSupported === true ? 'UNKNOWN — waiting for asset bodies'
      : 'UNKNOWN — desktop early-batch milestone not applicable to mobile or unverified devices',
  };
}

/** Trusted wrapper observation validation, not a provider gameplay-ready signal.
 * Missing capability is UNKNOWN: desktop applicability must be explicit. */
export function validateEarlyBatch(data, { assets, clickedAt, now, desktopSupported = false } = {}) {
  if (desktopSupported !== true || !Array.isArray(assets) || !assets.length || !Array.isArray(data?.resources)
      || data.resources.length !== assets.length || !Number.isFinite(clickedAt) || !Number.isFinite(now) || now < clickedAt) return null;
  const valid = Array.from(data.resources).every((entry, index) => entry?.index === index
    && Number.isSafeInteger(assets[index]?.estimatedBytes) && assets[index].estimatedBytes > 0
    && Number.isSafeInteger(entry.decodedBodySize) && entry.decodedBodySize === assets[index].estimatedBytes
    && Number.isSafeInteger(entry.encodedBodySize) && entry.encodedBodySize > 0
    && Number.isSafeInteger(entry.transferSize) && entry.transferSize >= 0
    && Number.isFinite(entry.responseEndEpochMs) && entry.responseEndEpochMs >= clickedAt
    && entry.responseEndEpochMs <= now);
  if (!valid) return null;
  const completedAt = Math.max(...data.resources.map(entry => entry.responseEndEpochMs));
  return Object.freeze({
    milestone: `all ${assets.length} preregistered early provider resource responses complete`,
    clickToEarlyBatchMs: Math.round((completedAt - clickedAt) * 10) / 10,
    assetCount: assets.length,
    decodedBodyBytes: data.resources.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
    resourceTimingTransferBytes: data.resources.reduce((sum, entry) => sum + entry.transferSize, 0),
    resourceTimingEncodedBodyBytes: data.resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
    providerPlayable: 'UNKNOWN — no authoritative provider input-accepted signal',
    inputAccepted: false,
  });
}

/** Reject malformed adapter grants before an iframe exists; this is not a new authorization path. */
export function validateEmpireLaunchGrant(grant, target, expectedAssets) {
  if (grant?.status !== 'LAUNCH_AUTHORIZED' || grant.signal?.aborted !== false
      || typeof grant.signal.addEventListener !== 'function' || typeof grant.signal.removeEventListener !== 'function'
      || !['id', 'build', 'locale', 'tier'].every(key => typeof target?.[key] === 'string' && grant.plan?.[key] === target[key])
      || !Array.isArray(expectedAssets) || expectedAssets.length !== 8
      || !Array.isArray(grant.plan.assets) || grant.plan.assets.length !== expectedAssets.length) return false;
  return Array.from(grant.plan.assets).every((asset, index) => !!asset && !!expectedAssets[index]
    && ['url', 'stage', 'estimatedBytes', 'sha256', 'releaseBuild'].every(key => asset[key] === expectedAssets[index][key]));
}
