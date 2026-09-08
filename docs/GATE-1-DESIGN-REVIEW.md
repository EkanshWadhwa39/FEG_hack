# Gate 1 — Design & Architecture Review

**Challenge 3 — Game load time** · Track: Croatian brand (PSK) · 8 September 2026, T+03:00

Purpose: the design direction we are locking before core build, what it rests on, and what we
need from mentors. Every figure below carries its evidence label. Nothing here is a forecast.

---

## 1. The proposition, in one line

Games are slow to reach because the browser fetches them **after** the click. We move the fetch
**before** the click, using the browser's own HTTP cache, with no change to certified game code.

## 2. What this rests on — the evidence ladder

We separate what we measured from what we were told from what we assume. This ordering is the
design.

| # | Claim | Label | Scope |
|---|---|---|---|
| 1 | Repeat load of the same title: 35.5s → 6.7s, 16.6 MB → 12 KB over the wire, 15/150 → 139/149 requests cached | **MEASURED** | One historical cold/warm HAR pair, one title (Savanna Sunrise Deluxe), one browser |
| 2 | A parent-page `fetch()` creates cache state a same-site iframe reuses: 1,292,928 bytes served, 0 bytes on the iframe request, Chromium cache flag set | **MEASURED** | Local fixture, Chromium 136.0.7103.25, 2 control + 2 treatment runs. **Local mechanism only — not production** |
| 3 | `session/create` costs 1,850 ms, of which 1,046 ms is TCP connect, 494 ms DNS, 321 ms SSL, and only 303 ms is server wait | **MEASURED** | One capture. 86% is connection setup, which is what justifies `preconnect` |
| 4 | A 404 probe (`GameView/Egaming`) burns 712 ms before falling back | **MEASURED** | One capture. Free to fix |
| 5 | Session-to-first-game-launched runs 25–31s across 12 months | **FEG-PROVIDED** | Contradicts the brief's 6–8s. We must ask which we are judged against |
| 6 | Top 10 titles = 34.7% of launches; top 5 providers = 69.8% of stake | **FEG-PROVIDED** | Makes a 5-provider integration surface realistic |
| 7 | Session-to-game conversion 42–54%; PSK lowest games/session (2.43) of 5 markets but highest session frequency (16.2) | **FEG-PROVIDED** | High loyalty, low discovery — the brief's own complaint, measured |
| 8 | Asset URLs are content-hashed and stable; zero anti-tamper; cache-control in the tens of years | **STATICALLY-INFERRED** | One provider bundle (Spiniq / Empire of Gold). Not generalised |
| 9 | Exclusion-register check latency | **UNKNOWN** | Never modelled, never raced. Blocking by design |
| 10 | Production CORS/CSP/partitioning behaviour | **UNKNOWN** | The one assumption that can still sink this. See §7 |

**Claim 1 is not proof of our solution.** It proves warm state is worth 28 seconds. It does not
prove our code can create that warm state. Claim 2 is the mechanism, and only locally.

## 3. Architecture

Web and mobile web only. No native layer, no service worker, no custom cache, no provider-code
change. Everything is a single JavaScript module the platform team drops into the lobby page.

```
Player browsing lobby
        │
        ├─ Drawer opens (user-initiated: favourites / recents / search)
        │       └─→ preconnect + dns-prefetch to the session endpoint
        │           (justified by claim 3: 86% of 1,850ms is connection setup)
        │
        ├─ Dwell 150ms on a tile ──→ intent (one-way, cache-only, never shown to player)
        │
        ▼
   Resource Governor
   navigator.connection · Save-Data · page visibility · frame-time · byte budget
   max concurrency 2 · degrades conservatively when an API is missing
        │
        ▼
   Warm exact URLs: PRELOADER + COMMON + SPLASH + critical PRIMARY
   locale and resolution tier resolved BEFORE the first request
   SECONDARY never proactively warmed
        │
   ── player taps launch ──
        │
        ▼
   Neutral transition screen (truthful, RG state visible)
        │
        ├─ Exclusion-register check: BLOCKING, never cached, never raced
        │
        ▼
   Game iframe loads → requests hit the warm cache
   Screen clears ONLY on an authoritative input-accepted signal
```

Two failure modes found in the actual bundle that the design must respect:

- **Resolution branching.** The game picks `@1x` or `@0.5x` *after* its JS executes. Resolve the
  device tier before warming or waste ~30 MB warming both, or cold-miss the wrong one.
- **Locale branching.** Asset paths are `assets/locale/${language}/…`, injected at runtime by the
  operator frame. Read launch config before warming.

## 4. Scope

**In:** lobby-side prefetch, governor, drawer, transition screen, measurement harness,
policy comparison, compliance guardrails.

**Out:** provider code, certified logic, game mechanics or payouts, native app builds,
service workers, cache-key normalisation, any ML recommender.

## 5. The platform question — we are raising this, not hiding it

Sampling the casino event log we were given (**MEASURED today, see caveat**), the platform mix is
roughly **10:1 against web**: `Casino Android` 40,023 events versus `web` 3,981.

Our position:

> The mechanism is HTTP cache warming against stable content-hashed URLs. That is standard
> browser behaviour, and a WebView is a browser. We expect it to transfer to the Android client.
> **We have not verified that and we are not claiming it.** We are proving the mechanism on the
> surface we can actually instrument, because we have no native build access.

