import test from 'node:test';
import assert from 'node:assert/strict';
import { EARLY_ASSETS, createEmpireSource, supportsAuditedDesktop } from '../src/empire-catalogue.js';
import { validateEarlyBatch, empireVariantMetadata } from '../src/empire-milestone.js';

function config() {
  const archiveSha256 = 'a'.repeat(64), build = `empire-${archiveSha256.slice(0, 16)}`;
  return { mode: 'PROVIDER_EARLY_ASSETS', lobbyOrigin: 'http://127.0.0.1:8100', archiveSha256,
    build, locale: 'en', tier: '1x', byteBudget: 10485760,
    entries: Array.from({ length: 20 }, (_, i) => ({ id: `title-${String(i + 1).padStart(2, '0')}`,
      origin: `http://127.0.0.1:${8101 + i}`, assets: EARLY_ASSETS.map(([path, stage, estimatedBytes]) => ({
        url: `http://127.0.0.1:${8101 + i}/${path}`, stage, estimatedBytes,
        sha256: 'b'.repeat(64), releaseBuild: build,
      })) })) };
}
const create = value => createEmpireSource(value, { lobbyOrigin: 'http://127.0.0.1:8100' });

test('audited eight-object subset is partial COMMON, no PRIMARY/SECONDARY/bootstrap relabelling', () => {
  assert.equal(EARLY_ASSETS.length, 8);
  assert.equal(EARLY_ASSETS.reduce((n, a) => n + a[2], 0), 523940);
  assert.deepEqual([...new Set(EARLY_ASSETS.map(a => a[1]))], ['PRELOADER', 'COMMON']);
  const source = create(config());
  assert.equal(source.catalogue.length, 20);
  assert.equal(new Set(source.allowedAssetUrls).size, 160);
  assert.equal(source.getPlayerCatalogue().length, 20);
});

test('release adapter fails closed on variant, identity, path, stage, size or digest changes', () => {
  for (const mutate of [
    c => { c.locale = 'hr'; }, c => { c.tier = '0.5x'; }, c => { c.build += '-other'; },
    c => { c.entries[0].assets.pop(); }, c => { c.entries[1].origin = c.entries[0].origin; },
    c => { c.entries[0].origin = 'http://example.test:8101'; },
    c => { c.entries[0].assets[0].url += '?v=invented'; },
    c => { c.entries[0].assets[0].stage = 'SECONDARY'; },
    c => { c.entries[0].assets[0].estimatedBytes = 1; },
    c => { c.entries[0].assets[0].sha256 = 'invalid'; },
  ]) { const value = config(); mutate(value); assert.throws(() => create(value)); }
});

test('release validation cannot cross synthetic titles and configuration is snapshotted', async () => {
  const value = config(), source = create(value);
  const target = { id: 'title-01', build: value.build, locale: 'en', tier: '1x' };
  const asset = source.catalogue[0].locales.en.tiers['1x'].assets[0];
  assert.equal(source.manifestSource.validateReleaseAsset(asset, target), true);
  assert.equal(source.manifestSource.validateReleaseAsset(asset, { ...target, id: 'title-02' }), false);
  value.entries[0].assets[0].estimatedBytes = 1;
  assert.equal(asset.estimatedBytes, 3997);
  await assert.rejects(source.manifestSource.resolve({ ...target, tier: '0.5x' }));
});

function observation() {
  const assets = EARLY_ASSETS.map(([, , estimatedBytes]) => ({ estimatedBytes }));
  const resources = assets.map((asset, index) => ({ index, decodedBodySize: asset.estimatedBytes,
    encodedBodySize: asset.estimatedBytes, transferSize: 0, responseEndEpochMs: 1010 + index }));
  return { assets, resources, clickedAt: 1000, now: 1100, desktopSupported: true };
}
test('only every exact preregistered response completes the asset milestone; never input-ready', () => {
  const o = observation(), result = validateEarlyBatch(o, o);
  assert.equal(result.assetCount, 8); assert.equal(result.decodedBodyBytes, 523940);
  assert.equal(result.clickToEarlyBatchMs, 17); assert.equal(result.inputAccepted, false);
  assert.match(result.providerPlayable, /^UNKNOWN/);
  assert.equal(result.resourceTimingTransferBytes, 0);
  assert.match(result.milestone, /all 8 preregistered/);
});
test('pending, duplicate, invalid-sized or impossible timing observations stay unknown', () => {
  for (const mutate of [
    o => o.resources.pop(), o => { o.resources[1].index = 0; },
    o => { o.resources[0].decodedBodySize = 0; }, o => { o.resources[0].encodedBodySize = 0; },
    o => { o.resources[0].transferSize = -1; }, o => { o.resources[0].responseEndEpochMs = 999; },
    o => { o.resources[0].responseEndEpochMs = 1101; }, o => { o.resources[0].responseEndEpochMs = NaN; },
    o => { o.now = 999; }, o => { o.clickedAt = Infinity; },
    o => { delete o.resources[3]; }, o => { delete o.assets[3]; },
    o => { o.resources = new Array(8); }, o => { o.assets = new Array(8); },
  ]) { const o = observation(); mutate(o); assert.equal(validateEarlyBatch(o, o), null); }
});
test('mobile has UNKNOWN actual tier and cannot complete a desktop milestone, even with all eight responses', () => {
  const o = observation();
  for (const desktopSupported of [false, undefined, null, 'true', 1]) {
    assert.equal(validateEarlyBatch(o, { ...o, desktopSupported }), null);
  }
  const { desktopSupported: _capability, ...unknownCapability } = o;
  assert.equal(validateEarlyBatch(o, unknownCapability), null);
  for (const desktopSupported of [true, false]) {
    const result = empireVariantMetadata({ locale: 'en', tier: '1x' }, desktopSupported);
    assert.equal(result.tier, '1x'); // Legacy observer compatibility: manifest only.
    assert.equal(result.manifestTier, '1x');
    assert.equal(result.actualProviderTier, 'UNKNOWN');
    assert.match(result.tierNote, /not the runtime provider tier/);
    if (!desktopSupported) assert.match(result.milestone, /not applicable/);
  }
});
test('unknown/mobile variant is never eligible for audited desktop warming', () => {
  assert.equal(supportsAuditedDesktop({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), true);
  for (const navigator of [{}, { userAgent: 'Android Linux' }, { userAgent: 'Macintosh', userAgentData: { mobile: true } },
    { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }]) {
    assert.equal(supportsAuditedDesktop(navigator), false);
  }
});
