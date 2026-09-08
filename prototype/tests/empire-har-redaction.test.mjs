import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { redactEmpireHar, exportEmpireHar } from '../../tools/redact_empire_har.mjs';
import { EARLY_ASSETS, createEmpireSource } from '../src/empire-catalogue.js';

// SIMULATED fixtures only. Never open repository HARs, start a browser/server,
// request a URL, or write anywhere except this test's OS temporary directory.
const SECRET = 'SYNTHETIC_SECRET_player_token_cookie_exclusion_4b820';
const WHEN = '2026-01-02T03:04:05.006Z';
const URL = 'http://127.0.0.1:8101/assets/locale/en/gameContent.json';
const REDACTION_ERROR = 'HAR redaction refused; expected valid HAR 1.2 and in-scope measurements';
const EXPORT_ERROR = 'HAR export refused; check arguments, evidence paths and HAR measurements';
const CLI = fileURLToPath(new globalThis.URL('../../tools/redact_empire_har.mjs', import.meta.url));
const clone = value => structuredClone(value);
function entry(url = URL) {
  return { startedDateTime: WHEN, time: 12.75,
    request: { method: 'GET', url },
    response: { status: 200, headersSize: 111, bodySize: 300,
      content: { size: 900, compression: 600 }, _transferSize: 411 },
    timings: { blocked: -1, dns: 0, connect: 1.25, ssl: -1, send: 0, wait: 10, receive: 1.5 },
  };
}
function har(entries = [entry()]) {
  return { log: { version: '1.2', creator: { name: 'Playwright', version: '1.55.1' }, pages: [], entries } };
}
function expectedEntry(url = URL) {
  return { startedDateTime: WHEN, time: 12.75,
    request: { method: 'GET', url, httpVersion: '', cookies: [], headers: [], queryString: [], headersSize: -1, bodySize: -1 },
    response: { status: 200, statusText: '', httpVersion: '', cookies: [], headers: [],
      content: { size: 900, mimeType: '', compression: 600 }, redirectURL: '', headersSize: 111, bodySize: 300, _transferSize: 411 },
    cache: {}, timings: { send: 0, wait: 10, receive: 1.5, blocked: -1, dns: 0, connect: 1.25, ssl: -1 },
  };
}
function refuses(raw) {
  assert.throws(() => redactEmpireHar(raw), error => {
    assert.equal(error.constructor, TypeError);
    assert.equal(error.message, REDACTION_ERROR);
    assert.equal(error.cause, undefined);
    assert.equal(error.stack.includes(SECRET), false);
    assert.deepEqual(Object.keys(error), []);
    return true;
  });
}
async function tempFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'empire-redaction-synthetic-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'evidence/private/run'), { recursive: true });
  await fs.mkdir(path.join(root, 'evidence/derived/run'), { recursive: true });
  const input = 'evidence/private/run/synthetic.har';
  const output = 'evidence/derived/run/redacted.har';
  const raw = har([entry(), entry(`${URL}?token=${SECRET}`), entry()]);
  const bytes = `${JSON.stringify(raw)}\n`;
  await fs.writeFile(path.join(root, input), bytes);
  return { root, input, output, raw, bytes };
}
async function refusedExport(f, input = f.input, output = f.output, options = { root: f.root }) {
  await assert.rejects(exportEmpireHar(input, output, options), error => {
    assert.equal(error.constructor, Error);
    assert.equal(error.message, EXPORT_ERROR);
    assert.equal(error.cause, undefined);
    assert.equal(error.stack.includes(SECRET), false);
    assert.equal(error.stack.includes(f.root), false);
    assert.deepEqual(Object.keys(error), []);
    return true;
  });
}
async function absent(filename) {
  await assert.rejects(fs.lstat(filename), { code: 'ENOENT' });
}
function command(f, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: f.root, encoding: 'utf8', timeout: 10000 });
}
function assertCliFailure(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `${EXPORT_ERROR}.\n`);
}

