import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { redactEmpireHar, exportEmpireHar } from '../../tools/redact_empire_har.mjs';
import { EARLY_ASSETS } from '../src/empire-catalogue.js';

// All input below is SIMULATED. No raw HAR, provider, browser or server is accessed.
const sentinel = 'SYNTHETIC_PRIVATE_FIELD_DO_NOT_EXPORT';
const epoch = '2026-01-01T00:00:00.000Z';
const url = 'http://127.0.0.1:8101/assets/locale/en/gameContent.json';
function entry(target = url) {
  return { startedDateTime: epoch, time: 12.5, pageref: sentinel,
    request: { method: 'GET', url: target, headers: [{ name: 'Authorization', value: sentinel }],
      cookies: [{ name: 'session', value: sentinel }], postData: { text: sentinel }, comment: sentinel },
    response: { status: 200, headersSize: 123, bodySize: 456, _transferSize: 579,
      content: { size: 789, compression: 333, text: sentinel, mimeType: sentinel },
      headers: [{ name: 'Set-Cookie', value: sentinel }], cookies: [sentinel],
      statusText: sentinel, redirectURL: sentinel, _securityDetails: { subject: sentinel } },
    timings: { send: 0, wait: 10, receive: 2.5, ssl: -1, comment: sentinel },
    cache: { beforeRequest: { eTag: sentinel } }, serverIPAddress: sentinel,
    connection: sentinel, _initiator: { stack: sentinel }, comment: sentinel };
}
function har(entries = [entry()]) {
  return { extra: sentinel, log: { version: '1.2', creator: { name: 'Playwright', version: '1.55.1', comment: sentinel },
    browser: { name: sentinel }, comment: sentinel, entries,
    pages: [{ startedDateTime: epoch, id: sentinel, title: sentinel,
      pageTimings: { onLoad: 12, onContentLoad: -1, comment: sentinel }, comment: sentinel }] } };
}
const cleanEntries = raw => redactEmpireHar(raw).log.entries;

test('rebuilds only whitelisted fields, with no nested private payload or source mutation', () => {
  const input = har(), before = JSON.stringify(input), result = redactEmpireHar(input);
  assert.equal(JSON.stringify(input), before);
  assert.ok(!JSON.stringify(result).includes(sentinel));
  assert.deepEqual(Object.keys(result), ['log']);
  const e = result.log.entries[0];
  assert.deepEqual(Object.keys(e), ['startedDateTime', 'time', 'request', 'response', 'cache', 'timings', 'pageref']);
  assert.deepEqual(e.request, { method: 'GET', url, httpVersion: '', cookies: [], headers: [], queryString: [], headersSize: -1, bodySize: -1 });
  assert.deepEqual(e.response, { status: 200, statusText: '', httpVersion: '', cookies: [], headers: [],
    content: { size: 789, mimeType: '', compression: 333 }, redirectURL: '', headersSize: 123, bodySize: 456, _transferSize: 579 });
  assert.deepEqual(e.timings, { send: 0, wait: 10, receive: 2.5, ssl: -1 });
  assert.deepEqual(result.log.pages, [{ startedDateTime: epoch, id: 'page-1', title: '', pageTimings: { onContentLoad: -1, onLoad: 12 } }]);
  e.response.content.size = 0;
  assert.equal(input.log.entries[0].response.content.size, 789);
});

test('locally pinned scope agrees with all eight reviewed catalogue paths on exactly twenty origins', () => {
  assert.equal(EARLY_ASSETS.length, 8);
  const urls = Array.from({ length: 20 }, (_, i) => EARLY_ASSETS.map(([p]) => `http://127.0.0.1:${8101 + i}/${p}`)).flat();
  assert.equal(new Set(urls).size, 160);
  assert.deepEqual(cleanEntries(har(urls.map(entry))).map(e => e.request.url), urls);
});

