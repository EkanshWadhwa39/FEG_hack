---
name: feg-evidence-audit
description: Analyze FEG HAR, CSV, spreadsheet, and bundle evidence safely, reproducibly,
  and without exposing player identifiers or credentials.
---
# FEG evidence audit

Use this skill for HAR comparison, data analysis, claim verification, or pitch-number review.

- Read `AGENTS.md` and `CODE.md` first.
- Use `.venv/bin/python`, DuckDB, or Polars lazy scans. Never load multi-GB CSVs eagerly with pandas.
- Work from raw inputs read-only. Write only aggregate, non-identifying outputs under `evidence/derived/`.
- Never print player hashes, tokens, cookies, Authorization headers, full credential-bearing URLs, or exclusion payloads.
- HAR cache hits require explicit exporter evidence. Zero transfer alone can remain UNKNOWN. Separate HTTP cache from service-worker responses and 304 validation.
- Label every result MEASURED, FEG-PROVIDED, STATICALLY-INFERRED, SIMULATED, or UNKNOWN.
- Report exact files, filters, row counts, formulas, commands, and limitations.
- Do not infer causality or business uplift from observational data.
- Scope bundle findings to the inspected provider/title and runtime findings to the exact captured browser/run.
