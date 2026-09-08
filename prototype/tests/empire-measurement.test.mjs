import test from 'node:test';
import assert from 'node:assert/strict';
import { delta, cacheEvidence, summarizePairs, networkBatch, timingQuality, proofVerdict } from '../../tools/empire_measurement.mjs';
const snapshot = n => ({ instances: [{ requests: n + 1, bodyBytes: n * 10, earlyRequests: [n, 0], earlyBodyBytes: [n * 3, 0] },
  { requests: 2 * n, bodyBytes: 100 * n, earlyRequests: [n, n], earlyBodyBytes: [10 * n, 10 * n] }] });
test('measurement keeps selected early assets separate from all-session provider costs', () => {
  assert.deepEqual(delta(snapshot(0), snapshot(2), 0), { requests: 2, bodyBytes: 20, earlyRequests: 2, earlyBodyBytes: 6 });
  assert.deepEqual(delta(snapshot(0), snapshot(2)), { requests: 6, bodyBytes: 220, earlyRequests: 6, earlyBodyBytes: 46 });
});
test('cache evidence requires the selected title post-click browser attribution; no cache from zero size alone', () => {
  const events = [{ phase: 'BROWSING', titleIndex: 0, assetIndex: 0, diskCache: true, status: 200 },
    { phase: 'LAUNCH', titleIndex: 1, assetIndex: 1, diskCache: true, status: 200 },
    { phase: 'LAUNCH', documentRole: 'PROVIDER', titleIndex: 0, assetIndex: 1, memoryCache: true, status: 200 }];
  assert.deepEqual(cacheEvidence(events, 0, 2), [
    { assetIndex: 0, observedResponses: 0, browserCacheAttributed: false, statuses: [] },
    { assetIndex: 1, observedResponses: 1, browserCacheAttributed: true, statuses: [200] },
  ]);
});
test('paired statistics retain regressions and count incomplete attempts, without fabricating missing times', () => {
  const arm = ms => ({ status: 'COMPLETE_EARLY_BATCH', timingQuality: 'PASS', proofVerdict: 'PASS',
    measurement: { clickToEarlyBatchMs: ms } });
  const result = summarizePairs([{ run: 1, CONTROL: arm(100), TREATMENT: arm(120) },
    { run: 2, CONTROL: arm(100), TREATMENT: arm(80) }, { run: 3, CONTROL: arm(100) }]);
  assert.equal(result.attemptedPairs, 3); assert.equal(result.completePairs, 2);
  assert.deepEqual(result.pairedSavedMs, { median: 0, min: -20, max: 20 });
  assert.equal(result.pairedReductionPercent.median, 0);
  assert.equal(summarizePairs([]).pairedSavedMs, null);
});

const event = (index, extra = {}) => ({ phase: 'LAUNCH', documentRole: 'PROVIDER', titleIndex: 0,
  assetIndex: index, status: 200, startedEpochMs: 101 + index, finishedEpochMs: 110 + index, ...extra });
const limits = { titleIndex: 0, expectedAssets: 2, clickedAtEpochMs: 100, cutoffEpochMs: 200 };
test('network milestone is exact completed provider batch, never input', () => {
  const m = networkBatch([event(0), event(1)], limits);
  assert.equal(m.assetCount, 2); assert.equal(m.clickToEarlyBatchMs, 11); assert.equal(m.inputAccepted, false);
});
for (const [name, events] of [
  ['preclick', [event(0, { startedEpochMs: 99 }), event(1)]],
  ['missing', [event(0)]], ['failed', [event(0, { failed: true }), event(1)]],
  ['HTTP error', [event(0, { status: 404 }), event(1)]],
  ['missing finish', [event(0, { finishedEpochMs: undefined }), event(1)]],
  ['overrun', [event(0, { finishedEpochMs: 201 }), event(1)]],
  ['wrong title', [event(0, { titleIndex: 1 }), event(1)]],
  ['wrong document', [event(0, { documentRole: 'LOBBY' }), event(1)]],
  ['duplicate', [event(0), event(0), event(1)]],
  ['backwards', [event(0, { finishedEpochMs: 100 }), event(1)]],
]) test(`network batch excludes ${name}`, () => {
  const m = networkBatch(events, limits); assert.equal(m.clickToEarlyBatchMs, undefined); assert.ok(m.assetCount < 2);
});
test('non-provider cache flags never qualify; failed and zero-transfer responses not hits', () => {
  const m = cacheEvidence([event(0, { documentRole: 'LOBBY', memoryCache: true }),
    event(1, { failed: true, diskCache: true }), event(2, { transferSize: 0 })], 0, 3);
  assert.ok(m.every(e => !e.browserCacheAttributed));
});
const quality = { observedBrowsingMs: 3005, dwellMs: 3000, observationOverrunMs: 1, snapshotToClickMs: 3 };
test('preregistered timing tolerances reject late, missing and backwards measurements', () => {
  assert.equal(timingQuality(quality), 'PASS');
  for (const extra of [{ observedBrowsingMs: 3251 }, { observedBrowsingMs: 2749 },
    { observationOverrunMs: 101 }, { snapshotToClickMs: 251 }, { snapshotToClickMs: -1 }, { dwellMs: NaN }]) {
    assert.equal(timingQuality({ ...quality, ...extra }), 'OUTSIDE_TOLERANCE');
  }
});
const qualified = ms => ({ status: 'COMPLETE_EARLY_BATCH', timingQuality: 'PASS', proofVerdict: 'PASS', measurement: { clickToEarlyBatchMs: ms } });
test('ERROR, incomplete, failed proof and out-of-tolerance arms cannot retain stale success in statistics', () => {
  for (const extra of [{ status: 'ERROR' }, { status: 'UNKNOWN_EARLY_BATCH' }, { timingQuality: 'OUTSIDE_TOLERANCE' }, { proofVerdict: 'FAIL' }]) {
    const p = { CONTROL: qualified(100), TREATMENT: { ...qualified(20), ...extra } };
    assert.equal(summarizePairs([p]).completePairs, 0);
  }
});
const cold = () => ({ name: 'pair-1-CONTROL', arm: 'CONTROL', cachePolicy: 'cache', status: 'COMPLETE_EARLY_BATCH',
  timingQuality: 'PASS', harCoverage: { status: 'PASS' }, redactedHarCoverage: { status: 'PASS' },
  preparation: { requests: 0, earlyRequests: 0, bodyBytes: 0, earlyBodyBytes: 0 },
  selectedPreparation: { earlyRequests: 0 }, selectedLaunch: { earlyRequests: 8, earlyBodyBytes: 523940 },
  earlyAssetCacheEvidence: Array.from({ length: 8 }, () => ({ observedResponses: 1, browserCacheAttributed: false })) });
