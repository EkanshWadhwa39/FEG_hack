import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChildPids, attestLaunchProcesses } from '../../tools/empire_launch_checks.mjs';

test('strict bounded process identifiers', () => {
  assert.deepEqual(parseChildPids(' 11 22\n'), [11, 22]);
  assert.deepEqual(parseChildPids(''), []);
  for (const input of [null, '0', '-1', '1.1', 'x', '11 11', '9007199254740992']) assert.throws(() => parseChildPids(input));
});
function fixture(overrides = {}) {
  const texts = { '/proc/10/task/10/children': '11 12', '/proc/11/comm': 'python3\n', '/proc/12/comm': 'chrome\n', ...overrides.texts };
  const links = { '/proc/10/ns/net': 'net:[22]', '/proc/11/ns/net': 'net:[22]', '/proc/12/ns/net': 'net:[22]', ...overrides.links };
  return { pid: 10, readText: async key => { if (!(key in texts)) throw new Error('private'); return texts[key]; },
    link: async key => { if (!(key in links)) throw new Error('private'); return links[key]; } };
}
test('attests main browser and server in runner namespace without exposing process metadata', async () => {
  const result = await attestLaunchProcesses(11, fixture());
  assert.equal(result.serverAndBrowserShareRunnerNamespace, true);
  assert.doesNotMatch(JSON.stringify(result), /net:\[|python|\/proc/);
});
for (const [name, overrides] of [
  ['server outside namespace', { links: { '/proc/11/ns/net': 'net:[23]' } }],
  ['browser outside namespace', { links: { '/proc/12/ns/net': 'net:[23]' } }],
  ['empty namespace', { links: { '/proc/10/ns/net': '' } }],
  ['server not owned', { texts: { '/proc/10/task/10/children': '12' } }],
  ['browser absent', { texts: { '/proc/12/comm': 'other' } }],
  ['process exits during inspection', { texts: { '/proc/10/task/10/children': '11 13' } }],
]) test(name + ' fails closed', async () => {
  await assert.rejects(attestLaunchProcesses(11, fixture(overrides)), { message: 'LAUNCH_PROCESS_CONFINEMENT_UNVERIFIED' });
});
test('bad server PID rejected', async () => { await assert.rejects(attestLaunchProcesses(0, fixture())); });
