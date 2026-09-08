#!/usr/bin/env node
/**
 * Scoped HAR 1.2 export, NOT a whole-launch capture or proof of gameplay readiness.
 * One capture per invocation; never merge CONTROL/TREATMENT or deduplicate warm /
 * launch requests. Only exact EARLY_ASSETS on http://127.0.0.1:8101..8120 survive.
 * No URL parsing/normalization, query stripping, aliases or configurable origins.
 *
 * Exporter audit: Playwright 1.55.1, lib/server/har/harTracer.js:
 * createHarEntry/_onResponse/_onRequestFinished/_storeResponseContent write HAR
 * sizes, timings and response._transferSize. They write cache: {}, NOT cache-hit
 * flags. Only that reviewed creator/version admits _transferSize; arbitrary CDP,
 * Chrome, Resource Timing and inferred cache fields are NOT HAR exporter evidence.
 * Empty cache / zero transfer / 304 do not establish an HTTP-cache hit. Cache
 * attribution and provider readiness remain UNKNOWN; consult the separate runner
 * report/CDP evidence. Exporter identity is a format gate, not authentication.
 *
 * HAR-required empty strings/arrays and -1 request sizes are redaction placeholders,
 * not observations. Required response/timing measurements must be valid or export
 * fails closed (no silently repaired/dropped malformed in-scope requests). Numeric
 * values are copied except the narrowly gated bodySize=-headersSize exporter quirk:
 * standard bodySize becomes UNKNOWN (-1); original bodySize/compression survive in
 * numeric provenance extensions. Source measurements remain exporter-reported;
 * synthetic fixtures are SIMULATED, not experimental evidence.
 *
 * CLI (from worktree root; output parent must already exist):
 * node tools/redact_empire_har.mjs --input evidence/private/RUN/CONTROL.har \
 *   --output evidence/derived/CONTROL-early.har
 * Repeat per capture. Paths/errors/raw JSON are never printed. The stdout summary
 * hashes original bytes and reports MEASURED filtering counts only. Source files
 * are read-only; existing outputs (including symlink/hardlink aliases) are refused.
 * Filesystem guard assumes no concurrent malicious directory replacement.
 * API input is parsed JSON data, not executable objects/getters/proxies. This is
 * field minimization, not anonymization: exact measurement timestamps remain.
 * Exporter identity and numeric measurements are not authenticated by redaction.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Deliberately independent of mutable deployment/catalogue metadata. Neither HAR
// data nor a changed application manifest can enlarge this privacy boundary.
// The scoped test checks catalogue agreement; changes require explicit review here.
const reviewedPaths = Object.freeze([
  'assets/locale/en/gameContent.json',
  'assets/locale/en/commonContent.json',
  'assets/fonts/en/Mulish.ttf',
  'assets/images/@1x/brandLogo.png',
  'assets/fonts/en/NewRocker-Regular.ttf',
  'assets/fonts/en/Oswald-Bold.ttf',
  'assets/images/@1x/controlPanelPrimaryAssets.json',
  'assets/images/@1x/controlPanelPrimaryAssets.webp',
]);
const allowedUrls = new Map(Array.from({ length: 20 }, (_, i) =>
  reviewedPaths.map(assetPath => {
    const url = `http://127.0.0.1:${8101 + i}/${assetPath}`;
    return [url, url];
  })).flat());
const own = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const duration = value => finite(value) && (value === -1 || value >= 0);
const size = value => Number.isSafeInteger(value) && value >= -1;
const fail = () => { throw new TypeError('Invalid in-scope HAR measurement'); };
function timestamp(value) {
  // Exact UTC millisecond form emitted by Playwright, no permissive Date.parse junk.
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function timings(source, required, optional) {
  if (!object(source)) fail();
  const result = {};
  for (const key of required) {
    if (!own(source, key) || !duration(source[key])) fail();
    result[key] = source[key];
  }
  for (const key of optional) {
    if (own(source, key)) {
      if (!duration(source[key])) fail();
      result[key] = source[key];
    }
  }
  return result;
}

/** Pure parsed-JSON-to-JSON whitelist. No source objects or free-form strings escape. */
export function redactEmpireHar(raw) {
  try { return buildRedactedHar(raw); }
  catch {
    // No source exceptions, cause, excerpts or stack supplied by the input.
    throw new TypeError('HAR redaction refused; expected valid HAR 1.2 and in-scope measurements');
  }
}

