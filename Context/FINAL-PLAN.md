# Final Plan: What We Have, What to Submit, and What to Build for the Demo

## The Three Source Documents — Resolved

| Document | Role in Final Submission | Status |
|---|---|---|
| `message.txt` (PSK web platform pitch) | **Primary submission document** → evolved into `FEG-Hackathon-Challenge3-Final-Submission.md` | Promoted to final |
| `empireofgold-bundle-analysis.md` (Bundle forensic analysis) | **Technical appendix** — cited throughout the final submission. Every claim verified against actual bundle (see `Bundle-Cross-Verification-Report.md`). | Appendix |
| `challenge3-strategic-analysis.md` (Native-SDK strategy) | **Demoted to background reading.** Its native interception mechanism is incompatible with the web-only PSK track. Only salvageable content: prefetch priority order (§3.3) and cache-key normalization rules (§3.2), which are already folded into the final submission. | Background |

## Deliverables Mapped to Brief Requirements

| Brief Requirement | Our Deliverable | File |
|---|---|---|
| **D1 — Working Prototype** | Browser-based cache-warming Governor embedded in lobby page, instrumented HAR waterfall | `FEG-Hackathon-Challenge3-Final-Submission.md` §7 |
| **D2 — Live Demo** | Side-by-side cold vs warm, favourite-prefetch vs unplayed-prefetch toggle, network-failure rollback | `FEG-Hackathon-Challenge3-Final-Submission.md` §7 |
| **D3 — Impact Case** | Quantified business outcome with cost-value, backed by 12-month PSK telemetry + stake data + event logs | `FEG-Hackathon-Challenge3-Final-Submission.md` §10 |
| **D4 — Compliance Note** | One-page EU baseline + Croatian RG mapping | `D4-Compliance-Note.md` |

## Files Produced

```
PSKHR/
├── FEG-Hackathon-Challenge3-Final-Submission.md    ← PRIMARY SUBMISSION (D1-D3)
├── D4-Compliance-Note.md                            ← D4 standalone
├── Bundle-Cross-Verification-Report.md              ← Evidence: all 40 claims verified
├── empireofgold-bundle-analysis.md                   ← Technical appendix (existing)
├── message.txt                                       ← Source of truth for data claims
├── challenge3-strategic-analysis.md                  ← Background reference
└── extracted/FEG Innovation Hackathon 2026/          ← FEG-provided data (unchanged)
```

## The Architecture Resolution: Browser Cache, Not Native SDK

The central conflict between `challenge3-strategic-analysis.md` and `message.txt` is **resolved**:

- `challenge3-strategic-analysis.md` proposes `shouldInterceptRequest` / `WKURLSchemeHandler` — a native WebView interception SDK
- `message.txt` proposes browser HTTP cache warming via `fetch()`/`<link rel="prefetch">` from the parent lobby page

**The resolution**: PSK is a web-only track. No native app build access is available. The web-only constraint makes the browser-cache approach the only feasible one. The browser mechanism is **MEASURED locally**: a parent fetch populated an HTTP-cache entry later reused by an iframe. Exact staging CORS/cache/partition behavior remains **UNKNOWN** while staging is unavailable.

## Data Verification Status

Every data claim in the final submission is verified:

| Claim | Source | Verified |
|---|---|---|
| 12-month PSK telemetry: 2.43 games/session, 16.14 sessions/player | `hackathon_casino_trends.xlsx` | ✅ Direct extraction |
| 5-market comparison: PSK lowest games/session, highest session frequency | Same file | ✅ All 5 markets computed |
| Provider concentration: top 5 = 69.8%, top 10 = 90.9% | `CA_MOM.csv` (4.2M rows) | ✅ Direct extraction |
| Event logs: 13,682 launches, 887 titles, top-10 = 34.7% | `top_casino_users_event_logs.csv` | ✅ Direct extraction |
| Historical HAR final 16-request asset batch: 35.568s → 6.714s; full-capture transfer ~16.6 MB → ~12 KB | Independent captures + committed parser | ✅ MEASURED as capture-relative network milestones; authoritative input-accepted time and prototype causality remain UNKNOWN |
| Bundle analysis: 40 claims checked | `empireofgold/` (379 files) | ✅ All 40 verified |
| offline-data-DTb4NQY9.js missing | `empireofgold/` | ✅ Confirmed absent |
| Zero anti-tamper, zero automation detection | All JS files grepped | ✅ Confirmed |