test('keeps duplicate requests, failures, source order and original timestamps without inventing phases', () => {
  const entries = [entry(), entry(), entry()];
  entries[0].response.status = 404; entries[1].time = 3; entries[2].response.status = 0;
  const result = cleanEntries(har(entries));
  assert.deepEqual(result.map(e => e.response.status), [404, 200, 0]);
  assert.deepEqual(result.map(e => e.time), [12.5, 3, 12.5]);
  assert.ok(result.every(e => e.startedDateTime === epoch && !('phase' in e)));
});

test('excludes URL aliases, credentials, extra queries, non-GET, other tiers/stages and other ports', () => {
  const aliases = [url + '?v=1', url + '#x', url.replace('http:', 'https:'), url.replace('127.0.0.1', 'localhost'),
    url.replace(':8101', ':8100'), url.replace(':8101', ':8121'), url.replace(':8101', ':08101'),
    url.replace('127.0.0.1', 'user:pass@127.0.0.1'), url.replace('/assets/', '/x/../assets/'),
    url.replace('/assets/', '/%61ssets/'), url.replace('/assets/', '//assets/'), url.replace('/en/', '/hr/'),
    'http://127.0.0.1:8101/assets/images/@0.5x/brandLogo.png',
    'http://127.0.0.1:8101/assets/spines/@1x/book.png', 'https://example.invalid/' + sentinel];
  const post = entry(); post.request.method = 'POST';
  const lower = entry(); lower.request.method = 'get';
  assert.equal(cleanEntries(har([...aliases.map(entry), post, lower, null, {}, { request: null }])).length, 0);
});

test('zero transfer, cache claims, 304 and service worker metadata never create cache attribution', () => {
  const e = entry(); e.response._transferSize = 0; e.response.status = 304;
  Object.assign(e.response, { _fromDiskCache: true, _fromMemoryCache: true, _fromServiceWorker: true });
  e._fromCache = true;
  const out = cleanEntries(har([e]))[0];
  assert.deepEqual(out.cache, {}); assert.equal(out.response._transferSize, 0);
  assert.equal(out.response.status, 304);
  for (const key of ['_fromDiskCache', '_fromMemoryCache', '_fromServiceWorker']) assert.ok(!(key in out.response));
  assert.ok(!('_fromCache' in out));
});

test('transfer size requires the exact reviewed exporter version, not a guessed cache flag', () => {
  for (const creator of [undefined, { name: 'Chromium', version: '1.55.1' }, { name: 'Playwright', version: '1.55.2' }]) {
    const raw = har(); raw.log.creator = creator; raw.log.entries[0].response._transferSize = sentinel;
    assert.ok(!('_transferSize' in cleanEntries(raw)[0].response));
  }
});

test('preserves valid negative compression and unknown HAR sizes rather than recomputing them', () => {
  const e = entry(); e.response.content.compression = -20; e.response.bodySize = -1; e.response.headersSize = -1; e.response._transferSize = -1;
  const out = cleanEntries(har([e]))[0];
  assert.equal(out.response.content.compression, -20); assert.equal(out.response.bodySize, -1);
  assert.equal(out.response.headersSize, -1); assert.equal(out.response._transferSize, -1);
});

