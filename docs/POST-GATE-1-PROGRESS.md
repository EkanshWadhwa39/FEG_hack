# What was implemented after Gate 1

Period: from the Gate 1 design review to the Gate 2 build-health checkpoint, 8 September 2026.
Baseline commit `9c76336` (the Gate 1 deck update).

**7 commits · 12 new files · ~1,830 lines added · 185 tests passing** (137 JavaScript, 48 Python),
with `./scripts/check.sh` green end to end.

At Gate 1 we had a proven mechanism and no answer to "should you use it". This period built the
answer, and the answer turned out to be more interesting than the mechanism.

---

## 1. Prefetch policy — measured, not assumed

`tools/predictor_eval.py`, `docs/PREFETCH-POLICY.md`

Gate 1 left an open challenge to ourselves: a 99.7% byte saving on a launch that never happens is
pure waste. So we measured hit rate on the FEG event log — 3,337 scored predictions across 779
test sessions, split by time so no policy is scored on data it was built from.

| Policy | hit@1 | hit@3 | hit@5 |
|---|---:|---:|---:|
| **repeat-own-session** | **30.4%** | **46.0%** | **50.8%** |
| markov+repeat | 12.4% | 21.9% | 28.4% |
| markov-next (collaborative) | 11.4% | 18.4% | 22.1% |
| popular-global | 5.5% | 6.9% | 15.2% |

**We built the collaborative "players who played X then played Y" model and it lost by 2.7×.**
Players return to a title they just launched; they do not discover a similar one. The simplest
signal won.

That result also removed a compliance problem rather than mitigating one: warming a player's own
recent titles needs no behavioural model, no cross-player inference, and no profile. The
non-profiling option won **on merit before it won on compliance**.

The cost table is deliberately unflattering: at 11.25 MB per title, every policy wastes more than
it saves at every k, and k=1→k=5 buys 20 points of hit rate for 5× the bytes. Conclusion: **k=1**,
warm a critical subset rather than a bundle, and let the governor decline entirely.

## 2. Dwell as an intent signal

`prototype/src/dwell.js`, `prototype/src/prefetch-policy.js` — 20 tests

Per-tile lingering with a 150 ms floor (a pointer crossing a tile is travel, not interest) and a
30 s half-life (stale interest must lose to fresh). Ranked above recency, because dwell is evidence
about the launch *about to happen* and is the only signal that can be right about a game the player
has never opened.

**Keyboard focus is credited exactly like pointer hover.** A keyboard or switch-device user
expresses the same intent and gets the same faster launch; crediting only the mouse would quietly
make the feature worse for assistive-technology users.

Nothing is persisted, transmitted, or tied to an identifier. k is capped at 3 in code, so the waste
documented above cannot be configured away.

**Honest limit:** the event log contains no hover, dwell, impression, or scroll events. Unlike
recency, this signal **cannot be scored offline**. It is a runtime heuristic and must not be quoted
with a hit rate it does not have.

## 3. Progressive rendering

`prototype/src/progressive.js` — 11 tests

The lobby shell and tile grid appear immediately; content fills in as it arrives. The line it does
not cross: **a placeholder shows that something is coming, never a value.** No invented title,
thumbnail, jackpot, balance, or count. Fabricating figures in a gambling product is a data-integrity
problem, not a loading optimisation.

Accessibility is built in rather than retrofitted, because skeleton screens are usually hostile to
it: placeholders are `aria-hidden` (otherwise a screen reader announces "loading" once per tile),
the container carries `aria-busy`, and exactly one announcement fires on settle with the count that
actually arrived. The shimmer stops under `prefers-reduced-motion` while staying visible.

## 4. Manifest generation from the package

`tools/manifest_builder.py`, served at `/warm-manifest.json` — 11 tests

Fixes a reported bug: the sandbox page showed "No manifest supplied" because it only worked when
the measurement tool injected one. The game origin now generates a staged manifest by walking the
package, and the page discovers it. A real integration cannot hand-list assets per title, so the
sandbox no longer does either.

Three warm profiles for Empire of Gold (65 MB package):

| Profile | Files | Size | Share |
|---|---:|---:|---:|
| blocking | 16 | 2.8 MB | 4% |
| critical | 79 | 14.4 MB | 22% |
| all | 133 | 36.1 MB | 56% |

Audio is always excluded from proactive warming — it is 42% of this package and not on the path to
a visible game. Only one resolution branch is emitted. `.gz`/`.br` variants are excluded, since the
origin negotiates encoding and warming them by URL would miss the cache key.

