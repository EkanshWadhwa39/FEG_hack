/** Portable Node test/syntax entrypoints: no shell glob, find, xargs or Python. */
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
async function files(relative) {
  const result = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const item = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await files(item));
    else if (entry.isFile() && /\.m?js$/.test(entry.name)) result.push(item);
  }
  return result.sort();
}
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
if (process.argv[2] === 'test') {
  run(['--test', ...(await files('prototype/tests')).filter(file => file.endsWith('.test.mjs'))]);
} else if (process.argv[2] === 'syntax') {
  const paths = [...await files('prototype'), ...await files('tools'), ...await files('scripts')];
  for (const file of paths) run(['--check', file]);
  console.log(`Syntax checked ${paths.length} JavaScript files.`);
} else { console.error('Usage: node scripts/javascript_checks.mjs test|syntax'); process.exitCode = 2; }