test('exact 160 URLs agree with the actual catalogue adapter, independently pinned paths and ports', () => {
  const paths = [
    'assets/locale/en/gameContent.json', 'assets/locale/en/commonContent.json',
    'assets/fonts/en/Mulish.ttf', 'assets/images/@1x/brandLogo.png',
    'assets/fonts/en/NewRocker-Regular.ttf', 'assets/fonts/en/Oswald-Bold.ttf',
    'assets/images/@1x/controlPanelPrimaryAssets.json', 'assets/images/@1x/controlPanelPrimaryAssets.webp',
  ];
  assert.deepEqual(EARLY_ASSETS.map(([assetPath]) => assetPath), paths);
  const archiveSha256 = 'a'.repeat(64), build = `empire-${archiveSha256.slice(0, 16)}`;
  const config = { mode: 'PROVIDER_EARLY_ASSETS', lobbyOrigin: 'http://127.0.0.1:8100',
    archiveSha256, build, locale: 'en', tier: '1x', byteBudget: 10485760,
    entries: Array.from({ length: 20 }, (_, i) => {
      const origin = `http://127.0.0.1:${8101 + i}`;
      return { id: `title-${String(i + 1).padStart(2, '0')}`, origin,
        assets: EARLY_ASSETS.map(([assetPath, stage, estimatedBytes]) => ({
          url: `${origin}/${assetPath}`, stage, estimatedBytes, sha256: 'b'.repeat(64), releaseBuild: build,
        })) };
    }) };
  const source = createEmpireSource(config, { lobbyOrigin: config.lobbyOrigin });
  const expected = Array.from({ length: 20 }, (_, i) => paths.map(p => `http://127.0.0.1:${8101 + i}/${p}`)).flat();
  assert.equal(new Set(expected).size, 160);
  assert.deepEqual(source.allowedAssetUrls, expected);
  const raw = har(expected.map(entry));
  raw.log.allowedUrls = [`https://outside.invalid/${SECRET}`];
  raw.log.entries.push(entry(raw.log.allowedUrls[0]));
  assert.deepEqual(redactEmpireHar(raw).log.entries.map(e => e.request.url), expected);
});

const rejectedUrls = [
  URL.replace(':8101/', ':8100/'), URL.replace(':8101/', ':8121/'), URL.replace(':8101/', ':08101/'),
  URL.replace('http:', 'https:'), URL.replace('127.0.0.1', 'localhost'), URL.replace('127.0.0.1', '[::1]'),
  URL.replace('127.0.0.1', '127.1'), URL.replace('127.0.0.1', '2130706433'),
  URL.replace('http://', 'HTTP://'), URL.replace('127.0.0.1', '127.0.0.1.evil.invalid'),
  URL.replace('http://', `http://${SECRET}@`), URL.replace('/assets/', '//assets/'),
  URL.replace('/assets/', '/x/../assets/'), URL.replace('/assets/', '/%61ssets/'),
  URL.replace('/assets/', '/%2e/assets/'), URL.replace('/en/', '/hr/'),
  URL.replace('gameContent.json', 'GameContent.json'), URL.replace('gameContent.json', 'secondary.json'),
  `${URL}?v=1`, `${URL}?token=${SECRET}`, `${URL}#${SECRET}`, `${URL}?`, `${URL}#`, `${URL}/`,
  ` ${URL}`, `${URL}\n`, URL.replace('/assets/', '\\assets/'),
  'http://127.0.0.1:8101/assets/images/@0.5x/brandLogo.png',
  'http://127.0.0.1:8101/assets/images/@1x/book.png',
  'http://127.0.0.1:8101/session/create', `/assets/locale/en/gameContent.json`, null, 8101, {},
];
for (const [i, url] of rejectedUrls.entries()) {
  test(`URL privacy boundary rejects non-exact identity ${i + 1} without normalization`, () => {
    assert.deepEqual(redactEmpireHar(har([entry(url)])).log.entries, []);
  });
}