function buildRedactedHar(raw) {
  if (!object(raw) || !object(raw.log) || raw.log.version !== '1.2'
      || !Array.isArray(raw.log.entries)) throw new TypeError('Expected HAR 1.2 entries');
  const reviewedExporter = raw.log.creator?.name === 'Playwright' && raw.log.creator?.version === '1.55.1';
  const pages = [], entries = [], pageIds = new Map();
  const sourcePages = Array.isArray(raw.log.pages) ? raw.log.pages : [];
  for (const entry of raw.log.entries) {
    if (!object(entry) || !object(entry.request) || entry.request.method !== 'GET'
        || !allowedUrls.has(entry.request.url)) continue;
    const response = entry.response;
    // Reviewed Playwright 1.55.1 quirk: cached transfer=0 minus headers produces
    // bodySize=-headersSize. Preserve provenance, mark standard size UNKNOWN.
    // This is exporter handling, never sufficient evidence of cache reuse.
    const exporterSizeQuirk = object(response) && reviewedExporter && response._transferSize === 0
      && size(response.headersSize) && response.headersSize > 1
      && response.bodySize === -response.headersSize;
    if (!timestamp(entry.startedDateTime) || !finite(entry.time) || entry.time < 0
        || !object(response) || !Number.isInteger(response.status) || response.status < 0 || response.status > 599
        || !size(response.headersSize) || (!size(response.bodySize) && !exporterSizeQuirk)
        || !object(response.content) || !size(response.content.size) || response.content.size < 0) fail();
    const content = { size: response.content.size, mimeType: '' };
    if (own(response.content, 'compression')) {
      // HAR compression is decoded minus encoded size; overhead may make it negative.
      // Preserve the exporter value, never clamp or recompute it from transfer bytes.
      if (!Number.isSafeInteger(response.content.compression)) fail();
      if (exporterSizeQuirk) {
        if (response.content.compression !== Math.max(0, response.content.size - response.bodySize)) fail();
      } else content.compression = response.content.compression;
    }
    const clean = {
      startedDateTime: entry.startedDateTime,
      time: entry.time,
      request: {
        method: 'GET', url: allowedUrls.get(entry.request.url), httpVersion: '',
        cookies: [], headers: [], queryString: [], headersSize: -1, bodySize: -1,
      },
      response: {
        status: response.status, statusText: '', httpVersion: '', cookies: [], headers: [],
        content, redirectURL: '', headersSize: response.headersSize, bodySize: exporterSizeQuirk ? -1 : response.bodySize,
      },
      cache: {},
      timings: timings(entry.timings, ['send', 'wait', 'receive'], ['blocked', 'dns', 'connect', 'ssl']),
    };
    if (exporterSizeQuirk) {
      clean.response._empireExporterBodySize = response.bodySize;
      if (own(response.content, 'compression')) clean.response._empireExporterCompression = response.content.compression;
    }
    if (reviewedExporter && own(response, '_transferSize')) {
      if (!size(response._transferSize)) fail();
      clean.response._transferSize = response._transferSize;
    }
    // Emit only referenced pages, with fixed IDs/titles, never source identifiers.
    if (typeof entry.pageref === 'string') {
      if (!pageIds.has(entry.pageref)) {
        const matches = sourcePages.filter(page => object(page) && page.id === entry.pageref);
        if (matches.length > 1) fail();
        if (matches.length === 1) {
          const page = matches[0];
          if (!timestamp(page.startedDateTime)) fail();
          const id = `page-${pages.length + 1}`;
          pages.push({ startedDateTime: page.startedDateTime, id, title: '',
            pageTimings: timings(page.pageTimings, [], ['onContentLoad', 'onLoad']) });
          pageIds.set(entry.pageref, id);
        }
      }
      if (pageIds.has(entry.pageref)) clean.pageref = pageIds.get(entry.pageref);
    }
    entries.push(clean);
  }
  return { log: { version: '1.2', creator: { name: 'Empire early HAR redactor', version: '1.0' }, pages, entries } };
}

