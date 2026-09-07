---
name: feg-demo-qa
description: Red-team and rehearse the FEG browser cache-warming prototype for demo
  truthfulness, accessibility, compliance, and failure recovery.
---
# FEG demo QA

Use after each implementation milestone and before the judge demo.

Read `AGENTS.md`, `CODE.md`, and `docs/HACKATHON-RUNBOOK.md`.

Test: isolated cache arms; desktop/mobile viewport; keyboard; reduced motion; Save-Data/unknown connection; hidden page; budget exhaustion; wrong locale/tier; fetch failure; authorization allow/deny/error/timeout; absent input-accepted signal; stale manifest; and identifier leakage.

Blocking invariants:
- no false `interactive` state from iframe load;
- only current authorization ALLOWED permits play;
- predictor never affects player-visible UI;
- no sensitive values in UI, logs, HAR displays, URLs, or screenshots;
- all values have evidence labels;
- treatment is warmed only by prototype code from a clean isolated context.

Return blocking failures first, each with reproduction steps, smallest fix, acceptance test, and safe judge-facing wording. Do not change architecture unless explicitly assigned.
