# Historical HAR milestone reconciliation

## Conclusion

The historical **35.5 s cold / 6.7 s warm** values are **MEASURED**, but they are **not evidence of first accepted input** and they are not the full HAR capture spans.

They are capture-start-to-completion times for the same exact final 16-request asset batch:

| Metric | Cold | Warm |
|---|---:|---:|
| Exact batch requests matched | 16/16 | 16/16 |
| Batch request start | 28.074–28.075 s | 6.700–6.701 s |
| Last successful batch response complete | **35.567518 s** | **6.713730 s** |
| Batch wire bytes | 716,931 | 0 |
| Exporter cache state | no positive cache marker | all 16 marked disk cache |

Rounded to one decimal place, the last-successful-response values are 35.6 s and 6.7 s. The previously written 35.5 s cold value is consistent with truncation or display rounding from this same event, but the source documents did not preserve their rounding method.

The exact 16 URL strings are byte-for-byte identical across the two captures. URLs remain in an ignored private manifest and are not printed by the measurement tool.

## Why the full spans are longer

`tools/measure_har.py` measures every non-data request from the first request start through the last request completion:

| Full-capture metric | Cold | Warm |
|---|---:|---:|
| HAR span | **76.357676 s** | **16.252864 s** |
| Requests | 177 | 155 |
| Wire bytes | 16,597,198 | 12,431 |

After the 16-request milestone batch completed, each HAR contains sparse script-initiated fetch/ping traffic after idle gaps. In the cold capture, later requests start at 41.445 s and 75.852 s; in the warm capture, later requests start at 8.466 s and 15.026 s. These trailing requests explain the 76.4 s / 16.3 s full spans. Their timing and request types are consistent with background activity, but the HAR alone does not establish product semantics.

## What the HAR cannot establish

Neither cold nor warm HAR contains a page record, user-timing mark, input event, or provider-authored signal that identifies when the spin control first accepted input. Therefore:

- authoritative input-accepted time: **UNKNOWN**;
- click-to-interactive time: **UNKNOWN**;
- click time or launch anchor: **UNKNOWN**;
- exclusion-register timing: **UNKNOWN**.

The safe historical claim is:

> **MEASURED — one production title, historical repeat-state comparison:** from capture start to completion of the same exact final 16-request asset batch, cold was 35.568 s and warm was 6.714 s. The corresponding full HAR spans were 76.358 s and 16.253 s because sparse background requests continued. These captures do not contain an authoritative input-accepted signal and do not prove prototype-caused improvement.

Do not label either measurement `click-to-interactive`, `playable`, or `first accepted input`.

## Reproduce privately

The committed harness accepts an ignored manifest containing exact URL strings and emits only aggregate counts and durations:

```bash
.venv/bin/python tools/measure_har.py \
  Devtools_games/casino.psk.hr_cold.har \
  Devtools_games/casino.psk.hr_warm.har \
  --milestone-manifest evidence/private/savanna-final-asset-batch.json
```

Manifest format:

```json
{"urls": ["exact URL kept in private storage"]}
```

A milestone is **MEASURED** only when every listed URL has an exact string match and at least one successful 2xx completion in each HAR. Any missing URL, including a version-query mismatch, makes that arm's milestone **UNKNOWN**.

## Future authoritative measurement

A future staging control/treatment run must inject or observe a provider-approved input-accepted event and record it independently of network completion. That event, not this asset-batch proxy and not iframe load/first paint, is the authoritative interactive milestone.