test('nested arbitrary secrets and all free-form strings are removed by a fresh whitelist', () => {
  const raw = har();
  const e = raw.log.entries[0];
  e.pageref = SECRET;
  raw.log.pages = [{ id: SECRET, title: SECRET, startedDateTime: WHEN,
    pageTimings: { onContentLoad: 1.25, onLoad: -1, comment: SECRET }, comment: SECRET }];
  e.request = { ...e.request, httpVersion: SECRET, headersSize: 123, bodySize: 999,
    headers: [{ name: 'Authorization', value: SECRET }], cookies: [{ name: SECRET, value: SECRET }],
    queryString: [{ name: SECRET, value: SECRET }], postData: { mimeType: SECRET, text: SECRET, params: [{ value: SECRET }] } };
  Object.assign(e.response, { statusText: SECRET, httpVersion: SECRET, redirectURL: `https://${SECRET}.invalid/`,
    headers: [{ name: 'Set-Cookie', value: SECRET }], cookies: [{ name: SECRET, value: SECRET }],
    _securityDetails: { subjectName: SECRET }, _serverIPAddress: SECRET });
  Object.assign(e.response.content, { text: SECRET, encoding: SECRET, mimeType: SECRET });
  Object.assign(e, { serverIPAddress: SECRET, connection: SECRET, comment: SECRET, _initiator: { stack: { callFrames: [{ url: SECRET }] } },
    _error: { message: SECRET }, cache: { beforeRequest: { eTag: SECRET }, afterRequest: { comment: SECRET } } });
  // Seed an unknown nested payload at every existing object level, including arrays'
  // members, without replacing any valid measurement or approved URL.
  function seed(value) {
    if (!value || typeof value !== 'object') return;
    for (const child of Object.values(value)) seed(child);
    if (!Array.isArray(value)) value.arbitraryExtension = { [SECRET]: [{ nested: SECRET, token: SECRET }] };
  }
  seed(raw);
  const before = clone(raw);
  const clean = redactEmpireHar(raw);
  assert.deepEqual(clean, { log: { version: '1.2', creator: { name: 'Empire early HAR redactor', version: '1.0' },
    pages: [{ startedDateTime: WHEN, id: 'page-1', title: '', pageTimings: { onContentLoad: 1.25, onLoad: -1 } }],
    entries: [{ ...expectedEntry(), pageref: 'page-1' }] } });
  assert.equal(JSON.stringify(clean).includes(SECRET), false);
  assert.deepEqual(raw, before);
  clean.log.entries[0].response.content.size = 0;
  assert.deepEqual(raw, before, 'output must not alias source objects');
});

test('duplicate warm/launch entries and original order survive, without sorting or merging', () => {
  const raw = har([entry(), entry(URL.replace(':8101/', ':8120/')), entry(), entry()]);
  raw.log.entries.forEach((e, i) => { e.time = [30, 20, 10, 10][i]; });
  const clean = redactEmpireHar(raw);
  assert.deepEqual(clean.log.entries.map(e => [e.request.url, e.time]), raw.log.entries.map(e => [e.request.url, e.time]));
  assert.equal(clean.log.entries.length, 4);
});

test('referenced pages get generated IDs in first-reference order; orphan/private pages disappear', () => {
  const raw = har([entry(), entry(), entry(), entry()]);
  const page = id => ({ id, title: SECRET, startedDateTime: WHEN, pageTimings: { onLoad: 0 } });
  raw.log.pages = [page('a'), page('b'), { id: SECRET, startedDateTime: 'invalid' }];
  raw.log.entries.forEach((e, i) => { e.pageref = ['b', 'a', 'b', 'missing'][i]; });
  const clean = redactEmpireHar(raw);
  assert.deepEqual(clean.log.pages.map(p => p.id), ['page-1', 'page-2']);
  assert.deepEqual(clean.log.entries.map(e => e.pageref), ['page-1', 'page-2', 'page-1', undefined]);
  assert.equal(JSON.stringify(clean).includes(SECRET), false);
});

test('out-of-scope malformed entries and non-GET requests are omitted, not repaired', () => {
  const excluded = [null, 1, SECRET, [], {}, { request: null }, { request: { url: URL } },
    ...['POST', 'HEAD', 'get', SECRET].map(method => ({ request: { method, url: URL }, response: SECRET })),
    { request: { method: 'GET', url: `${URL}?token=${SECRET}` }, time: SECRET }];
  assert.deepEqual(redactEmpireHar(har(excluded)).log.entries, []);
});

for (const [name, raw] of [
  ['null', null], ['array', []], ['missing log', {}], ['log array', { log: [] }],
  ['wrong version', { log: { version: '1.1', entries: [] } }],
  ['numeric version', { log: { version: 1.2, entries: [] } }],
  ['missing entries', { log: { version: '1.2' } }], ['entries object', { log: { version: '1.2', entries: {} } }],
]) test(`invalid HAR envelope fails closed: ${name}`, () => refuses(raw));