## Staging availability and sandbox target

The staging URL is unavailable because of a technical issue and will not be accessible during the hackathon. Build the environment-neutral prototype now for sandbox testing when staging is introduced later. During the outage, use synthetic credential-free fixtures and keep the UI labelled `SIMULATED`; do not substitute production traffic or represent local tests as staging validation. Environment-specific manifests, authenticated exclusion timing, and causal staging control/treatment evidence remain later gates.

## What to Build for Day 1 (Hackathon)

1. **Resource Governor module** (JavaScript, ~200 LOC):
   - `navigator.connection` gate
   - Performance Observer hook
   - Data-budget tracker
   - Per-session data-budget counter with visible toggle

2. **Prefetch engine** (JavaScript, ~300 LOC):
   - Dwell/hover trigger (150ms debounce on game tile mouseenter)
   - Prefetch priority queue (JS bundles → preloader → splash → primary)
   - Resolution selector (viewport/DPR → @0.5x or @1x)
   - Locale resolver (reads operator config from lobby)

3. **Transition screen component** (HTML/CSS/JS, ~150 LOC):
   - Operator-branded neutral overlay
   - Live RG clock (session duration from lobby state)
   - Screen-reader announcement path
   - `prefers-reduced-motion` honouring

4. **Demo harness** (HTML/JS, ~250 LOC):
   - Two-iframe side-by-side layout
   - Policy toggle (favourite vs unplayed prefetch)
   - Network-cut simulation button
   - Live HAR waterfall overlay

**Total build: ~900 LOC**, all client-side JavaScript. No server. No build step. No dependencies beyond the browser.

## What to Ask FEG Mentors (Hour 1)

1. Exclusion-register check: per-session or per-launch? Real latency?
2. Top 3 providers by stake (Amusnet, Pragmatic, Playtech) — do their bundles use similar cache conventions?
3. Later staging sandbox introduction and approved access for isolated HAR control/treatment capture
4. Confirmation that `pskh`r is the correct top-level site for cache partitioning

## The Judging-Criteria Alignment Summary

| Criteria | Weight | Our Position |
|---|---|---|
| Business impact | 30% | 12 months of PSK telemetry, 4.2M stake rows, 13,682 launch events — the discovery-suppression story is **measured**, not assumed. Session-to-game conversion 42–54% → targeting +15–25 pp. Cost: zero server-side changes, no CDN reconfiguration. |
| Customer experience | 20% | Switch = neutral transition, not white-flash page load. Splash appears instantly from cache. GPU upload continues in background while user sees animated splash. |
| Originality | 15% | "Warm state before click, not after" — not in the brief's suggested list. Unplayed-title prefetch vs favourite — the counterintuitive demo is a live toggle, not a slide. |
| Technical feasibility | 15% | Browser-native and dependency-light. No native app required. Parent-to-iframe reuse is measured only in the local diagnostic; target-environment cache/CORS/partition behavior remains UNKNOWN. |
| Product thinking | 10% | Single JS module the platform team drops into the lobby page. Manifest auto-generation from any bundle (bundles already analysed). 5 providers = 69.8% of stake — tractable integration surface. |
| Compliance by design | 10% | Croatian law, not generic EU baseline. RG-interstitial-as-mask explicitly rejected with rationale. Exclusion register committed in writing to never optimize. Predictor never reaches UI. Counter-metrics + kill criterion. |

## One Honest Statement to Lead With in the Demo

> *"We measured what the browser did across one historical cold/repeat title comparison. The same final 16-request asset batch completed at 35.568 seconds cold and 6.714 seconds warm from capture start, while the full HARs continued with sparse background traffic. That is a measured warm-state opportunity—not click-to-interactive and not yet proof that our prototype caused the difference. Locally, we separately proved that a parent fetch can populate the browser cache for a later iframe request. Staging causal validation remains the next gate."*

This is the thesis. Everything else is evidence and implementation detail.