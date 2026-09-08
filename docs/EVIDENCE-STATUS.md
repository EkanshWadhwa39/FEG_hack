# Evidence status

## Measured from actual HARs (tools/measure_har.py — 2026-09-08)

Source files: `casino.psk.hr_cold.har` / `casino.psk.hr_warm.har` (private, not committed).
Aggregate output: `evidence/derived/har-comparison-cold-warm.json`.

| Metric | Cold HAR | Warm HAR | Delta |
|---|---|---|---|
| Elapsed (HAR entry span) | **76,358ms** [MEASURED] | **16,253ms** [MEASURED] | −60,105ms |
| Wire bytes | 16,597,198 B [MEASURED] | 12,431 B [MEASURED] | −16,584,767 B |
| Request count | 177 [MEASURED] | 155 [MEASURED] | −22 |
| Confirmed cache hits | 27 [MEASURED] | 140 [MEASURED] | +113 |
| Confirmed misses | 148 [MEASURED] | 14 [MEASURED] | −134 |

**Notes on these captures:**
- Cold HAR has **27 pre-existing cache hits** — the browser profile was not cleared before capture. Not a truly cold session.
- Elapsed (HAR span) includes sparse background requests after the main batch completes; see Timing-definition warning below.
- The 35.568s / 6.714s figures are MEASURED from the final 16-request asset batch — see `docs/HAR-MILESTONE.md`. These are NOT the full span.

Third capture `casino.psk.hr.har`: 168 requests, 11.4MB, 96.4s elapsed, 6 pre-existing cache hits. Likely a separate session; not used in comparison.

## Current known evidence

| Claim/artifact | Status | Safe use |
|---|---|---|
| Existing repeat-run transfer: ~16.6MB to ~12KB | MEASURED from supplied HAR pair | State as one captured cold/repeat comparison. |
| Existing cache counts | MEASURED, exporter semantics confirmed by measure_har.py classifier | Preserve UNKNOWN for the 2 unknowns in cold, 1 in warm. |
| Historical final 16-request asset batch: 35.568s cold to 6.714s warm | MEASURED from first non-data HAR request to last successful response in the exact batch | Asset-batch completion only; authoritative input-accepted time is UNKNOWN. See `docs/HAR-MILESTONE.md`. |
| Full HAR entry span (76.4s / 16.3s) | MEASURED by `tools/measure_har.py` | Diagnostic only; not click-to-interactive — includes trailing background requests. |
| **Production parent-to-iframe cache reuse, 9 container-shell assets** | **MEASURED** in Chromium 136.0.7103.25 against `casino.psk.hr` public demo play, 3 control + 3 treatment runs | **Treatment transfer 0 bytes vs control ~92.5 KB, identical 241,898 decoded bytes. Warmed by `prototype/src/warmer.js` itself. Container shell only — the provider bundle on `v1t.eu` is a different site and was never reached. See `docs/PRODUCTION-CACHE-REUSE.md`.** |
| Parent-to-iframe cache reuse, one local Empire of Gold static asset | MEASURED locally in Chromium 136.0.7103.25, 2 control + 2 treatment runs | Browser mechanism only: both treatment iframe requests were browser-cache hits with 0 server response-body bytes. Production behavior remains UNKNOWN; see `docs/LOCAL-CACHE-REUSE.md`. |
| Synthetic exact-URL and `no-store` negative controls | MEASURED locally in Chromium 136.0.7103.25, 2 runs each | Both controls forced full iframe network responses; CDP attribution identified exactly one iframe fixture request in every arm. |
| Synthetic top-level partition-boundary diagnostic | MEASURED locally in Chromium 136.0.7103.25, 2 runs | Cache reuse still occurred across mapped `lobby-a.test`/`lobby-b.test` top-level sites. Do not generalize; staging partition behavior remains UNKNOWN. |
| Connection prewarm impact | UNKNOWN | Historical setup cost is measured, but no approved before/after hint experiment exists; see `docs/CONNECTION-PREWARM.md`. |
| Staging availability during the hackathon | FEG-PROVIDED: unavailable because of a technical issue | State as an external validation constraint; do not imply staging testing occurred. |
| Exclusion-register latency | UNKNOWN | Cannot be measured without an approved authenticated environment; never invent and retain the mandatory fail-closed integration gate. |
| Cross-provider generalization | UNKNOWN beyond tested captures/static inspection | Report provider/title separately. |
| Native/WebView transfer | UNVERIFIED and out of scope | Future test only. |
| Empire of Gold archive structure/load stages | STATICALLY-INFERRED from supplied provider bundle | Use only as title/build-scoped development input; see `docs/BUNDLE-DEVELOPMENT-INPUTS.md`. Do not publish the archive or extracted assets. |

## Required causal-proof artifacts

These remain required for a production-relevant causal claim, but cannot be collected from staging during the hackathon. They are deferred—not waived—and must not be checked off using the local simulation.

- [ ] Browser/version/device and exact target title/provider recorded.
- [x] Historical asset-batch start/end milestone defined; future authoritative input-accepted milestone remains required.
- [ ] Clean isolated control profile/context.
- [ ] Clean isolated treatment profile/context.
- [ ] Treatment warmed only by prototype code before click.
- [ ] Exact warmed URLs shown reused during launch.
- [ ] At least one repeat of each arm.
- [ ] HARs redacted before any display/submission.
- [ ] Aggregate result generated by a committed script.
- [ ] No player hashes, tokens, cookies, Authorization headers, or exclusion payloads.

## Timing-definition warning

The HAR tool measures both full-capture span and, when given the ignored exact-URL manifest, the historical final asset-batch milestone. The latter completed at 35.568s cold and 6.714s warm from each capture's first non-data request. Sparse later traffic extends the full spans to 76.358s and 16.253s. Neither metric is click-to-interactive; authoritative input-accepted time remains UNKNOWN.

## Hackathon evidence boundary

Because staging is unavailable throughout the event, the submission may demonstrate the tested local mechanism, governor, resolver, and failure behavior, but must not claim a staging-validated or production-ready integration. Historical HARs may establish warm-state opportunity only; they do not become causal prototype evidence. The correct next step remains an organiser-approved control/treatment validation after environment access is restored.