const invalidMeasurements = [
  ['timestamp absent', e => { delete e.startedDateTime; }],
  ['timestamp free-form secret', e => { e.startedDateTime = SECRET; }],
  ['timestamp rollover', e => { e.startedDateTime = '2026-02-30T03:04:05.006Z'; }],
  ['timestamp noncanonical timezone', e => { e.startedDateTime = '2026-01-02T03:04:05.006+00:00'; }],
  ['time missing', e => { delete e.time; }], ['time string', e => { e.time = '12'; }],
  ['time negative', e => { e.time = -1; }], ['time infinite', e => { e.time = Infinity; }],
  ['time NaN', e => { e.time = NaN; }], ['response missing', e => { delete e.response; }],
  ['response array', e => { e.response = []; }], ['status string', e => { e.response.status = '200'; }],
  ['status fractional', e => { e.response.status = 200.5; }], ['status negative', e => { e.response.status = -1; }],
  ['status too large', e => { e.response.status = 600; }],
  ['headers size missing', e => { delete e.response.headersSize; }],
  ['headers size below sentinel', e => { e.response.headersSize = -2; }],
  ['body size string', e => { e.response.bodySize = '0'; }],
  ['body size fractional', e => { e.response.bodySize = 0.5; }],
  ['body size unsafe integer', e => { e.response.bodySize = Number.MAX_SAFE_INTEGER + 1; }],
  ['content missing', e => { delete e.response.content; }], ['content array', e => { e.response.content = []; }],
  ['content size negative', e => { e.response.content.size = -1; }],
  ['content size null', e => { e.response.content.size = null; }],
  ['content size missing', e => { delete e.response.content.size; }],
  ['compression string', e => { e.response.content.compression = '600'; }],
  ['compression fractional', e => { e.response.content.compression = -0.5; }],
  ['compression unsafe integer', e => { e.response.content.compression = Number.MAX_SAFE_INTEGER + 1; }],
  ['timings missing', e => { delete e.timings; }], ['timings array', e => { e.timings = []; }],
  ...['send', 'wait', 'receive'].map(key => [`required timing ${key} missing`, e => { delete e.timings[key]; }]),
  ...['send', 'wait', 'receive', 'blocked', 'dns', 'connect', 'ssl'].map(key => [`timing ${key} string`, e => { e.timings[key] = SECRET; }]),
  ['timing below sentinel', e => { e.timings.wait = -0.5; }],
  ['timing infinity', e => { e.timings.connect = Infinity; }],
  ['transfer size string', e => { e.response._transferSize = '0'; }],
  ['transfer size object', e => { e.response._transferSize = { token: SECRET }; }],
  ['transfer size null', e => { e.response._transferSize = null; }],
  ['transfer size fraction', e => { e.response._transferSize = 0.25; }],
  ['transfer size below sentinel', e => { e.response._transferSize = -2; }],
  ['transfer size infinity', e => { e.response._transferSize = Infinity; }],
  ['transfer size unsafe integer', e => { e.response._transferSize = Number.MAX_SAFE_INTEGER + 1; }],
];
for (const [name, mutate] of invalidMeasurements) {
  test(`malformed in-scope measurement refuses the entire capture: ${name}`, () => {
    const bad = entry(); mutate(bad);
    refuses(har([entry(), bad, entry()]));
  });
}
for (const [name, mutate] of [
  ['invalid timestamp', p => { p.startedDateTime = SECRET; }],
  ['missing timings', p => { delete p.pageTimings; }],
  ['invalid content-load timing', p => { p.pageTimings.onContentLoad = SECRET; }],
  ['invalid load timing', p => { p.pageTimings.onLoad = -2; }],
]) test(`malformed referenced page fails closed: ${name}`, () => {
  const raw = har(); raw.log.entries[0].pageref = SECRET;
  const page = { id: SECRET, startedDateTime: WHEN, pageTimings: {} }; mutate(page);
  raw.log.pages = [page]; refuses(raw);
});

test('ambiguous duplicate referenced page IDs fail closed', () => {
  const raw = har(); raw.log.entries[0].pageref = SECRET;
  raw.log.pages = Array.from({ length: 2 }, () => ({ id: SECRET, startedDateTime: WHEN, pageTimings: {} }));
  refuses(raw);
});

test('HAR unknown sentinels, zero sizes/status, fractional durations and absent optional values are preserved', () => {
  const raw = har(); const e = raw.log.entries[0];
  e.time = 0; e.response.status = 0; e.response.headersSize = -1; e.response.bodySize = -1;
  e.response._transferSize = -1; e.response.content = { size: 0 };
  e.timings = { send: -1, wait: 0, receive: 0.125 };
  const clean = redactEmpireHar(raw).log.entries[0];
  assert.equal(clean.time, 0); assert.equal(clean.response.status, 0);
  assert.equal(clean.response.headersSize, -1); assert.equal(clean.response.bodySize, -1);
  assert.equal(clean.response._transferSize, -1);
  assert.deepEqual(clean.response.content, { size: 0, mimeType: '' });
  assert.deepEqual(clean.timings, e.timings);
});