function inside(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Local filesystem wrapper. Returns generated counts/digest only, never paths.
 * Errors are fixed for API callers too (not just CLI); no underlying error cause.
 * Accepts private input and a NEW derived output under root (default cwd).
 */
export async function exportEmpireHar(input, output, options = {}) {
  try { return await exportFile(input, output, options); }
  catch {
    throw new Error('HAR export refused; check arguments, evidence paths and HAR measurements');
  }
}

async function exportFile(input, output, { root = process.cwd() } = {}) {
  const base = await fs.realpath(root);
  const privateRoot = path.join(base, 'evidence/private');
  const derivedRoot = path.join(base, 'evidence/derived');
  // Do not let either evidence root itself redirect outside its declared location.
  if (await fs.realpath(privateRoot) !== privateRoot || await fs.realpath(derivedRoot) !== derivedRoot) {
    throw new Error('Evidence roots must not be symlinks');
  }
  const inputPath = path.resolve(base, input), outputPath = path.resolve(base, output);
  if (inputPath === outputPath || !inside(privateRoot, inputPath) || !inside(derivedRoot, outputPath)) {
    throw new Error('Private input and distinct derived output required');
  }
  const sourcePath = await fs.realpath(inputPath);
  const outputParent = await fs.realpath(path.dirname(outputPath));
  if (sourcePath !== inputPath || outputParent !== path.dirname(outputPath)
      || !inside(privateRoot, sourcePath)
      || (outputParent !== derivedRoot && !inside(derivedRoot, outputParent))) {
    throw new Error('Evidence path boundary rejected');
  }
  // Hardlinks have no canonical origin. Refuse multiply-linked sources instead of
  // admitting an outside file via a private-looking alias. Refuse symlink parents
  // even when confined, keeping the accepted filesystem boundary unambiguous.
  const sourceInfo = await fs.stat(sourcePath);
  if (!sourceInfo.isFile() || sourceInfo.nlink !== 1) throw new Error('Invalid source file');
  // wx rejects ALL existing destinations, including dangling symlinks/hardlinks.
  const destination = path.join(outputParent, path.basename(outputPath));
  const handle = await fs.open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== sourceInfo.dev || opened.ino !== sourceInfo.ino) {
      throw new Error('Source changed');
    }
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  let raw;
  try { raw = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Invalid HAR JSON'); }
  const redacted = redactEmpireHar(raw);
  const summary = {
    classification: 'MEASURED', scope: 'HAR filtering counts only; early assets, not whole launch',
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    inputEntries: raw.log.entries.length, retainedEntries: redacted.log.entries.length,
    omittedEntries: raw.log.entries.length - redacted.log.entries.length,
    exporterNegativeBodySizeCount: redacted.log.entries.filter(entry => own(entry.response, '_empireExporterBodySize')).length,
    cacheAttribution: 'UNKNOWN', providerPlayable: 'UNKNOWN',
  };
  // Finish serialization before creating any output. A write/close failure still
  // refuses export; a partial (already redacted) destination may need manual removal.
  const serialized = `${JSON.stringify(redacted, null, 2)}\n`;
  const target = await fs.open(destination, 'wx', 0o600);
  try { await target.writeFile(serialized); }
  finally { await target.close(); }
  return summary;
}

const usage = 'Usage: node tools/redact_empire_har.mjs --input evidence/private/FILE.har --output evidence/derived/FILE-early.har\n'
  + 'One capture at a time; existing output/aliases refused; output parent must exist.\n'
  + 'Exact eight early assets only, NOT whole launch. Cache attribution and gameplay readiness remain UNKNOWN.\n';
async function main(args) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(usage); return; }
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!['--input', '--output'].includes(key) || options.has(key) || !value || value.startsWith('--')) {
      throw new Error('Invalid arguments');
    }
    options.set(key, value);
  }
  if (options.size !== 2) throw new Error('Private input and derived output required');
  const summary = await exportEmpireHar(options.get('--input'), options.get('--output'));
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    // Never echo parser excerpts, raw fields, filesystem paths, argv or stack traces.
    process.stderr.write('HAR export refused; check arguments, evidence paths and HAR measurements.\n');
    process.exitCode = 1;
  });
}
