# Prefetch policy — measured on real launch sequences

Warming is only worth doing if we warm the **right** game. A 99.7% byte saving on a launch that
never happens is pure waste. This is the number that makes the saving defensible.

## Method

`tools/predictor_eval.py` scores candidate cache policies against the FEG-provided casino event
log. Sessions are ordered by first launch time and split 70/30 **by time**, so no policy is ever
scored on data it was built from.

- 2,595 sessions containing a launch; 1,771 have two or more.
- 1,816 training sessions, 779 test sessions, **3,337 scored predictions**, 723 distinct titles.
- Reads session and title fields only. Player identifiers are never read, joined, or emitted.

```bash
unzip -p assets.zip assets/top_casino_users_event_logs.csv \
  | .venv/bin/python tools/predictor_eval.py --events -
```

## Result

| Policy | hit@1 | hit@2 | hit@3 | hit@5 |
|---|---:|---:|---:|---:|
| **repeat-own-session** | **30.4%** | **40.4%** | **46.0%** | **50.8%** |
| markov+repeat | 12.4% | 18.3% | 21.9% | 28.4% |
| markov+popular | 11.5% | 16.4% | 18.5% | 22.5% |
| markov-next | 11.4% | 16.3% | 18.4% | 22.1% |
| popular-global | 5.5% | 6.2% | 6.9% | 15.2% |

## What this says

**The boring heuristic wins, by a lot.** "Warm what this player already launched in this session"
beats the collaborative next-title model by **2.7× at k=1** and beats global popularity by 5.5×.

We built the Netflix-style model. It lost. Players are overwhelmingly returning to a game they
just played, not discovering a similar one, and no amount of co-occurrence modelling changes that.

This matters beyond accuracy:

- **It needs no profiling.** Warming a player's own recent titles requires no behavioural model, no
  cross-player data, no inference about preferences. That removes the EU AI Act surface entirely,
  rather than mitigating it.
- **It is explainable.** "We prepared the game you were just playing" is a sentence a compliance
  reviewer and a player can both accept.
- **It stays cache-only regardless.** Policy output drives prefetch and never reaches the drawer,
  which shows favourites, recents and search only.

## The counterweight — cost of being wrong

At the production-measured 11.25 MB per warmed title:

| k | hit rate | warmed | wasted per launch |
|---:|---:|---:|---:|
| 1 | 30.4% | 11.2 MB | ~7.8 MB |
| 2 | 40.4% | 22.5 MB | ~18.0 MB |
| 3 | 46.0% | 33.8 MB | ~28.6 MB |
| 5 | 50.8% | 56.2 MB | ~50.5 MB |

**Even the best policy wastes more than it saves at every k**, if we warm the full bundle. Going
from k=1 to k=5 buys 20 points of hit rate for 5× the bytes. That is a bad trade.

The design conclusion is therefore not "predict harder". It is:

1. **k=1.** Warm one title, the most recently played. Extra candidates are not worth their bytes.
2. **Warm the critical path, not the bundle.** PRELOADER + COMMON + SPLASH is roughly 3.4 MB of
   the ~11 MB, and it is what stands between a click and a visible splash. Warming that tier at
   30% accuracy costs ~2.4 MB of waste per launch instead of ~7.8 MB.
3. **The governor decides whether to spend at all** — Save-Data, metered connection, byte budget,
   page hidden. Declining to warm is a correct outcome, not a failure.

## Honest limits

- **Web is 3% of these launches.** Platform mix is Casino Android 9,906, GM 3,332, web 444. The
  policy is derived from mostly-native sessions and applied to a web prototype.
- Session-scoped only. Cross-session history (a player's favourites over weeks) is not modelled
  and would likely beat this; the event log covers a limited window.
- 3,337 predictions from one market and one time window.
- Hit rate is not conversion. A warmed launch is faster; that it happens at all is unproven.
- The 11.25 MB per title is one title, Multiplay 81, measured in production.