for (const [name, creator] of [
  ['missing', undefined], ['null', null], ['Chrome', { name: 'Chrome', version: '1.55.1' }],
  ['unreviewed newer Playwright', { name: 'Playwright', version: '1.55.2' }],
  ['unreviewed older Playwright', { name: 'Playwright', version: '1.54.1' }],
  ['case mismatch', { name: 'playwright', version: '1.55.1' }],
  ['numeric version', { name: 'Playwright', version: 1.55 }],
]) test(`transferSize omitted for exporter other than exact reviewed identity: ${name}`, () => {
  const raw = har(); raw.log.creator = creator;
  raw.log.entries[0].response._transferSize = { token: SECRET };
  const clean = redactEmpireHar(raw).log.entries[0];
  assert.equal(Object.hasOwn(clean.response, '_transferSize'), false);
  assert.equal(clean.response.bodySize, 300);
  assert.equal(JSON.stringify(clean).includes(SECRET), false);
});

test('negative integer compression is valid HAR overhead, preserved without clamping/recomputation', () => {
  const raw = har(); raw.log.entries[0].response.content.compression = -42;
  assert.equal(redactEmpireHar(raw).log.entries[0].response.content.compression, -42);
});

test('only exporter response._transferSize numeric field survives, not CDP/RT/inferred cache claims', () => {
  const raw = har(); const e = raw.log.entries[0];
  e.response._transferSize = 0; e.response.status = 304; e.response.bodySize = 0;
  Object.assign(e, { _transferSize: 777, transferSize: 888, _fromCache: true, _fromDiskCache: true,
    _fromMemoryCache: true, _servedFromCache: true, _fromServiceWorker: true,
    _resourceTiming: { transferSize: 0, decodedBodySize: 900 },
    _cdp: { fromDiskCache: true }, cache: { beforeRequest: {}, afterRequest: {}, hit: true } });
  Object.assign(e.response, { transferSize: 999, _fromCache: true, _fromDiskCache: true,
    _fromMemoryCache: true, _fromServiceWorker: true, cacheHit: true });
  const clean = redactEmpireHar(raw).log.entries[0];
  const expected = expectedEntry();
  Object.assign(expected.response, { _transferSize: 0, status: 304, bodySize: 0 });
  assert.deepEqual(clean, expected);
  delete e.response._transferSize;
  assert.equal(Object.hasOwn(redactEmpireHar(raw).log.entries[0].response, '_transferSize'), false,
    'never derive transfer size from body size, CDP or Resource Timing');
});

test('filesystem export succeeds using only synthetic temp files, source unchanged and new output private', async t => {
  const f = await tempFixture(t);
  const before = await fs.stat(path.join(f.root, f.input));
  const summary = await exportEmpireHar(f.input, f.output, { root: f.root });
  assert.deepEqual(summary, { classification: 'MEASURED', scope: 'HAR filtering counts only; early assets, not whole launch',
    sourceSha256: createHash('sha256').update(f.bytes).digest('hex'), inputEntries: 3, retainedEntries: 2, omittedEntries: 1, exporterNegativeBodySizeCount: 0,
    cacheAttribution: 'UNKNOWN', providerPlayable: 'UNKNOWN' });
  const output = await fs.readFile(path.join(f.root, f.output), 'utf8');
  assert.deepEqual(JSON.parse(output), redactEmpireHar(f.raw));
  assert.equal(output.includes(SECRET), false);
  assert.equal(JSON.stringify(summary).includes(f.root), false);
  assert.equal((await fs.stat(path.join(f.root, f.output))).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(path.join(f.root, f.input), 'utf8'), f.bytes);
  const after = await fs.stat(path.join(f.root, f.input));
  assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.ino, before.ino);
});

test('absolute input and output inside their declared boundaries are supported', async t => {
  const f = await tempFixture(t);
  await exportEmpireHar(path.join(f.root, f.input), path.join(f.root, f.output), { root: f.root });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root, f.output), 'utf8')), redactEmpireHar(f.raw));
});

