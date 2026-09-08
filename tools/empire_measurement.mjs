/** Pure, redacted measurement helpers. No provider data, browser or server. */
export function totals(snapshot, titleIndex) {
  const buckets = titleIndex === undefined ? snapshot.instances : [snapshot.instances[titleIndex]];
  return buckets.reduce((sum, b) => ({ requests: sum.requests + b.requests, bodyBytes: sum.bodyBytes + b.bodyBytes,
    earlyRequests: sum.earlyRequests + b.earlyRequests.reduce((a, n) => a + n, 0),
    earlyBodyBytes: sum.earlyBodyBytes + b.earlyBodyBytes.reduce((a, n) => a + n, 0) }),
  { requests: 0, bodyBytes: 0, earlyRequests: 0, earlyBodyBytes: 0 });
}
export function delta(before, after, titleIndex) {
  const a = totals(before, titleIndex), b = totals(after, titleIndex);
  return Object.fromEntries(Object.keys(a).map(key => [key, b[key] - a[key]]));
}
export function timingQuality({ observedBrowsingMs, dwellMs, observationOverrunMs, snapshotToClickMs,
  toleranceMs = 250, sampleToleranceMs = 100 }) {
  return [observedBrowsingMs, dwellMs, observationOverrunMs, snapshotToClickMs].every(Number.isFinite)
    && Math.abs(observedBrowsingMs - dwellMs) <= toleranceMs
    && snapshotToClickMs >= 0 && snapshotToClickMs <= toleranceMs
    && observationOverrunMs >= 0 && observationOverrunMs <= sampleToleranceMs ? 'PASS' : 'OUTSIDE_TOLERANCE';
}
export function summarizePairs(pairs) {
  const observations = pairs.map(pair => {
    const c = pair.CONTROL?.measurement?.clickToEarlyBatchMs;
    const t = pair.TREATMENT?.measurement?.clickToEarlyBatchMs;
    return ['CONTROL', 'TREATMENT'].every(arm => pair[arm]?.status === 'COMPLETE_EARLY_BATCH'
      && pair[arm].timingQuality === 'PASS' && pair[arm].proofVerdict === 'PASS')
      && Number.isFinite(c) && Number.isFinite(t) && c > 0 && t >= 0 ?
      { pair: pair.run, controlMs: c, treatmentMs: t, savedMs: c - t, reductionPercent: 100 * (c - t) / c } : null;
  }).filter(Boolean);
  const stats = key => {
    const numbers = observations.map(row => row[key]).sort((a, b) => a - b);
    const n = numbers.length;
    return n ? { median: n % 2 ? numbers[(n - 1) / 2] : (numbers[n / 2 - 1] + numbers[n / 2]) / 2,
      min: numbers[0], max: numbers[n - 1] } : null;
  };
  return { attemptedPairs: pairs.length, completePairs: observations.length, observations,
    controlMs: stats('controlMs'), treatmentMs: stats('treatmentMs'), pairedSavedMs: stats('savedMs'),
    pairedReductionPercent: stats('reductionPercent'),
    warning: 'Local early-response completion only; negative values are regressions. Conditional on complete proof-qualified pairs within preregistered timing tolerances; all other attempts retained. Not gameplay readiness or production effect.' };
}
export function cacheEvidence(events, titleIndex, expectedAssets) {
  const launch = events.filter(e => e.phase === 'LAUNCH' && e.documentRole === 'PROVIDER' && e.titleIndex === titleIndex);
  return Array.from({ length: expectedAssets }, (_, assetIndex) => {
    const matches = launch.filter(e => e.assetIndex === assetIndex);
    return { assetIndex, observedResponses: matches.length,
      browserCacheAttributed: matches.some(e => e.status === 200 && !e.failed && (e.diskCache || e.memoryCache || e.prefetchCache)),
      statuses: matches.map(e => e.status) };
  });
}
export function networkBatch(events, { titleIndex, expectedAssets, clickedAtEpochMs, cutoffEpochMs }) {
  const inWindow = events.filter(e => e.phase === 'LAUNCH' && e.documentRole === 'PROVIDER' && e.titleIndex === titleIndex
    && Number.isFinite(e.startedEpochMs) && e.startedEpochMs >= clickedAtEpochMs && e.startedEpochMs <= cutoffEpochMs);
  const matched = Array.from({ length: expectedAssets }, (_, index) => {
    const candidates = inWindow.filter(e => e.assetIndex === index);
    if (candidates.length !== 1) return null;
    const e = candidates[0];
    return e.status === 200 && !e.failed && Number.isFinite(e.finishedEpochMs)
      && e.finishedEpochMs >= e.startedEpochMs && e.finishedEpochMs <= cutoffEpochMs ? e : null;
  });
  const complete = Number.isSafeInteger(expectedAssets) && expectedAssets > 0
    && Number.isFinite(clickedAtEpochMs) && Number.isFinite(cutoffEpochMs)
    && cutoffEpochMs >= clickedAtEpochMs && matched.every(Boolean);
  return { classification: 'MEASURED', milestone: complete ? 'all exact early Network.loadingFinished events inside the observation window' : 'UNKNOWN — early batch incomplete or ambiguous inside the observation window',
    observationSource: 'Chromium CDP provider-document network completion, independent of renderer polling',
    assetCount: matched.filter(Boolean).length,
    ...(complete ? { clickToEarlyBatchMs: Math.round((Math.max(...matched.map(e => e.finishedEpochMs)) - clickedAtEpochMs) * 10) / 10 } : {}),
    providerPlayable: 'UNKNOWN — no authoritative input-accepted signal', inputAccepted: false };
}
/** Required proof is transfer/cache reuse, not a positive timing improvement. */
export function proofVerdict(record, { expectedAssets = 8, expectedBytes = 523940 } = {}) {
  if (record.status === 'ERROR') return 'FAIL';
  if (record.status === 'PASS') {
    if (record.name === 'fail-closed') return record.traffic?.requests === 0 ? 'PASS' : 'FAIL';
    if (record.name === 'live-revocation') return record.providerEarlyAssetsBeforeRevocation === expectedAssets
      && record.revokedIframeRemoved === true && record.postRevocationRequests === 0
      && Number.isFinite(record.settlingWindowMs) && record.settlingWindowMs >= 2000
      && record.settlingWindowMs <= 2250 ? 'PASS' : 'FAIL';
    return 'INCONCLUSIVE';
  }
  if (record.status !== 'COMPLETE_EARLY_BATCH' || record.timingQuality !== 'PASS') return 'INCONCLUSIVE';
  // HAR presence alone is insufficient: all launch entries and exact complete
  // candidate preparation must survive, with no other pre-click provider loading.
  if (!record.harCoverage || !record.redactedHarCoverage) return 'INCONCLUSIVE';
  if (record.harCoverage.status !== 'PASS' || record.redactedHarCoverage.status !== 'PASS') return 'FAIL';
  const intendedTitles = record.arm === 'TREATMENT' ? (record.name === 'keyboard-intent' ? 1 : 3) : 0;
  const intendedRequests = intendedTitles * expectedAssets, intendedBytes = intendedTitles * expectedBytes;
  if (record.preparation?.requests !== intendedRequests || record.preparation?.earlyRequests !== intendedRequests
      || record.preparation?.bodyBytes !== intendedBytes || record.preparation?.earlyBodyBytes !== intendedBytes) return 'FAIL';
  if (intendedTitles && record.intendedPreparationCompleted !== true) return 'FAIL';
  const cache = record.earlyAssetCacheEvidence;
  if (!Array.isArray(cache) || cache.length !== expectedAssets || cache.some(e => e.observedResponses !== 1)) return 'INCONCLUSIVE';
  const cold = record.selectedLaunch?.earlyRequests === expectedAssets
    && record.selectedLaunch?.earlyBodyBytes === expectedBytes && cache.every(e => !e.browserCacheAttributed);
  if (record.name === 'wrong-title') return record.selectedPreparation?.earlyRequests === 0 && cold ? 'PASS' : 'FAIL';
  if (record.cachePolicy === 'no-store') return record.selectedPreparation?.earlyRequests === expectedAssets
    && record.selectedPreparation?.earlyBodyBytes === expectedBytes && record.preparationCompletedBeforeClick === true && cold ? 'PASS' : 'FAIL';
  if (record.arm === 'CONTROL') return record.preparation?.requests === 0 && cold ? 'PASS' : 'FAIL';
  return record.exactEarlyReuseObserved === true ? 'PASS' : 'FAIL';
}

