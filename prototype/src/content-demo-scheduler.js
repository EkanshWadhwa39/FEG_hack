/** Serial top-three queue plus higher-priority dwell. No DOM or player ordering. */
export function createPreparationScheduler({ loader, getCandidates, getVariant,
  canPrepare, getMode, gameIds, onEvent = () => {}, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const allowed = new Set(gameIds);
  let generation = 0;
  let hovered = null;
  let inFlight = null;
  let disposed = false;
  const completed = new Set(); // Bounded intent metadata, never response bodies.
  const key = id => JSON.stringify([id, getVariant().build, getVariant().locale, getVariant().tier]);
  const publish = event => { try { onEvent(Object.freeze(event)); } catch { /* Telemetry cannot break loading. */ } };
  function stop() { generation += 1; hovered = null; loader.cancel(); }
  const eligible = token => !disposed && token === generation && canPrepare();
  function request(id, source, token) {
    if (!eligible(token)) return Promise.resolve();
    const identity = key(id);
    if (completed.has(identity)) { publish({ type: 'SKIPPED', id, source, status: 'ALREADY_REQUESTED' }); return Promise.resolve(); }
    const job = { identity, source, token };
    inFlight = job;
    job.promise = (async () => {
      publish({ type: 'STARTED', id, source });
      let response;
      for (let attempt = 0; attempt < 2 && eligible(token); attempt += 1) {
        try {
          response = await loader.prepare({ ...getVariant(), ...(source !== 'TOP3'
            ? { intent: { gameId: id, kind: 'HOVER_DWELL' } } : { candidateId: id }) });
        } catch { response = { status: 'REQUEST_FAILED' }; }
        if (response.reason !== 'FOREGROUND_BUSY' || attempt > 0) break;
        publish({ type: 'DEFERRED', id, source, status: 'FOREGROUND_BUSY' });
        await pause(1200);
      }
      if (!eligible(token) || !response) return;
      if (['REQUESTS_COMPLETE', 'ALREADY_REQUESTED'].includes(response.status)) completed.add(identity);
      publish({ type: 'FINISHED', id, source, status: response.status, reason: response.reason });
    })().finally(() => { if (inFlight === job) inFlight = null; });
    return job.promise;
  }
  async function startBackground() {
    stop();
    const token = generation;
    if (!eligible(token) || getMode() !== 'TOP3') return;
    const ids = [...new Set(getCandidates())].filter(id => allowed.has(id)).slice(0, 3);
    publish({ type: 'PLAN', ids, source: 'TOP3' });
    for (const id of ids) {
      if (!eligible(token) || hovered !== null) return;
      await request(id, 'TOP3', token);
    }
    if (eligible(token) && hovered === null) publish({ type: 'IDLE', source: 'TOP3' });
  }
  async function hover(id, source = 'HOVER') {
    if (!allowed.has(id) || !['HOVER', 'FOCUS'].includes(source) || disposed || !canPrepare() || !['TOP3', 'HOVER'].includes(getMode())) return;
    // Changing priority for the SAME exact identity must not abort/re-reserve it.
    if (inFlight?.identity === key(id) && eligible(inFlight.token)) {
      hovered = id;
      return inFlight.promise;
    }
    stop(); hovered = id;
    await request(id, source, generation);
  }
  function leaveHover() {
    if (hovered === null) return;
    if (inFlight?.source === 'TOP3' && eligible(inFlight.token)) {
      hovered = null; // Existing serial queue can continue; do not cancel it.
      return inFlight.promise;
    }
    return startBackground();
  }
  return Object.freeze({ startBackground, hover, leaveHover, stop,
    dispose() { disposed = true; stop(); completed.clear(); },
    snapshot: () => ({ completedTitles: completed.size, hovered, disposed }),
  });
}
