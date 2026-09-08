# Hackathon runbook

## Tonight: gates in order

### Gate 0 — environment

```bash
./scripts/bootstrap.sh
./scripts/check.sh
```

### Gate 1 — reproduce cache reuse

The local browser-mechanism diagnostic is reproducible with:

```bash
npx playwright install chromium
npm run experiment:cache-reuse
```

It runs two controls and two treatments in fresh Chromium processes against a synthetic 1 MiB object. It must report a full control iframe response, one completed treatment prefetch, zero treatment iframe-phase origin responses, zero iframe `transferSize`, and an explicit Chromium cache marker. See `docs/LOCAL-CACHE-REUSE.md` for the measured title-scoped private-fixture repetition and limitations.

This local pass does not close the staging or production gate. Staging is unavailable during the hackathon, so build the sandbox-compatible path now but defer the real environment run. When staging is introduced later, use fresh profiles serially and repeat from the actual lobby/top-level context with the game's exact credential-free URL, mode, credentials, headers, and normal iframe launch. Record browser version, parent/iframe/asset origins, request semantics, and save a redacted HAR. Repeat from another clean profile.

**Stop:** if exact parent-to-iframe reuse fails in the target environment, do not build a governor around it. Pivot to measurement/preconnect/404 evidence and report the failed assumption honestly.

### Gate 2 — measurement harness

Run the HAR tool against existing captures, verify definitions manually, and create a sanitized JSON/Markdown summary. Never present raw HAR files.

### Gate 3 — one-title warming

During the outage, implement and locally test the sandbox contract with a synthetic exact locale/tier manifest and maximum concurrency 2. Keep environment-specific URLs/configuration separate from the generic core.

When staging is introduced later, treatment starts from a clean isolated profile and is warmed only by prototype code. Use one exact observed staging locale/tier manifest and capture control and treatment to the same observable milestone. Until then, this gate remains open and the UI remains `SIMULATED`.

### Gate 4 — safety/product shell

Add user toggle, budget, conservative connection fallback, cancellation, mandatory exclusion gate, truthful transition, and rollback.

### Gate 5 — differentiator

Only now add favourite vs unplayed policy and a small operator-only comparison. It must not alter player-facing catalogue order.

## Four-minute demo

1. **Measured opportunity (20s):** historical exact 16-request asset-batch completion: 35.568s cold vs 6.714s repeat from capture start; full-capture transfer was approximately 16.6MB vs 12KB. Say this shows warm-state opportunity, not click-to-interactive or prototype causality.
2. **Mechanism (20s):** bounded static-asset warm before click; certified game and mandatory checks untouched.
3. **Control (50s):** clean isolated context, warming disabled, declared start/end milestone.
4. **Treatment (60s):** second clean context; show intent trigger and exact warming before click, then same launch.
5. **Evidence (40s):** redacted traces and same-milestone table. Scope to exact title/provider/browser/runs.
6. **Restraint (30s):** show governor decline on Save-Data/budget and explain why doing nothing can be correct.
7. **Failure (30s):** simulated fetch failure clearly marked SIMULATED; no false-ready state and clean rollback.
8. **Close (30s):** PSK opportunity metrics; explain that the build is ready for later staging sandbox validation, while authenticated exclusion timing, causal control/treatment evidence, and more providers remain open gates.

## Questions for FEG in hour one

1. When staging is introduced, is exclusion-register authorization per session or per launch, and what event may be safely measured without exposing its payload?
2. What authoritative event means input is accepted for cross-origin games?
3. Which exact browser/device and milestone define the judging target?
4. Can lobby integration access versioned per-game asset manifests and launch locale/tier?
5. Which providers permit parent-origin prefetch under production CSP/CORS/cache headers?
6. Is the Casino Android label a WebView, and is any future validation in scope? Do not claim it today.

## Safe wording

- “In this measured capture…” not “always.”
- “Warm-state upside was 5.3× in one repeat run” not “our code achieved 5.3×.”
- “The prototype is web-only” not “all devices.”
- “Static objects are not intended to contain player data” not “zero personal data processing.”
- “No certified bundle modification” not “zero platform changes.”
- “Click to [actual milestone]” unless authoritative input acceptance is available.

## Evidence levels

1. Prototype causal evidence: clean isolated control/treatment.
2. Direct production measurements: existing HAR pair.
3. FEG observational data: business opportunity, not causality.
4. Static bundle analysis: one provider/title unless expanded.
5. Simulation/proposal/unknown: label visibly.
