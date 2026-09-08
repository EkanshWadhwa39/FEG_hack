/** Local procfs attestation of the launched processes, not an egress policy by itself.
 * The isolated launcher owns firewall/routes; the Python server independently guards them.
 * Never return command lines, environment, provider URLs or namespace identifiers.
 */
import { readFile, readlink } from 'node:fs/promises';
export function parseChildPids(value) {
  if (typeof value !== 'string' || !/^(?:\s*[1-9][0-9]*)*\s*$/.test(value)) throw new Error('INVALID_PROCESS_CHILDREN');
  const ids = value.trim() ? value.trim().split(/\s+/).map(Number) : [];
  if (ids.some(id => !Number.isSafeInteger(id)) || new Set(ids).size !== ids.length) throw new Error('INVALID_PROCESS_CHILDREN');
  return ids;
}
export async function attestLaunchProcesses(serverPid, {
  pid = process.pid, readText = file => readFile(file, 'utf8'), link = readlink,
} = {}) {
  if (![pid, serverPid].every(id => Number.isSafeInteger(id) && id > 0)) throw new Error('INVALID_PROCESS_ID');
  try {
    const namespace = await link(`/proc/${pid}/ns/net`);
    if (!/^net:\[[1-9][0-9]*\]$/.test(namespace) || await link(`/proc/${serverPid}/ns/net`) !== namespace) throw new Error();
    const direct = parseChildPids(await readText(`/proc/${pid}/task/${pid}/children`));
    if (!direct.includes(serverPid)) throw new Error();
    let browserFound = false;
    // Playwright starts Chromium as a direct child over a pipe (no remote-debug TCP listener).
    for (const child of direct) {
      const comm = (await readText(`/proc/${child}/comm`)).trim();
      if (/^(?:chrome|chromium|headless_shell|chrome-headless)$/.test(comm)) {
        if (await link(`/proc/${child}/ns/net`) !== namespace) throw new Error();
        browserFound = true;
      }
    }
    if (!browserFound) throw new Error();
    return { classification: 'MEASURED', serverAndBrowserShareRunnerNamespace: true,
      boundary: 'Main Chromium process and guarded server; separate namespace/firewall guard also required' };
  } catch { throw new Error('LAUNCH_PROCESS_CONFINEMENT_UNVERIFIED'); }
}
