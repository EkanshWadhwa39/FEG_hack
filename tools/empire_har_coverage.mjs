/** Retrospective/runner evidence gates. Read-only HAR metadata, no browser actions.
 * Returned fields are fixed labels, counts and indices; no input strings escape.
 */
import { EARLY_ASSETS } from '../prototype/src/empire-catalogue.js';
export function inspectHarCoverage(raw, { titleIndex, clickedAtEpochMs, horizonMs, preparationTitles = [] }) {
  const valid = Number.isInteger(titleIndex) && titleIndex >= 0 && titleIndex < 20
    && Number.isFinite(clickedAtEpochMs) && Number.isFinite(horizonMs) && horizonMs > 0
    && Array.isArray(raw?.log?.entries) && raw.log.entries.every(e => e && typeof e === 'object')
    && Array.isArray(preparationTitles) && new Set(preparationTitles).size === preparationTitles.length
    && preparationTitles.every(ti => Number.isInteger(ti) && ti >= 0 && ti < 20);
  if (!valid) return { status: 'INCONCLUSIVE' };
  const lookup = new Map(Array.from({ length: 20 }, (_, ti) => EARLY_ASSETS.map(([path, , bytes], ai) =>
    [`http://127.0.0.1:${8101 + ti}/${path}`, { ti, ai, bytes }])).flat());
  const entries = raw.log.entries;
  const start = e => Date.parse(e.startedDateTime);
  const complete = (e, end) => e.request?.method === 'GET' && e.response?.status === 200
    && Number.isFinite(start(e)) && Number.isFinite(e.time) && e.time >= 0 && start(e) + e.time <= end;
  const pre = entries.filter(e => /^http:\/\/127\.0\.0\.1:(?:810[1-9]|811\d|8120)(?:\/|$)/.test(e.request?.url ?? '')
    && (!Number.isFinite(start(e)) || start(e) < clickedAtEpochMs));
  const unexpectedProviderRequests = pre.filter(e => !lookup.has(e.request?.url) || e.request?.method !== 'GET').length;
  const completePreparationTitles = Array.from({ length: 20 }, (_, ti) => ti).filter(ti => EARLY_ASSETS.every((_, ai) => {
    const matches = pre.filter(e => { const id = lookup.get(e.request?.url); return id?.ti === ti && id.ai === ai; });
    return matches.length === 1 && complete(matches[0], clickedAtEpochMs)
      && matches[0].response.content?.size === EARLY_ASSETS[ai][2];
  }));
  const selectedLaunchAssets = EARLY_ASSETS.map((_, ai) => {
    const matches = entries.filter(e => { const id = lookup.get(e.request?.url);
      return id?.ti === titleIndex && id.ai === ai && start(e) >= clickedAtEpochMs
        && start(e) <= clickedAtEpochMs + horizonMs; });
    return matches.length === 1 && complete(matches[0], clickedAtEpochMs + horizonMs)
      && matches[0].response.content?.size === EARLY_ASSETS[ai][2];
  });
  const preparationExact = unexpectedProviderRequests === 0 && pre.length === preparationTitles.length * EARLY_ASSETS.length
    && completePreparationTitles.length === preparationTitles.length
    && preparationTitles.every(ti => completePreparationTitles.includes(ti));
  return { classification: 'MEASURED', status: preparationExact && selectedLaunchAssets.every(Boolean) ? 'PASS' : 'FAIL',
    preClickProviderRequests: pre.length, unexpectedProviderRequests, completePreparationTitles,
    preparationExact, selectedLaunchAssetCount: selectedLaunchAssets.filter(Boolean).length,
    scope: 'Exact successful HAR URL/time/body-size coverage and no other pre-click provider requests. Cache attribution comes separately from CDP; gameplay UNKNOWN.' };
}
export function expectedPreparationTitles(record) {
  return record.arm !== 'TREATMENT' ? [] : record.name === 'keyboard-intent' ? [16] : [0, 1, 2];
}