for (const [name, select] of [
  ['same input and output', f => [f.input, f.input]],
  ['input under derived', f => [f.output, f.output]],
  ['output under private', f => [f.input, 'evidence/private/new.har']],
  ['input outside private', f => [`outside-${SECRET}.har`, f.output]],
  ['private prefix collision', f => [`evidence/private-escape/${SECRET}.har`, f.output]],
  ['derived prefix collision', f => [f.input, `evidence/derived-escape/${SECRET}.har`]],
  ['output traversal', f => [f.input, `evidence/derived/../../${SECRET}.har`]],
  ['input traversal', f => [`evidence/private/../../${SECRET}.har`, f.output]],
  ['input missing', f => [`evidence/private/${SECRET}.har`, f.output]],
  ['input directory', f => ['evidence/private/run', f.output]],
  ['output parent missing', f => [f.input, `evidence/derived/${SECRET}/new.har`]],
  ['input wrong type', f => [null, f.output]],
  ['output wrong type', f => [f.input, {}]],
]) test(`filesystem refuses unsafe/invalid path: ${name}`, async t => {
  const f = await tempFixture(t);
  await refusedExport(f, ...select(f));
  assert.equal(await fs.readFile(path.join(f.root, f.input), 'utf8'), f.bytes);
  await absent(path.join(f.root, f.output));
});

for (const [name, text] of [
  ['invalid JSON', `{"${SECRET}":`],
  ['invalid HAR envelope', JSON.stringify({ [SECRET]: SECRET })],
  ['malformed measurement', JSON.stringify(har([{ ...entry(), time: SECRET }]))],
]) test(`filesystem failure creates no output and exposes no source: ${name}`, async t => {
  const f = await tempFixture(t); await fs.writeFile(path.join(f.root, f.input), text);
  await refusedExport(f); await absent(path.join(f.root, f.output));
  assert.equal(await fs.readFile(path.join(f.root, f.input), 'utf8'), text);
});

test('existing regular output is never overwritten', async t => {
  const f = await tempFixture(t); await fs.writeFile(path.join(f.root, f.output), SECRET);
  await refusedExport(f);
  assert.equal(await fs.readFile(path.join(f.root, f.output), 'utf8'), SECRET);
  assert.equal(await fs.readFile(path.join(f.root, f.input), 'utf8'), f.bytes);
});

test('existing directory destination is refused without mutation', async t => {
  const f = await tempFixture(t); await fs.mkdir(path.join(f.root, f.output));
  await refusedExport(f); assert.deepEqual(await fs.readdir(path.join(f.root, f.output)), []);
});

for (const kind of ['private', 'derived']) test(`symlinked ${kind} evidence root is refused`, async t => {
  const f = await tempFixture(t);
  const original = path.join(f.root, `evidence/${kind}`), moved = path.join(f.root, `${kind}-${SECRET}`);
  await fs.rename(original, moved); await fs.symlink(moved, original, 'dir');
  await refusedExport(f); await absent(path.join(f.root, f.output));
  assert.equal(await fs.readFile(path.join(f.root, f.input), 'utf8'), f.bytes);
});

for (const confined of [false, true]) test(`input symlink is refused (${confined ? 'confined alias' : 'outside private root'})`, async t => {
  const f = await tempFixture(t), alias = 'evidence/private/alias.har';
  const target = confined ? path.join(f.root, f.input) : path.join(f.root, `${SECRET}.har`);
  if (!confined) await fs.writeFile(target, f.bytes);
  await fs.symlink(target, path.join(f.root, alias));
  await refusedExport(f, alias); await absent(path.join(f.root, f.output));
  assert.equal(await fs.readFile(target, 'utf8'), f.bytes);
});

test('input symlink parent is refused even when confined', async t => {
  const f = await tempFixture(t);
  await fs.symlink(path.join(f.root, 'evidence/private/run'), path.join(f.root, 'evidence/private/alias'), 'dir');
  await refusedExport(f, 'evidence/private/alias/synthetic.har'); await absent(path.join(f.root, f.output));
});

for (const confined of [false, true]) test(`output symlink parent is refused (${confined ? 'confined alias' : 'outside derived root'})`, async t => {
  const f = await tempFixture(t);
  const target = confined ? path.join(f.root, 'evidence/derived/run') : path.join(f.root, `outside-${SECRET}`);
  if (!confined) await fs.mkdir(target);
  await fs.symlink(target, path.join(f.root, 'evidence/derived/alias'), 'dir');
  await refusedExport(f, f.input, 'evidence/derived/alias/redacted.har');
  await absent(path.join(target, 'redacted.har'));
});