## 5. The sandbox now runs the real product path

`prototype/sandbox.html`, `tools/sandbox_measure.mjs`

Progressive tile rendering → dwell on hover and keyboard focus → prefetch policy → governor →
warmer, end to end. The measurement tool drives the page's own controls rather than injecting a
manifest, so it measures the shipped path.

The governor fails closed when the browser reports no connection information, which is normal on
localhost, so an explicitly-labelled **demo-only override** exists and is never shipped.

A second milestone was added, **assets-quiet** (game origin silent for 2 s), because
engine-canvas at ~600 ms did not match what a human watching the spinner experiences.

## 6. The finding that mattered most — a flaw in our own harness

`tools/sandbox_server.py --latency-ms`

We captured the game's real cold-load timeline. It fetches **everything eagerly**: all 143
requests and 49.8 MB within 8 seconds, no lazy tail. Only 15 requests totalling 2.25 MB complete
before the first canvas. That observed set became the `blocking` profile.

Warming it measured only **6.7% faster** — a disappointing result that turned out to be our
mistake, not the mechanism's:

> **Loopback has no round-trip time.** The main thing a warm cache hit removes is a round trip, and
> we had built a sandbox with no round trips to remove. It was systematically understating the
> effect we were trying to measure.

Adding a 40 ms per-request latency, closer to a real link:

| Warmed | Bytes | Faster to first render |
|---|---:|---:|
| blocking, no RTT | 2.8 MB | 6.7% |
| **blocking, 40 ms RTT** | **2.8 MB** | **26.2%** |

Same manifest, same bytes, four times the benefit. **The value of warming scales with round-trip
count, not only with bytes.** This is why the production probe showed far larger gains than an
unlatenced sandbox ever could: the production probe was always the honest one.

**`blocking` is the sweet spot.** At the measured 30.4% hit rate it wastes ~2 MB per launch instead
of ~36 MB, and still returns a quarter of first-render time.

## 7. D4 compliance note

`docs/compliance-note.md`

Written as the required deliverable. Two things worth flagging:

- **It leads with ePrivacy Art. 5(3), not GDPR.** Prefetching writes files into the browser cache,
  which is storage in the user's *terminal equipment*. Consent is required unless strictly
  necessary for a service the user requested, and warming a game they have not chosen is
  speculative. This is the most directly applicable rule to this project and is easy to miss. It is
  why the visible toggle, byte budget, and fail-closed defaults are requirements rather than
  polish. Whether a toggle alone suffices is **flagged as an open legal question, not answered.**
- **No personalised recommendation reaches a player**, enforced structurally: whitelist projection,
  14 predictor field names that throw, and a test asserting the page never says "picked for you",
  "recommended", "suggested", "top picks", or "trending".

Dwell tracking is described as behavioural observation rather than claiming "no personal data",
with its bounds stated: in-memory, session-scoped, never persisted, never linked to an identifier,
never used to decide anything about a person.

---

## Incidental findings

- **Chromium fetches only the 51 `.ogg` files and never the `.mp3` set.** The package carries
  roughly 11 MB of audio this browser never requests; warming it would be pure waste.
- The package ships **`assets/panel/devUtils/cheatTool.css`** to production.
- Production **already serves gzip and brotli**, so transfer compression offers no further win.
- `assets/spines/@1x/book.png` is **missing from the package as supplied** (141 of 142 requests
  succeed).

## Integration state

| Branch | Commits ahead | Contents |
|---|---:|---|
| `main` | — | predictor eval, sandbox robustness fixes |
| `agent/perceived-load` | 3 | dwell, prefetch policy, progressive rendering, compliance note |
| `agent/sandbox-integration` | 2 | manifest generation, sandbox wiring, blocking profile, RTT |

Neither branch is merged or pushed. To integrate:

```bash
git checkout main
git merge agent/perceived-load
git merge agent/sandbox-integration
git push origin main
```

## Still not done

- **Click-to-playable is unmeasured.** Every timing is to *engine start*. The package cannot reach
  playable in a sandbox: `offline-data-*.js` is absent from the package as supplied and it calls
  `api.spiniq.io`. A mock endpoint would convert this into a real number.
- **Exclusion-register latency: UNKNOWN**, deliberately not estimated.
- **No real screen reader** has driven the surface; ARIA and focus are verified programmatically.
- One title, one provider, one browser. Web is 3% of the launches the policy was derived from.
- `docs/architecture.md`, `docs/impact-case.md`, `docs/dependencies.md` remain missing.
