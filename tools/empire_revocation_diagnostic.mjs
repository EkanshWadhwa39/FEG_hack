/** Safety diagnostic, never a latency benchmark. Provider activity is observed
 * outside the renderer; wrapper attachment by itself cannot qualify this check. */
import assert from 'node:assert/strict';
import { delta } from './empire_measurement.mjs';
export async function runLiveRevocation({ page, before, metrics, providerActivity,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), clock = Date.now }) {
  await page.selectOption('#authorization', 'GRANTED');
  // Do not await a renderer busy executing the unchanged provider.
  void page.locator('[data-game-id="title-01"]').evaluate(button => button.click()).catch(() => {});
  const deadline = clock() + 30000;
  while (providerActivity() !== 8 && clock() < deadline) await pause(100);
  assert.equal(providerActivity(), 8, 'Actual provider early-resource activity required before revocation');
  const activeTraffic = delta(before, await metrics());
  assert.ok(activeTraffic.requests >= 8);
  const requestedAt = clock();
  await page.locator('#revoke-access').click({ timeout: 60000 });
  const revocationActionMs = clock() - requestedAt;
  assert.equal(await page.locator('#frame-host iframe').count(), 0);
  assert.equal(await page.locator('#player-dialog').getAttribute('open'), null);
  assert.equal(page.frames().length, 1);
  // Allow in-flight socket writes to settle; report rather than erase their cost.
  const removed = await metrics(); const settlingStart = clock(); await pause(2000); const settled = await metrics();
  const settlingWindowMs = clock() - settlingStart;
  assert.ok(settlingWindowMs >= 2000 && settlingWindowMs <= 2250, 'Revocation sample outside fixed tolerance');
  const postRevocationRequests = delta(removed, settled).requests;
  assert.equal(postRevocationRequests, 0);
  return { status: 'PASS', providerEarlyAssetsBeforeRevocation: 8, revokedIframeRemoved: true,
    revocationActionMs, postRevocationRequests, settlingWindowMs,
    postRemovalTraffic: delta(removed, settled), traffic: delta(before, settled),
    limitation: 'Frame removal after real provider early requests; not provider accepted-input or human response-time acceptance.' };
}
