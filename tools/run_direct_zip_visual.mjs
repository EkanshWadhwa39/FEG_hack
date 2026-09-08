#!/usr/bin/env node
/** Human-annotated direct-ZIP visual timer. This is not a playable milestone. */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const usage = `Usage: npm run test:empire:visual -- --zip <private archive> [options]

Options:
  --runs <1-10>          Fresh visual runs (default: 3)
  --timeout-ms <number>  Maximum time to wait for a mark (default: 60000)
  --output <path>        Write aggregate JSON in addition to printing it
  --help                 Show this help

For each run, press F8 (Fn+F8 on some Macs) or Option+Shift+P when the
provider's Play button first becomes visible. Each run uses a fresh Chromium
process and no-store responses. The result is HUMAN-ANNOTATED visibility,
not proof that provider input was accepted.`;

if (argv.includes('--help')) {
  console.log(usage);
  process.exit(0);
}

function option(name, fallback = undefined) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}
function requireOption(name) {
  const value = option(name);
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}.\n\n${usage}`);
  return value;
}
function positiveInteger(name, fallback, minimum, maximum) {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) * 5) / 10;
}

const zipPath = requireOption('--zip');
const runs = positiveInteger('--runs', 3, 1, 10);
const timeoutMs = positiveInteger('--timeout-ms', 60000, 1000, 300000);
const output = option('--output');
if (output?.startsWith('--')) throw new Error('Missing --output path');
if (!process.stdin.isTTY) throw new Error('This visual test requires an interactive terminal');

const server = spawn(process.platform === 'win32' ? 'python' : 'python3', [
  'tools/direct_zip_visual_server.py', '--zip', zipPath,
], { stdio: ['ignore', 'pipe', 'inherit'] });
const input = createInterface({ input: process.stdin, output: process.stdout });
let activeBrowser;

async function serverPort() {
  return await new Promise((resolve, reject) => {
    let pending = '';
    const timer = setTimeout(() => reject(new Error('Direct ZIP server startup timed out')), 15000);
    server.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Direct ZIP server exited during startup (${code ?? 'signal'})`));
    });
    server.stdout.setEncoding('utf8');
    server.stdout.on('data', chunk => {
      pending += chunk;
      const newline = pending.indexOf('\n');
      if (newline === -1) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(pending.slice(0, newline)).port); }
      catch { reject(new Error('Direct ZIP server returned an invalid startup message')); }
    });
  });
}

async function runOnce(origin, run) {
  await input.question(`\nRun ${run}/${runs}: press Enter when you are ready. `);
  activeBrowser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const browserVersion = activeBrowser.version();
  const context = await activeBrowser.newContext({ viewport: null });
  let resolveMark;
  const markPromise = new Promise(resolve => { resolveMark = resolve; });
  await context.exposeBinding('__recordHumanPlayVisible', (_source, mark) => resolveMark(mark));
  await context.addInitScript(() => {
    let marked = false;
    addEventListener('keydown', event => {
      const hotkey = event.code === 'F8' || (event.altKey && event.shiftKey && event.code === 'KeyP');
      if (!hotkey || marked) return;
      marked = true;
      event.preventDefault();
      event.stopImmediatePropagation();
      void window.__recordHumanPlayVisible({
        elapsedMs: Math.round(performance.now() * 10) / 10,
        key: event.code === 'F8' ? 'F8' : 'Option+Shift+P',
      });
    }, true);
  });
  const page = await context.newPage();
  console.log('Opening the unchanged provider directly. Mark the FIRST visible Play button with F8 or Option+Shift+P.');
  let disconnected = false;
  activeBrowser.once('disconnected', () => { disconnected = true; resolveMark(null); });
  await page.goto(`${origin}/`, { waitUntil: 'commit', timeout: 30000 });
  await page.bringToFront();
  const mark = await Promise.race([
    markPromise,
    new Promise(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  const result = mark && Number.isFinite(mark.elapsedMs) && mark.elapsedMs >= 0
    ? { run, status: 'MARKED', humanPlayButtonVisibleMs: mark.elapsedMs, markerKey: mark.key }
    : { run, status: disconnected ? 'BROWSER_CLOSED_WITHOUT_MARK' : 'TIMED_OUT_WITHOUT_MARK', humanPlayButtonVisibleMs: null };
  if (result.status === 'MARKED') {
    console.log(`HUMAN-ANNOTATED: Play first visible at ${result.humanPlayButtonVisibleMs.toFixed(1)} ms.`);
    await new Promise(resolve => setTimeout(resolve, 400));
  } else {
    console.log(`UNKNOWN: ${result.status}.`);
  }
  if (activeBrowser?.isConnected()) await activeBrowser.close();
  activeBrowser = undefined;
  return { result, browserVersion };
}

try {
  const port = await serverPort();
  const origin = `http://127.0.0.1:${port}`;
  const results = [];
  let browserVersion = null;
  console.log('\nDirect ZIP visual timing test');
  console.log('- No Vault lobby, iframe wrapper, prefetch, route interception, or throttling');
  console.log('- Unchanged reviewed ZIP, localhost, no-store, fresh Chromium process per run');
  console.log('- Your keypress marks visibility only; it does not prove the button accepts input');
  for (let run = 1; run <= runs; run += 1) {
    const completed = await runOnce(origin, run);
    results.push(completed.result);
    browserVersion = completed.browserVersion;
  }
  const marked = results.map(result => result.humanPlayButtonVisibleMs).filter(Number.isFinite);
  const report = {
    label: 'HUMAN-ANNOTATED',
    scope: { title: 'Empire of Gold', browser: browserVersion, runsRequested: runs, runsMarked: marked.length },
    startMilestone: 'MEASURED — direct top-level navigation time origin',
    endMilestone: 'HUMAN-ANNOTATED — first frame where the tester saw the Play button',
    providerInputAccepted: 'UNKNOWN — no authoritative provider signal',
    conditions: [
      'Unchanged reviewed ZIP bytes served directly over loopback HTTP',
      'No Vault lobby, iframe wrapper, speculative requests, network route interception, or throttle',
      'All responses are no-store and every run uses a fresh Chromium process',
      'Human keypress latency and browser main-thread event delay are included',
    ],
    medianHumanPlayButtonVisibleMs: median(marked),
    minimumHumanPlayButtonVisibleMs: marked.length ? Math.min(...marked) : null,
    maximumHumanPlayButtonVisibleMs: marked.length ? Math.max(...marked) : null,
    results,
  };
  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  console.log(`\n${rendered}`);
  if (output) {
    await writeFile(output, rendered, { flag: 'wx' });
    console.log(`Wrote ${output}`);
  }
} finally {
  input.close();
  if (activeBrowser?.isConnected()) await activeBrowser.close();
  server.kill('SIGTERM');
}