**Caveat on our own number:** this is the first 200,000 rows of
`top_casino_users_event_logs.csv` in **file order**, not a random sample. The file may be sorted,
so this is an indication, not a population statistic. A full scan is queued before any of it
reaches a slide.

## 6. What the data told us about the drawer

Same sample, `casino_game_launch` events by originating route:

| from_route | launches |
|---|---:|
| `null` | 10,010 |
| `lobby` | 517 |
| `user-my-games` | 93 |
| `jackpots` | 34 |
| `providers` | 28 |
| `promotions` | 5 |

Two honest readings:

1. **93% of launches carry no route attribution.** Any "players launch from X" claim rests on the
   remaining 7%. We need to know from mentors whether that is an instrumentation gap.
2. Among attributed launches, **`user-my-games` is the second-largest origin.** That is the
   favourites/recents surface. Our non-personalised drawer is not a compliance concession — it is
   where players already go.

### Data triage

**Using:** `top_casino_users_event_logs.csv` (route/session/timestamp/game/provider),
`CA_MOM.csv` (stake aggregates), `CA_Player.csv` (player-level stake, hashed IDs),
`top_casino_users_event_logs_v2.xlsx` (newer revision, diff pending).

**Deliberately ignoring — 2.7 GB of the 3.9 GB:** `EPS_Offers.csv` (1.7 GB) is sportsbook
**odds and markets** despite the name, not bonus offers. `SB_Player.csv`, `SB_MOM.csv`, and
`top_sport_users_event_logs.csv` are sportsbook. None of it touches game load time.

## 7. Risks and kill criteria

| Risk | Response |
|---|---|
| **Parent→iframe reuse fails against the real production origin** | This is the whole architecture. If it fails, we do **not** build a governor around it. We pivot to measurement + preconnect + the 712 ms 404 fix and report the disproved assumption with clean evidence. Decided in advance, on purpose |
| Cross-provider generalisation | One bundle analysed. We report per-provider and do not claim the catalogue |
| Exclusion-register latency unknown | Treated as an unknown-latency blocking call. Never cached, never raced, never optimised around |
| Cold p95 < 500 ms is unreachable | We say so directly. See §8 |
| Route attribution is 93% null | Flagged before use; not presented as a population statistic |

## 8. How we answer the 500 ms target

True cold p95 under 500 ms is not achievable for a 97 MB certified bundle — roughly 3.4 MB must
land before splash renders. We will not quietly redefine the metric.

> Cold p95 under 500 ms is not reachable; the first byte forbids it. What is reachable is making
> *cold* rare. We move the fetch before the click, so the launch the player experiences is a warm
> launch. Here is the warm number, here is the cold number, and here is the fraction of launches
> we convert between them at a stated hit rate.

## 9. Compliance by design

- Exclusion-register authorization is **blocking**. Error, timeout, malformed response, and denial
  all fail closed.
- **Prediction never reaches the player.** It drives the cache only. The drawer is favourites,
  recents, and search — enforced structurally: rendered items are projected onto an
  `id`/`title`/`provider` whitelist, and 14 predictor field names throw rather than being ignored.
- The transition screen may report `interactive` **only** from an authoritative input-accepted
  signal. First paint, iframe load, and elapsed timers are explicitly rejected.
- No fabricated checkpoint. We never manufacture a fake reality check to fill loading time.
- The launch indicator is **indeterminate** — a progress bar predicting a completion time we
  cannot know would be a dark pattern.
- Counter-metrics (stake velocity, time on device) exist to detect whether faster launches make
  play more intense. They are **operator-only** and never shown to a player.
- Every number carries `MEASURED` / `FEG-PROVIDED` / `STATICALLY-INFERRED` / `SIMULATED` /
  `UNKNOWN`. No real player data is used anywhere in the build.

Full accessibility evidence, including measured contrast ratios and stated limitations, is in
[`ACCESSIBILITY.md`](ACCESSIBILITY.md).

## 10. Status entering Gate 1

| Component | State |
|---|---|
| Measurement harness (`tools/measure_har.py`) | Built, tested |
| Local cache-reuse proof | Passing, local only |
| Player surface: drawer, transition, governor-aware UI | Built, 92 tests green, browser-verified |
| RG state + counter-metric stubs | Built, synthetic, swappable source seam |
| Accessibility evidence | Documented with limitations stated |
| **Real prefetch against production URLs** | **Not built — this is the critical path** |
| **Control/treatment capture warmed by our own code** | **Not captured — this is the proof gate** |
| Policy comparison (favourites vs unplayed) | Not built. Highest-value differentiator |
| `docs/architecture.md`, `impact-case.md`, `compliance-note.md`, `dependencies.md` | Missing. Required for submission |

## 11. Questions for mentors

1. Is the exclusion-register check per session or per launch, and what is its real staging latency?
2. Is the 6–8s brief baseline measured to first paint or to first accepted bet — and are we judged
   against that or against the 25–31s in FEG's own telemetry?
3. What authoritative event signals input-accepted for a cross-origin game?
4. Why is `from_route` null on ~93% of `casino_game_launch` events — instrumentation gap, or do
   those launches genuinely have no origin?
5. Is `Casino Android` a WebView? Is any future validation there in scope?
6. Do other top-stake providers share the cache-control and CORS conventions found on the one
   bundle we analysed?
7. **There is a Cisco AnyConnect VPN installer in the asset bundle.** Is that intended — i.e. is
   staging access coming — or did it leak in by accident?