for (const kind of ['input', 'outside', 'dangling']) test(`existing output symlink is never followed: ${kind}`, async t => {
  const f = await tempFixture(t);
  const target = kind === 'input' ? path.join(f.root, f.input) : path.join(f.root, `${SECRET}.har`);
  if (kind === 'outside') await fs.writeFile(target, SECRET);
  await fs.symlink(target, path.join(f.root, f.output));
  await refusedExport(f);
  assert.equal(await fs.readlink(path.join(f.root, f.output)), target);
  if (kind === 'dangling') await absent(target);
  else assert.equal(await fs.readFile(target, 'utf8'), kind === 'input' ? f.bytes : SECRET);
});

test('input hardlink to an outside file is refused without reading or changing either alias', async t => {
  const f = await tempFixture(t), outside = path.join(f.root, `${SECRET}.har`);
  await fs.rename(path.join(f.root, f.input), outside);
  await fs.link(outside, path.join(f.root, f.input));
  await refusedExport(f); await absent(path.join(f.root, f.output));
  assert.equal(await fs.readFile(outside, 'utf8'), f.bytes);
  assert.equal((await fs.stat(outside)).nlink, 2);
});

for (const kind of ['input', 'outside']) test(`existing output hardlink is never overwritten: ${kind}`, async t => {
  const f = await tempFixture(t);
  const target = kind === 'input' ? path.join(f.root, f.input) : path.join(f.root, `${SECRET}.har`);
  if (kind === 'outside') await fs.writeFile(target, SECRET);
  await fs.link(target, path.join(f.root, f.output));
  await refusedExport(f);
  assert.equal(await fs.readFile(target, 'utf8'), kind === 'input' ? f.bytes : SECRET);
  assert.equal((await fs.stat(target)).ino, (await fs.stat(path.join(f.root, f.output))).ino);
});

test('CLI emits only the filtering summary on successful synthetic export', async t => {
  const f = await tempFixture(t);
  const result = command(f, ['--input', f.input, '--output', f.output]);
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, '');
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.sourceSha256, createHash('sha256').update(f.bytes).digest('hex'));
  assert.equal(summary.retainedEntries, 2); assert.equal(summary.cacheAttribution, 'UNKNOWN');
  assert.equal(summary.providerPlayable, 'UNKNOWN');
  assert.equal(result.stdout.includes(f.root), false); assert.equal(result.stdout.includes(SECRET), false);
});

for (const [name, args] of [
  ['no arguments', []], ['unknown flag', ['--secret', SECRET]], ['missing value', ['--input']],
  ['missing output', ['--input', SECRET]], ['flag as value', ['--input', '--output']],
  ['duplicate flag', ['--input', SECRET, '--input', SECRET]],
  ['trailing positional secret', ['--input', SECRET, '--output', SECRET, SECRET]],
  ['help with extra input', ['--help', SECRET]],
  ['missing secret path', ['--input', `evidence/private/${SECRET}.har`, '--output', 'evidence/derived/new.har']],
]) test(`CLI errors are fixed, with no argv/path/JSON/stack disclosure: ${name}`, async t => {
  const f = await tempFixture(t); assertCliFailure(command(f, args)); await absent(path.join(f.root, f.output));
});

test('CLI malformed JSON never prints parser excerpts', async t => {
  const f = await tempFixture(t); await fs.writeFile(path.join(f.root, f.input), `{"${SECRET}":`);
  assertCliFailure(command(f, ['--input', f.input, '--output', f.output]));
  await absent(path.join(f.root, f.output));
});

test('CLI refuses output overwrite with a generic error and preserves both files', async t => {
  const f = await tempFixture(t); await fs.writeFile(path.join(f.root, f.output), SECRET);
  assertCliFailure(command(f, ['--input', f.input, '--output', f.output]));
  assert.equal(await fs.readFile(path.join(f.root, f.output), 'utf8'), SECRET);
  assert.equal(await fs.readFile(path.join(f.root, f.input), 'utf8'), f.bytes);
});

test('CLI help states scope/unknowns and creates no output', async t => {
  const f = await tempFixture(t), result = command(f, ['--help']);
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.match(result.stdout, /NOT whole launch/); assert.match(result.stdout, /UNKNOWN/);
  await absent(path.join(f.root, f.output));
});
