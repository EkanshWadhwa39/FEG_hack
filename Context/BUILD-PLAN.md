# Build plan of record — Challenge 3 (game load time)

**Status:** operational plan of record as of 8 September 2026.
**Supersedes** the task lists in [`FINAL-PLAN.md`](FINAL-PLAN.md) and the "Tonight / Tomorrow" sections of [`../CODE.md`](../CODE.md), both of which were written before the current repository state existed. Where this file and those disagree about *what to do next*, this file wins. Where they disagree about *what has been measured*, [`../docs/EVIDENCE-STATUS.md`](../docs/EVIDENCE-STATUS.md) wins.

Authoritative context, unchanged: [`../CODE.md`](../CODE.md) (facts), [`../AGENTS.md`](../AGENTS.md) (invariants), [`../docs/EVIDENCE-STATUS.md`](../docs/EVIDENCE-STATUS.md) (evidence labels), [`../docs/PRE-SUBMISSION-AUDIT.md`](../docs/PRE-SUBMISSION-AUDIT.md) (submission gate).

---

## 1. Where we actually are

The repository is already initialised and disciplined. Do not re-scaffold it.

| Layer | State |
|---|---|
| Structure, contracts, evidence discipline | **Done.** `CODE.md`, `AGENTS.md`, `docs/`, `Context/`, `scripts/`, `tools/`, `tests/`, `prototype/` |
| Measurement harness (`tools/measure_har.py`) | **Done**, 346 LOC, tested, redacting |
| Local cache-reuse diagnostic (`tools/run_cache_reuse.mjs`) | **Done.** Chromium 136, 2 control + 2 treatment runs, parent→iframe reuse confirmed on a local fixture |
| Prototype (`prototype/`) | **Scaffold only.** 6 modules, 23 JS tests, but it issues **zero** network requests. Every value on screen is labelled `SIMULATED` |
| Mandatory submission docs | **4 of 4 missing** — `impact-case.md`, `compliance-note.md`, `architecture.md`, `dependencies.md` |
| Reviewer-grade README, `demo/` assets, team/AI disclosure | **Missing** |
| This checkout's toolchain | **Not bootstrapped** — no `node`, `npm`, `shellcheck`, or `.venv` on PATH. `./scripts/check.sh` cannot run here |
| Datasets | **Not in this checkout.** `Devtools_games/` and `FEG Innovation Hackathon 2026/` are gitignored and absent. Provider bundle is at `~/evidence/private/bundles/empireofgold` (379 files) |

**Duplicate-checkout hazard.** `~/FEG_hack` is a stale second clone sitting 2 commits behind (`7fe320d`) with an SSH remote. `~/FEG_hack-1` (this one, HTTPS remote, `65eb939`) is current and matches `origin/main`. Work in **one** checkout only. Delete or rename the stale one before anyone edits the wrong tree.

---

## 2. The one thing standing between this repo and first place

The evidence rigour here is unusually strong and it is the reason the compliance and feasibility scores will hold up. But **rigour is 25% of the rubric and the demo is 65%.**

| Criterion | Weight | Where we stand |
|---|---:|---|
| Business impact | 30% | Data exists (4.2M stake rows, 13,682 launches, 12mo telemetry) but is **not written up**. `docs/impact-case.md` does not exist. |
| Customer experience | 20% | Nothing to show. The scaffold renders labels and a byte counter, not a lobby→game transition. |
| Originality | 15% | The favourite-vs-unplayed prefetch toggle — the actual differentiator — is **not built**. |
| Technical feasibility | 15% | **Strong.** Local mechanism proof + measurement harness + honest unknowns. |
| Product thinking | 10% | Partly there in docs, not in the artefact. |
| Compliance by design | 10% | **Strongest in the room, probably.** Fail-closed exclusion gate, no predictor→UI path, labelled unknowns. |

A judge in a 15-minute D2 slot sees the artefact, not the repo. Right now the artefact says "SIMULATED · no network request sent" in eight places. That is honest and it is also unwinnable as-is.

**So the whole plan below is: keep the honesty, and make the demo real.**

---

## 3. Target: what the demo must show

One screen, two arms, real bytes:

1. **Control arm** — clean context, warming disabled, launch a real public demo title, live waterfall, real transfer total, real click→milestone time.
2. **Treatment arm** — clean context, our prefetch fires on dwell/drawer-open, same title, same milestone. Warm cache visible as near-zero transfer.
3. **Policy toggle** — favourite-prefetch vs unplayed-prefetch, recomputing hit-rate live from the running system, not from a slide.
4. **Restraint** — flip Save-Data / exhaust the budget, watch the governor decline. Explain why declining is correct.
5. **Failure** — cut the network mid-switch, show clean rollback and no false `interactive` state.
6. **Every number on screen carries its label** — `MEASURED` / `SIMULATED` / `UNKNOWN`.

