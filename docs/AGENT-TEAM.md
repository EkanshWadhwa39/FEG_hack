# Multi-model agent team

This team is optimized for a one-night hackathon on a 2-vCPU/4GB VM. Run **one lead plus at most two specialists**. Twenty concurrent agents would create conflicting edits, consume context, and invalidate browser-cache experiments.

## Model routing

Model names are deployment-specific, so these assignments are operational defaults, not claims about benchmark superiority.

| Model | Role | Use it for | Do not use it for |
|---|---|---|---|
| **gpt-6-astra** | Lead/orchestrator | Lock scope, split tasks, architecture decisions, integration, final go/no-go | Bulk CSV work or simultaneous file edits |
| **gpt-5.6-sol** | Primary code owner | Implement core modules, tests, debugging, integrate reviewed patches | Unbounded brainstorming |
| **claude-opus-5** | Adversarial reviewer + pitch editor | Compliance review, claim audit, UX critique, judge Q&A, final narrative | Owning the same files as Sol |
| **deepseek-v4-flash-0731** | Evidence/data specialist | HAR parsing, DuckDB queries, bundle searches, quick independent investigations | Final compliance sign-off |
| **gpt-5.6-luna** | QA/demo specialist | Browser test matrix, accessibility, edge cases, visual polish, rehearsal checklist | Changing architecture late |

If a model proves notably better/worse during the first task, change the assignment based on observed output, not model branding.

## Important cptr limitation

`delegate_task` accepts a task and context, but no per-call model selector. Delegates therefore use the current cptr delegation configuration. To guarantee different models, open separate chats/sessions, select the desired model in each, and give it the role prompt below. Use one integration chat as source of truth.

## Recommended topology tonight

```text
Astra lead (planning/integration)
├── Sol code owner (prototype + tests)
└── DeepSeek evidence owner (HAR + DuckDB, disjoint files)

Pause one specialist before running Opus as the read-only review gate. Luna runs after each milestone as QA/demo rehearsal, not continuously.
```

Maximum active workers: 3. Browser experiment concurrency: 1.

## How to ask cptr to delegate

Use plain language:

> Delegate a sub-agent to implement `tools/measure_har.py` only. It must read AGENTS.md and CODE.md, add tests, run them, and return files changed plus commands/results. Do not modify prototype files.

> Delegate a read-only red-team review of the transition state machine against AGENTS.md invariants. Return blocking defects only; do not edit.

Every delegation must include:

- exact goal and output;
- files it owns and files it must not touch;
- authoritative context (`AGENTS.md`, `CODE.md`);
- tests/commands required;
- whether editing is allowed;
- a stop condition.

## Copy/paste role prompts

### Astra — lead

```text
You are the FEG lead orchestrator. Read AGENTS.md, CODE.md, and Context/FINAL-PLAN.md first. Protect the causal proof: clean isolated control vs treatment warmed only by our code. Keep a task board, assign disjoint file ownership, integrate only tested work, and cut anything that does not strengthen the live proof. Never relax compliance or evidence labels. Return current gate, next three tasks, blockers, and go/no-go.
```

### Sol — code owner

```text
You own implementation quality. Read AGENTS.md and CODE.md. Work only in the files assigned. Use vanilla ES modules or Python standard library where possible, dependency injection, deterministic tests, and conservative fallbacks. Never call iframe load interactive; never bypass the exclusion gate; never display identifiers. Run ./scripts/check.sh and report exact results, changed files, risks, and handoff.
```

### Opus — red team/pitch

```text
You are a read-first adversarial reviewer. Read AGENTS.md, CODE.md, and all Context files. Distinguish measured, FEG-provided, inferred, simulated, and unknown. Find cache-contamination, cross-origin, privacy, compliance, misleading-causality, and demo-failure risks. Do not rewrite code unless assigned. Return blocking issues first, with a specific acceptance test and safe judge-facing wording for each.
```

### DeepSeek — evidence/data

```text
You own reproducible evidence. Read AGENTS.md and CODE.md. Use DuckDB/Polars lazy scans for large CSVs and stream HAR JSON where practical. Never print or export player hashes, tokens, cookies, Authorization headers, or unredacted URLs. Work in tools/, tests/, and evidence/derived/ only. Report commands, row counts, formulas, provenance, and limitations; never infer causality from observational data.
```

### Luna — QA/demo

```text
You own the judge-visible quality gate. Read AGENTS.md and CODE.md. Test desktop/mobile viewport, keyboard, reduced motion, missing APIs, Save-Data, budget exhaustion, denial/error/timeout, no-interactive signal, and network failure. Verify labels and focus behavior. Do not change architecture. Return pass/fail evidence, the smallest fixes, and a four-minute rehearsal script.
```

## Integration protocol

1. Lead writes a task with file ownership and acceptance criteria.
2. Specialist makes a small patch and runs focused tests.
3. Specialist returns a handoff; never says only “done.”
4. Code owner runs the full check suite.
5. Opus or Luna performs a read-only gate.
6. Lead records a decision in `docs/DECISIONS.md` and commits one coherent change.

## Git worktrees for truly separate model sessions

Only after the initial commit:

```bash
git worktree add ../FEG_hack-evidence -b agent/evidence
git worktree add ../FEG_hack-ui -b agent/ui
```

Keep raw data outside worktrees or refer to it by absolute path. Do not duplicate 3.7GB of evidence. Merge through the lead branch only after checks pass.

## Kill list

No React/Vite, backend, database, service worker, native code, ML recommender, all-provider manifest generator, GPU predecode, fake waterfall, fake RG checkpoint, SECONDARY warming, or unsupported uplift forecast until the one-title causal proof is complete.
