import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreparationScheduler } from '../src/content-demo-scheduler.js';
import { topPreparationCandidates } from '../src/content-demo-policy.js';
import { createSyntheticCatalogue } from '../src/catalogue.js';
import { createPopularityPrior, createSyntheticSession } from '../src/candidate-policy.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(patch = {}) {
  const calls = []; const events = []; let mode = 'TOP3'; let enabled = true;
  let variant = { build: 'synthetic-v1', locale: 'en', tier: '1x' };
  const loader = { cancel() {}, async prepare(args) { calls.push(args); return { status: 'REQUESTS_COMPLETE' }; }, ...patch.loader };
  const options = { loader, gameIds: Array.from({ length: 20 }, (_, i) => `title-${String(i + 1).padStart(2, '0')}`),
    getCandidates: () => ['title-01', 'title-02', 'title-03', 'title-04'],
    getVariant: () => variant, canPrepare: () => enabled, getMode: () => mode,
    onEvent: e => events.push(e), pause: async () => {}, ...patch, loader };
  return { calls, events, scheduler: createPreparationScheduler(options),
    mode(value) { mode = value; }, enabled(value) { enabled = value; }, variant(value) { variant = { ...variant, ...value }; } };
}
test('top-three ranker excludes played identities, handles favourite ties, never mutates visible catalogue', () => {
  const catalogue = createSyntheticCatalogue({ origin: 'http://127.0.0.1:8095' });
  const prior = createPopularityPrior({ catalogue }); const session = createSyntheticSession({ catalogue });
  const before = JSON.stringify(catalogue);
  const pick = policy => topPreparationCandidates({ catalogue, prior, session: session.snapshot(), policy });
  assert.deepEqual(pick('POPULAR_UNPLAYED'), ['title-01', 'title-02', 'title-03']);
  assert.deepEqual(pick('FAVOURITE'), []);
  session.recordPlayed('title-02'); session.recordPlayed('title-08'); session.recordPlayed('title-02'); session.recordPlayed('title-20');
  assert.deepEqual(pick('POPULAR_UNPLAYED'), ['title-01', 'title-03', 'title-04']);
  assert.deepEqual(pick('FAVOURITE'), ['title-02', 'title-20', 'title-08']);
  assert.deepEqual(pick('OFF'), []); assert.deepEqual(pick('unknown'), []);
  assert.equal(JSON.stringify(catalogue), before);
});
test('queue requests exactly the three selected identities, serially, and dedupes only exact variants', async () => {
  let active = 0; let peak = 0; const requests = [];
  const f = setup({ loader: { async prepare(args) { requests.push(args); peak = Math.max(peak, ++active); await tick(); active--; return { status: 'REQUESTS_COMPLETE' }; } } });
  await f.scheduler.startBackground();
  assert.deepEqual(requests.map(r => r.candidateId), ['title-01', 'title-02', 'title-03']); assert.equal(peak, 1);
  await f.scheduler.startBackground(); assert.equal(requests.length, 3);
  f.variant({ locale: 'hr-HR' }); await f.scheduler.startBackground(); assert.equal(requests.length, 6);
  f.scheduler.dispose();
});
test('hover passes the supported dwell intent for the exact non-popular title; keyboard focus uses same boundary', async () => {
  const f = setup(); f.mode('HOVER');
  await f.scheduler.startBackground(); assert.equal(f.calls.length, 0);
  await f.scheduler.hover('title-17');
  assert.deepEqual(f.calls[0].intent, { gameId: 'title-17', kind: 'HOVER_DWELL' });
  assert.equal(f.calls[0].candidateId, undefined);
  await f.scheduler.hover('title-18', 'FOCUS');
  assert.deepEqual(f.calls[1].intent, { gameId: 'title-18', kind: 'HOVER_DWELL' });
  await f.scheduler.hover('missing'); assert.equal(f.calls.length, 2);
});
test('priority switch invalidates stale top-three continuation; leave resumes remaining candidates', async () => {
  let release; const requests = []; let first = true;
  const f = setup({ loader: { async prepare(args) { requests.push(args); if (first) { first = false; await new Promise(r => { release = r; }); } return { status: 'REQUESTS_COMPLETE' }; } } });
  const top = f.scheduler.startBackground(); await tick();
  await f.scheduler.hover('title-09'); release(); await top;
  assert.equal(requests.length, 2); assert.equal(f.events.filter(e => e.type === 'FINISHED' && e.id === 'title-01').length, 0);
  await f.scheduler.leaveHover(); assert.equal(requests.length, 5);
});
test('stop/disable/off/dispose prevent admission and late completion events', async () => {
  const f = setup(); f.enabled(false); await f.scheduler.startBackground(); await f.scheduler.hover('title-12'); assert.equal(f.calls.length, 0);
  f.enabled(true); f.mode('OFF'); await f.scheduler.startBackground(); await f.scheduler.hover('title-12'); assert.equal(f.calls.length, 0);
  f.mode('TOP3'); f.scheduler.dispose(); await f.scheduler.startBackground(); await f.scheduler.hover('title-12'); assert.equal(f.calls.length, 0);
});
test('busy retry is bounded to once; failures are never marked completed', async () => {
  let calls = 0;
  const f = setup({ loader: { async prepare() { calls++; return { status: 'GOVERNOR_BLOCKED', reason: 'FOREGROUND_BUSY' }; } } });
  await f.scheduler.hover('title-11'); assert.equal(calls, 2); assert.equal(f.scheduler.snapshot().completedTitles, 0);
  const broken = setup({ loader: { async prepare() { throw Error('private'); } } });
  await broken.scheduler.hover('title-12'); assert.equal(broken.events.at(-1).status, 'REQUEST_FAILED');
});
test('candidate queue rejects duplicate/unknown identities before admission', async () => {
  const f = setup({ getCandidates: () => ['missing', 'title-02', 'title-02', 'title-03'] });
  await f.scheduler.startBackground(); assert.deepEqual(f.calls.map(r => r.candidateId), ['title-02', 'title-03']);
});
test('same-identity dwell reuses the active top-three request without cancellation or budget re-admission', async () => {
  let release; let cancels = 0; const requests = [];
  const f = setup({ loader: { cancel() { cancels++; }, async prepare(args) {
    requests.push(args); if (requests.length === 1) await new Promise(resolve => { release = resolve; });
    return { status: 'REQUESTS_COMPLETE' };
  } } });
  const top = f.scheduler.startBackground(); await tick();
  const initialCancels = cancels;
  const hover = f.scheduler.hover('title-01'); const focus = f.scheduler.hover('title-01', 'FOCUS');
  assert.equal(cancels, initialCancels); assert.equal(requests.length, 1);
  release(); await Promise.all([top, hover, focus]);
  assert.equal(requests.length, 1); assert.equal(f.scheduler.snapshot().completedTitles, 1);
  await f.scheduler.leaveHover(); assert.deepEqual(requests.map(r => r.candidateId), ['title-01', 'title-02', 'title-03']);
});
test('leaving a same-identity dwell before completion resumes the existing queue without abort', async () => {
  let release; let cancels = 0; const requests = [];
  const f = setup({ loader: { cancel() { cancels++; }, async prepare(args) {
    requests.push(args); if (requests.length === 1) await new Promise(resolve => { release = resolve; });
    return { status: 'REQUESTS_COMPLETE' };
  } } });
  const top = f.scheduler.startBackground(); await tick(); const initialCancels = cancels;
  const hover = f.scheduler.hover('title-01'); const leave = f.scheduler.leaveHover();
  assert.equal(cancels, initialCancels); release(); await Promise.all([top, hover, leave]);
  assert.deepEqual(requests.map(r => r.candidateId), ['title-01', 'title-02', 'title-03']);
});