Point 6 is not a hedge, it is a differentiator. Most teams will show one confident number. Showing a labelled number next to a declared unknown reads as engineering maturity to a judging panel that includes compliance.

**Use the public psk.hr demo-play path. No login, no staging dependency, no permission needed.** Anything that needs FEG staging access is a bonus, never the critical path.

---

## 4. Four-person split

Browser-experiment concurrency stays at **1** (per `AGENTS.md`) — shared cache and network state invalidate evidence. Only one person runs capture at a time; that slot is booked, not improvised.

| Member | Owns | Files (exclusive) | Never touches |
|---|---|---|---|
| **M1 — Lead / integrator** | Scope cuts, integration, commits, go/no-go, judge Q&A | `docs/DECISIONS.md`, `README.md`, merges | Nobody else's files mid-task |
| **M2 — Prototype** | Real prefetch path, policy toggle, transition UI, governor wiring | `prototype/**` | `tools/`, `tests/` |
| **M3 — Evidence** | HAR captures, `measure_har.py` runs, popularity model from real data, `evidence/derived/` | `tools/**`, `tests/**`, `evidence/derived/**` | `prototype/**` |
| **M4 — Compliance & pitch** | The 4 missing docs, demo script, rehearsal, label audit | `docs/impact-case.md`, `docs/compliance-note.md`, `docs/architecture.md`, `docs/dependencies.md`, `demo/**` | Code |

M4's work is worth 40% of the rubric (business impact + compliance) and is entirely unblocked right now. **M4 starts immediately and does not wait for the prototype.**

---

## 5. Sequence

Blocks are ordered by dependency, not clock time. Do not start a block before its predecessor's exit criterion is met.

### Block A — unblock the environment (M1, ~30 min, blocks everyone)

`node`, `npm`, and `shellcheck` are absent. Nothing can be tested until this is fixed.

```bash
sudo dnf install -y nodejs npm ShellCheck    # Fedora 42
cd ~/FEG_hack-1 && ./scripts/bootstrap.sh && ./scripts/check.sh
```

**Exit:** `./scripts/check.sh` passes — 19 Python tests, 23 JS tests, ruff, syntax, shellcheck.
**If `sudo` is unavailable:** fall back to a nodeenv/nvm user install. Do not skip — an unrunnable check suite means a reviewer cannot validate the submission, which is an explicit organiser requirement.

### Block B — the four documents (M4, parallel with everything, no dependencies)

Draft from material already verified in `CODE.md` and `EVIDENCE-STATUS.md`. Do not invent a number; every figure carries its label.

- `docs/impact-case.md` — D3. The strongest section in the whole submission. Session-to-game conversion 42–54%; PSK lowest games/session (2.43) of 5 markets while highest session frequency (16.2); top-5 providers = 69.8% of stake so integration surface is 5 partners, not 887 titles; cost side is one JS module, zero server change, zero CDN reconfiguration. State the uplift as a target with a stated method, never as a forecast.
- `docs/compliance-note.md` — D4, one page. Map to the EU guide: GDPR (static assets, no player data, synthetic demo records), ePrivacy (visible user toggle for the data budget — this is a requirement, not a nicety), AI Act (rule-based predictor, never surfaced to the player, so no manipulative-design exposure), EAA/WCAG 2.1 AA (contrast, keyboard, `prefers-reduced-motion`, screen-reader announce path), and the Croatian layer — Act on Games of Chance, **exclusion register as a register-check, fail-closed, never cached, never raced**. Say explicitly that RG-interstitial-as-loading-mask was considered and rejected, with the reason. That rejection is a scoring moment.
- `docs/architecture.md` — web-only architecture **as implemented**. No native interception, no service worker, no cache-key normalisation. Those appear in `Context/challenge3-strategic-analysis.md` and are superseded; the audit flags them as a truthfulness risk.
- `docs/dependencies.md` — Playwright 1.52.0, Python dev deps, the FEG-provided datasets and provider bundle (with permission status), licences, and the AI/code-assistance disclosure.

**Exit:** all four exist, and no claim in them exceeds what `EVIDENCE-STATUS.md` supports.

### Block C — make the prototype real (M2 + M3, the critical path)

This is where the demo is won. Order matters.