const mutations = {
  'invalid timestamp': e => { e.startedDateTime = '2026-02-30T00:00:00.000Z'; },
  'timestamp suffix': e => { e.startedDateTime += sentinel; },
  'negative elapsed': e => { e.time = -1; },
  'nonfinite elapsed': e => { e.time = Infinity; },
  'string elapsed': e => { e.time = '12'; },
  'missing response': e => { delete e.response; },
  'invalid status': e => { e.response.status = 600; },
  'fractional status': e => { e.response.status = 200.5; },
  'unsafe body size': e => { e.response.bodySize = Number.MAX_SAFE_INTEGER + 1; },
  'missing header size': e => { delete e.response.headersSize; },
  'negative decoded size': e => { e.response.content.size = -1; },
  'fractional compression': e => { e.response.content.compression = 1.5; },
  'invalid reviewed transfer size': e => { e.response._transferSize = sentinel; },
  'missing required timing': e => { delete e.timings.wait; },
  'invalid optional timing': e => { e.timings.dns = -2; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`fails closed for in-scope ${name}`, () => {
  const e = entry(); mutate(e);
  assert.throws(() => redactEmpireHar(har([e])), error => error instanceof TypeError
    && error.message === 'HAR redaction refused; expected valid HAR 1.2 and in-scope measurements' && !error.cause);
});

test('rejects malformed root structures; malformed out-of-scope payloads do not leak', () => {
  for (const raw of [null, [], {}, { log: { version: '1.1', entries: [] } }, { log: { version: '1.2', entries: {} } }]) {
    assert.throws(() => redactEmpireHar(raw), TypeError);
  }
  assert.deepEqual(cleanEntries(har([{ request: { method: 'GET', url: sentinel }, response: sentinel }])), []);
});

test('page IDs are generated; missing references omitted; duplicate or invalid referenced pages fail closed', () => {
  const raw = har(); raw.log.pages.push({ id: 'unreferenced', title: sentinel });
  assert.equal(redactEmpireHar(raw).log.pages.length, 1);
  raw.log.entries[0].pageref = 'missing';
  assert.equal(redactEmpireHar(raw).log.pages.length, 0);
  assert.ok(!('pageref' in cleanEntries(raw)[0]));
  raw.log.entries[0].pageref = sentinel; raw.log.pages.push({ ...raw.log.pages[0] });
  assert.throws(() => redactEmpireHar(raw), TypeError);
  raw.log.pages.pop(); raw.log.pages[0].pageTimings.onLoad = sentinel;
  assert.throws(() => redactEmpireHar(raw), TypeError);
});

// Filesystem mocks exercise the export boundary without reading or writing evidence.
const root = '/synthetic-redactor-root';
const input = 'evidence/private/input.har', output = 'evidence/derived/output.har';
const info = { isFile: () => true, nlink: 1, dev: 1, ino: 2 };
function mockFilesystem(t, overrides = {}) {
  const bytes = Buffer.from(JSON.stringify(har()));
  const state = { opens: [], writes: [], sourceClosed: 0, targetClosed: 0, bytes };
  t.mock.method(fs, 'realpath', overrides.realpath ?? (async p => p));
  t.mock.method(fs, 'stat', overrides.stat ?? (async () => info));
  t.mock.method(fs, 'open', async (p, flags, mode) => {
    state.opens.push({ p, flags, mode });
    if (flags === 'wx') {
      if (overrides.targetError) throw new Error(sentinel);
      return { writeFile: async text => { state.writes.push(text); if (overrides.writeError) throw new Error(sentinel); },
        close: async () => { state.targetClosed++; } };
    }
    return { stat: async () => overrides.openedInfo ?? info,
      readFile: async () => overrides.bytes ?? bytes,
      close: async () => { state.sourceClosed++; } };
  });
  return state;
}
const safeRejection = promise => assert.rejects(promise, error => error.message ===
  'HAR export refused; check arguments, evidence paths and HAR measurements' && !error.cause);

test('filesystem export is read-only at source, exclusive 0600 at destination and returns counts/digest only', async t => {
  const state = mockFilesystem(t);
  const result = await exportEmpireHar(input, output, { root });
  assert.equal(state.sourceClosed, 1); assert.equal(state.targetClosed, 1);
  assert.equal(state.opens[0].flags, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  assert.deepEqual(state.opens[1], { p: `${root}/${output}`, flags: 'wx', mode: 0o600 });
  assert.deepEqual(JSON.parse(state.writes[0]), redactEmpireHar(har()));
  assert.equal(result.sourceSha256, createHash('sha256').update(state.bytes).digest('hex'));
  assert.equal(result.inputEntries, 1); assert.equal(result.retainedEntries, 1); assert.equal(result.omittedEntries, 0);
  assert.equal(result.cacheAttribution, 'UNKNOWN'); assert.equal(result.providerPlayable, 'UNKNOWN');
  assert.ok(!JSON.stringify(result).includes(root)); assert.ok(!state.writes[0].includes(sentinel));
});

for (const [name, source, target] of [
  ['outside input', '/outside/input.har', output], ['outside output', input, '/outside/output.har'],
  ['same file', input, input], ['private root as source', 'evidence/private', output],
  ['prefix lookalike', 'evidence/private-other/input.har', output],
]) test(`filesystem rejects ${name} without opening files`, async t => {
  const state = mockFilesystem(t);
  await safeRejection(exportEmpireHar(source, target, { root })); assert.equal(state.opens.length, 0);
});

for (const changed of ['evidence/private', 'evidence/derived', input, 'evidence/derived/nested']) {
  test(`filesystem refuses symlink resolution at ${changed}`, async t => {
    const state = mockFilesystem(t, { realpath: async p => p === `${root}/${changed}` ? '/outside' : p });
    await safeRejection(exportEmpireHar(input, changed.endsWith('nested') ? 'evidence/derived/nested/output.har' : output, { root }));
    assert.equal(state.opens.length, 0);
  });
}
for (const [name, value] of [['nonregular source', { ...info, isFile: () => false }], ['hardlinked source', { ...info, nlink: 2 }]]) {
  test(`filesystem refuses ${name}`, async t => {
    const state = mockFilesystem(t, { stat: async () => value });
    await safeRejection(exportEmpireHar(input, output, { root })); assert.equal(state.opens.length, 0);
  });
}
test('opened file identity change refuses export and closes source', async t => {
  const state = mockFilesystem(t, { openedInfo: { ...info, ino: 3 } });
  await safeRejection(exportEmpireHar(input, output, { root }));
  assert.equal(state.sourceClosed, 1); assert.equal(state.opens.length, 1);
});
test('malformed private JSON produces no output and no parser excerpt', async t => {
  const state = mockFilesystem(t, { bytes: Buffer.from(sentinel) });
  await safeRejection(exportEmpireHar(input, output, { root }));
  assert.equal(state.sourceClosed, 1); assert.equal(state.writes.length, 0); assert.equal(state.opens.length, 1);
});
test('existing destination refusal does not overwrite it or expose filesystem details', async t => {
  const state = mockFilesystem(t, { targetError: true });
  await safeRejection(exportEmpireHar(input, output, { root })); assert.equal(state.writes.length, 0);
});
test('write failure closes destination; only already-redacted data was offered to the writer', async t => {
  const state = mockFilesystem(t, { writeError: true });
  await safeRejection(exportEmpireHar(input, output, { root }));
  assert.equal(state.targetClosed, 1); assert.ok(!state.writes[0].includes(sentinel));
});
test('filesystem API errors are fixed even when root resolution fails', async t => {
  mockFilesystem(t, { realpath: async () => { throw new Error(sentinel); } });
  await safeRejection(exportEmpireHar(input, output, { root }));
});

test('reviewed zero-transfer negative-body exporter quirk retains provenance as UNKNOWN, not zero', () => {
  const source = har(); const response = source.log.entries[0].response;
  response._transferSize = 0; response.bodySize = -123; response.content.compression = 912;
  const before = JSON.stringify(source), result = cleanEntries(source)[0];
  assert.equal(result.response.bodySize, -1);
  assert.equal(result.response._empireExporterBodySize, -123);
  assert.equal(result.response._empireExporterCompression, 912);
  assert.equal(result.response._transferSize, 0);
  assert.ok(!('compression' in result.response.content));
  assert.deepEqual(result.cache, {});
  assert.equal(JSON.stringify(source), before);
  assert.ok(!JSON.stringify(result).includes(sentinel));
});

test('negative body quirk refuses unreviewed exporters and near misses', () => {
  for (const mutate of [
    h => { h.log.creator.version = '1.55.2'; },
    h => { h.log.entries[0].response.bodySize = -124; },
    h => { h.log.entries[0].response._transferSize = 1; },
    h => { h.log.entries[0].response.content.compression = 911; },
  ]) {
    const source = har(); const response = source.log.entries[0].response;
    response._transferSize = 0; response.bodySize = -123; response.content.compression = 912;
    mutate(source); assert.throws(() => redactEmpireHar(source), /redaction refused/);
  }
});
