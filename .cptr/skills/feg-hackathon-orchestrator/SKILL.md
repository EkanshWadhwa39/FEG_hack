---
name: feg-hackathon-orchestrator
description: Coordinate implementation of the FEG Challenge 3 PSK browser cache-warming
  prototype using evidence-first gates and disjoint sub-agent ownership.
---
# FEG hackathon orchestrator

Use this skill for planning, delegating, integrating, or prioritizing work in this workspace.

1. Read `/home/ubuntu/FEG_hack/AGENTS.md`, `CODE.md`, and `Context/FINAL-PLAN.md` before acting.
2. Treat `CODE.md` hard rules as authoritative, but flag its cache-partition status conflict with the later Context documents until a reproducible artifact exists.
3. Keep one lead and at most two active specialists. Assign disjoint files. Only one process may conduct browser/cache experiments at a time.
4. Gate order: exact cache reuse → HAR harness → one-title isolated A/B → governor/compliance shell → policy toggle → polish.
5. Every delegated task specifies output, owned files, forbidden files, tests, edit permission, and stop condition.
6. Every handoff includes files changed, commands/results, risks, and next action.
7. Never allow framework churn, native work, service workers, fake HAR UI, fake RG checkpoints, SECONDARY warming, or unsupported causal/uplift claims.
8. Record accepted design changes in `docs/DECISIONS.md` and run `./scripts/check.sh` before integration.