const treatment = () => ({ ...cold(), name: 'pair-1-TREATMENT', arm: 'TREATMENT',
  preparation: { requests: 24, earlyRequests: 24, bodyBytes: 1571820, earlyBodyBytes: 1571820 },
  selectedPreparation: { earlyRequests: 8, earlyBodyBytes: 523940 }, intendedPreparationCompleted: true });
test('control gate requires real cold transfer without cache attribution', () => {
  assert.equal(proofVerdict(cold()), 'PASS');
  assert.equal(proofVerdict({ ...cold(), selectedLaunch: { earlyRequests: 8, earlyBodyBytes: 0 } }), 'FAIL');
  assert.equal(proofVerdict({ ...cold(), preparation: { requests: 1 } }), 'FAIL');
});
test('treatment requires actual exact reuse; unknown batches never pass', () => {
  assert.equal(proofVerdict(treatment()), 'FAIL');
  assert.equal(proofVerdict({ ...treatment(), exactEarlyReuseObserved: true }), 'PASS');
  assert.equal(proofVerdict({ ...treatment(), status: 'UNKNOWN_EARLY_BATCH' }), 'INCONCLUSIVE');
  assert.equal(proofVerdict({ ...treatment(), status: 'ERROR', exactEarlyReuseObserved: true }), 'FAIL');
});
test('wrong-title and no-store require negative-control outcomes not just a completed batch', () => {
  const wrongTitle = { ...treatment(), name: 'wrong-title', selectedPreparation: { earlyRequests: 0 } };
  assert.equal(proofVerdict(wrongTitle), 'PASS');
  assert.equal(proofVerdict({ ...wrongTitle, selectedPreparation: { earlyRequests: 8 } }), 'FAIL');
  const noStore = { ...treatment(), cachePolicy: 'no-store', preparationCompletedBeforeClick: true };
  assert.equal(proofVerdict(noStore), 'PASS');
  assert.equal(proofVerdict({ ...noStore, preparationCompletedBeforeClick: false }), 'FAIL');
});

import { documentRole, preparationComplete, experimentVerdict } from '../../tools/empire_measurement.mjs';
test('document attribution is exact and never infers provider from an asset URL', () => {
  const role = url => documentRole(url, 'http://127.0.0.1:8101', 'http://127.0.0.1:8100');
  assert.equal(role('http://127.0.0.1:8101/?language=en'), 'PROVIDER');
  assert.equal(role('http://127.0.0.1:8100/'), 'LOBBY');
  for (const url of ['http://127.0.0.1:8101/', 'http://127.0.0.1:8101/__vault/player.html', undefined]) assert.equal(role(url), 'OTHER');
});
test('preparation must complete fully in lobby before actual click', () => {
  const es = [event(0), event(1)].map(e => ({ ...e, phase: 'BROWSING', documentRole: 'LOBBY' }));
  const bounds = { ...limits, clickedAtEpochMs: 120 };
  assert.equal(preparationComplete(es, bounds), true);
  for (const change of [{ finishedEpochMs: 121 }, { failed: true }, { documentRole: 'PROVIDER' }, { finishedEpochMs: undefined }]) {
    assert.equal(preparationComplete([{ ...es[0], ...change }, es[1]], bounds), false);
  }
  assert.equal(preparationComplete([...es, es[0]], bounds), false);
});
test('experiment requires every planned pair AND all five diagnostics; no speedup requirement', () => {
  const evidence = { pairs: [{ CONTROL: qualified(100), TREATMENT: qualified(120) }],
    diagnostics: ['wrong-title', 'no-store', 'keyboard-intent', 'fail-closed', 'live-revocation'].map(name => ({ name, proofVerdict: 'PASS' })) };
  assert.equal(experimentVerdict(evidence, { runs: 1 }), 'PASS');
  assert.equal(experimentVerdict({ ...evidence, diagnostics: [] }, { runs: 1 }), 'INCONCLUSIVE');
  assert.equal(experimentVerdict(evidence, { runs: 2 }), 'INCONCLUSIVE');
  assert.equal(experimentVerdict({ ...evidence, pairs: [{ CONTROL: qualified(100) }] }, { runs: 1 }), 'INCONCLUSIVE');
  assert.equal(experimentVerdict({ ...evidence, diagnostics: [{ proofVerdict: 'FAIL' }] }, { runs: 1 }), 'FAIL');
});