1. **C1 (M3):** Capture a fresh cold/warm HAR pair from a public psk.hr demo title. Run `measure_har.py`. Codify the exact start and end milestone in the tool — `EVIDENCE-STATUS.md` warns that full-capture span is *not* click-to-interactive, and presenting the two as the same number is the most likely way to lose credibility under questioning.
2. **C2 (M2):** Replace `createSimulatedRequester()` with a real requester — `fetch(url, {mode:'no-cors'})`, concurrency 2, against the real versioned URLs of one title, with locale and resolution tier resolved *before* the first request fires. Both branching failure modes are documented in `CODE.md`; getting either wrong wastes ~30MB or cold-misses entirely.
3. **C3 (M2):** Dwell trigger (150ms on tile hover) plus `preconnect`/`dns-prefetch` on drawer-open. The preconnect is justified by measurement, not theory: `session/create` was 1,850ms of which 1,046ms was TCP connect and only 303ms was server wait.
4. **C4 (M3):** Control/treatment capture where treatment was warmed **only by our code**, from clean isolated profiles, one repeat per arm. This is the causal proof and the definition of done in `AGENTS.md`.
5. **C5 (M2):** Two-iframe side-by-side harness with live waterfall overlay and cache-hit indicator.

**Exit (C4 is the gate):** a redacted control/treatment pair, same title, same milestone, showing our warmed URLs reused at launch.
**Stop condition:** if parent→iframe reuse fails against the real production origin, do **not** build a governor around it. Pivot the demo to preconnect + the 712ms 404-probe fix + the measurement harness, and present the failed assumption honestly. A team that reports a disproved hypothesis with clean evidence still scores on feasibility and compliance; a team caught overclaiming scores zero on both.

### Block D — the differentiator (M2, only after C4 passes)

Favourite-prefetch vs unplayed-prefetch as a **live toggle**, hit-rate and seconds-saved computed by the running system for both. The popularity model comes from the real distribution M3 extracts (top-10 = 34.7% of launches; top-100 = 58% of stake), not a synthetic one.

The counterintuitive result — that prefetching *unplayed* titles may beat prefetching favourites, because favourites are already warm — is the single most memorable thing in this submission. It also lands the brief's actual complaint ("slow loads suppress discovery") rather than just the latency number. Protect the time for it.

### Block E — truthful transition + governor polish (M2)

Neutral transition screen. Clears only on an authoritative input-accepted signal — never on iframe load or first paint. Session clock and RG state from synthetic data. Governor: `navigator.connection`, Save-Data, budget exhaustion, page-hidden, frame-time regression. Missing APIs degrade conservatively.

### Block F — freeze (M1 + M4, Day 2 morning, non-negotiable)

Work `docs/PRE-SUBMISSION-AUDIT.md` top to bottom. Blocking items that will otherwise sink an otherwise-good submission:

- Redact the token-shaped value in `Context/empireofgold-bundle-analysis.md` and decide whether git-history remediation is needed.
- Confirm the provider bundle is **not** published anywhere, including any draft GitHub release.
- Mark `Context/challenge3-strategic-analysis.md` as superseded background so no reviewer mistakes the native-SDK proposal for the implemented architecture.
- Reviewer access tested, team/lead/AI disclosure added, `demo/` populated, clean-clone run from the README only, secret scan, final commit hash recorded.

---

## 6. How to answer the 500ms target

The brief asks for cold p50 **and p95 under 500ms**. Our own analysis says true-cold p95 under 500ms is not achievable — ~3.4MB must land before splash even renders.

Do not quietly redefine the metric and do not pretend to hit it. Say it directly:

> True cold p95 under 500ms is not reachable for a 97MB certified bundle; the physics of the first byte forbid it. What is reachable is making *cold* rare. We move the fetch to before the click, so the launch the player experiences is a warm launch. Here is the warm number, here is the cold number, and here is the fraction of launches we can convert from one to the other with a stated hit rate.

That reframing is stronger than a fudged number, and it is the answer a technical judge is hoping someone gives.

## 7. Leading line for the demo

> We didn't design a caching system. We measured what the browser already does on a repeat load. Warm is 6.7 seconds. Cold is 35.5. The only difference between those two runs was whether the browser had seen those URLs earlier in the session. Our entire solution is one JavaScript file that makes "earlier in the session" happen before the first click.

Immediately follow it with the scope: one title, one provider, one browser, this many runs. Claiming less than you proved, precisely, is what makes the rest of the numbers credible.

---

## 8. Kill list — do not build these

React/Vite, any backend, service worker, native or WebView code, ML recommender, all-provider manifest generator, GPU pre-decode, a fake waterfall, a fabricated RG checkpoint, SECONDARY-tier warming, or any uplift forecast that outruns the evidence.

## 9. Open questions for FEG mentors — ask in person, early, do not block on them

1. Exclusion-register check: per session or per launch, and what is its real staging latency?
2. Is the 6–8s baseline measured to first paint or to first accepted bet? (Their own telemetry says 25–31s — ask which number we are judged against.)
3. What authoritative event signals input-accepted for a cross-origin game?
4. Do other top-stake providers share the cache-control and CORS conventions found on the one bundle we analysed?
5. Is "Casino Android" (~72% of real launches) a WebView, and is future validation there in scope?