/** Exact document identity, not a mutable runner phase, separates lobby warming. */
export function documentRole(url, providerOrigin, lobbyOrigin) {
  if (url === `${providerOrigin}/?language=en`) return 'PROVIDER';
  if (url === `${lobbyOrigin}/`) return 'LOBBY';
  return 'OTHER';
}
export function preparationComplete(events, { titleIndex, expectedAssets, clickedAtEpochMs }) {
  if (!Number.isSafeInteger(expectedAssets) || expectedAssets < 1 || expectedAssets > 160 || !Number.isFinite(clickedAtEpochMs)) return false;
  return Array.from({ length: expectedAssets }, (_, index) => {
    const matches = events.filter(e => e.documentRole === 'LOBBY' && e.phase === 'BROWSING'
      && e.titleIndex === titleIndex && e.assetIndex === index);
    return matches.length === 1 && matches[0].status === 200 && !matches[0].failed
      && Number.isFinite(matches[0].startedEpochMs) && Number.isFinite(matches[0].finishedEpochMs)
      && matches[0].finishedEpochMs >= matches[0].startedEpochMs && matches[0].finishedEpochMs <= clickedAtEpochMs;
  }).every(Boolean);
}
export function experimentVerdict(evidence, { runs, diagnosticsRequired = true }) {
  const pairs = evidence.pairs ?? [], diagnostics = evidence.diagnostics ?? [];
  const arms = pairs.flatMap(p => [p.CONTROL, p.TREATMENT]);
  if ([...arms, ...diagnostics].some(a => a?.status === 'ERROR' || a?.proofVerdict === 'FAIL')) return 'FAIL';
  if (!Number.isSafeInteger(runs) || runs < 1 || pairs.length !== runs
      || arms.some(a => a?.proofVerdict !== 'PASS')) return 'INCONCLUSIVE';
  if (diagnosticsRequired && ['wrong-title', 'no-store', 'keyboard-intent', 'fail-closed', 'live-revocation']
    .some(name => diagnostics.filter(d => d.name === name && d.proofVerdict === 'PASS').length !== 1)) return 'INCONCLUSIVE';
  return 'PASS';
}
