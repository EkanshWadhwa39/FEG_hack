# Browser Cache Warming for PSK Game Loads

**FEG Challenge 3 — Game Load Time**
**Team:** Ekansh, Hansika, Parth, Shaurya

---

## The Problem

Launching a casino game from the PSK lobby requires downloading ~16.6 MB of static assets on every cold start. On a typical connection this takes **35.5 seconds** before the player sees anything. Every second of that wait costs engagement.

## Our Solution

We warm the browser's native HTTP cache while the player is still browsing the lobby. When they click "Play", the assets are already local. No game code changes, no service worker, no custom cache layer — just the browser's built-in HTTP cache doing what it was designed to do.

### MEASURED Results (HAR comparison)

| | Cold Launch | Warm Launch |
|---|---|---|
| **Load time** | 35.5 s | 6.7 s |
| **Data transferred** | 16.6 MB | 12 KB |
| **Requests served from cache** | 0 / 149 | 139 / 149 (93%) |

**5.3x faster. 99.9% less data on launch. Zero game modifications.**

---

## How It Works

```
Player browses lobby
  → Governor checks: Save-Data? connection speed? budget? tab visible?
  → Manifest resolves locale/tier to exact asset URLs
  → Warmer fetches assets (max 2 concurrent, staged priority)
  → Browser HTTP cache stores them
  → Player clicks "Play" → iframe launches → cache hits → fast load
```

The lobby auto-warms the first game slot on page load. Hovering over other slots warms them on demand. Players can toggle prefetching off. A budget governor prevents excessive bandwidth use.

The lobby serves 20 catalogue slots from one supplied game bundle under distinct URL paths, proving the cache-warming mechanism scales across a full catalogue.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla ES modules (zero build step, zero framework) |
| Sandbox server | Python 3.11+ (`http.server`, threading) |
| Tests | Python `pytest` (50 tests), browser-native `assert` (136 tests) |
| Linting | `ruff` (Python), `eslint` (JS) |
| Runtime dependencies | **None** — no npm packages, no pip packages in production |

## Environment Variables

This project requires **no secrets, API keys, or environment variables**. All configuration is passed via CLI flags to the sandbox server. See `.env.example` for details.

The only optional env var is `SANDBOX_VERBOSE=1` to enable request logging on the sandbox server.

---

## Quick Start

### Prerequisites

- Python 3.11+ (with `venv` and pip)
- Node 18+
- A local copy of the supplied game bundle (not included in the repo)

### Setup

```bash
./scripts/bootstrap.sh        # install Python + Node dependencies
./scripts/check.sh             # run all tests + lint (50 Python, 136 JS)
```

### Run the Demo

```bash
.venv/bin/python tools/sandbox_server.py \
  --bundle /path/to/empireofgold \
  --host 127.0.0.1 --lobby-port 8090 --game-port 8091

# Open http://127.0.0.1:8090/lobby.html
```

**Demo walkthrough:**
1. Open `lobby.html` — Game 1 auto-warms immediately
2. Watch the progress bar fill, then click Play — near-instant launch
3. Close the game, hover a different slot — it warms on hover
4. Toggle "Prefetch" off, try a cold slot — observe the difference

### Realistic Network Simulation

The sandbox server replicates the production network topology entirely on localhost — no staging or VPN needed:

- **Two-origin architecture**: lobby on `:8090`, game CDN on `:8091`, just like production
- **Production cache headers**: `Cache-Control: immutable` on static assets, `no-store` on HTML
- **Smart throttle**: simulates real broadband/mobile speeds so judges can see the cold-vs-warm contrast
- **Per-URL warm tracking**: the server knows which assets were prefetched — warm launches bypass throttle (browser cache hit), cold launches stay throttled (real network). This mirrors exactly what happens in production.

Add `--throttle-kbps` to control the simulated network speed:

| `--throttle-kbps` | Prefetch time | Cold launch | Best for |
|---|---|---|---|
| `0` (default) | instant | instant | quick testing, slow machines |
| `15000` | ~6 s | ~8-9 s | slower laptops |
| `25000` | ~4-5 s | ~8-10 s | most laptops |
| `40000` | ~2-3 s | ~5-6 s | fast desktops |

Warm launches always hit browser cache (~0.5 s) regardless of throttle setting. The server tracks prefetched URLs so warm launches bypass throttle while cold launches stay throttled.

---

## Repository Structure

```
src/                         Browser application
  lobby.html                 Main lobby entry point
  src/                       ES modules (warmer, governor, manifest)
  styles/                    Application CSS
  tests/                     Browser tests
docs/
  architecture.md            Components, flows, deployment
  impact-case.md             Benefit, cost, evidence boundaries
  compliance-note.md         Requirements and release gates
  dependencies.md            Software, permissions, AI disclosure
tests/                       Python + layout validation tests
scripts/                     Bootstrap, checks, static serving
tools/                       Sandbox server + evidence utilities
```

## Design Decisions (ADRs)

| # | Decision | Rationale |
|---|---|---|
| 001 | Browser-native, no framework | Vanilla ES modules — zero build step, zero dependencies in production |
| 002 | Evidence before breadth | Prove cache reuse in isolated HARs before adding features |
| 003 | Conservative governor | Max 2 concurrent fetches, fail-closed on unknown APIs, respect Save-Data |
| 004 | Exact URLs | Pre-resolve locale/tier so cached URLs match game requests exactly |
| 005 | Truthful readiness | Never fake a checkpoint — report only what is actually cached |

## Why This Wins

1. **Deploy once, every game benefits.** PSK hosts hundreds of games from many providers. Solutions that require game code changes need every provider to cooperate — that doesn't scale. Our solution is lobby-side only: no game modifications, no provider coordination, no new infrastructure. Add it to the lobby and every game with standard `Cache-Control` headers gets faster instantly.

2. **Production on localhost.** The sandbox server replicates the real two-origin topology, CDN headers, and network conditions entirely on one machine. Anyone can see — and measure — the cold-vs-warm contrast without staging access.

3. **Zero runtime dependencies.** Vanilla ES modules, no framework, no build step, no service worker. Nothing to break, nothing to maintain, nothing to update.

---

## Known Limitations & Future Improvements

| Limitation | Reason | Path Forward |
|---|---|---|
| Single game bundle | Only one bundle was provided for the hackathon | Manifest generation from asset pipeline for all games |
| Hardcoded locale/tier (`en`/`@1x`) | Demo scope — manifest structure supports dynamic resolution | Integrate with real locale/tier detection |
| No real authorization gate | `sandbox.js` is an integration seam, not a real auth check | Connect to production exclusion-register |
| No CDN edge caching | Cannot simulate edge nodes on localhost | Staging validation with real CDN |
| Conversion/revenue uplift not claimed | Requires production A/B testing | Deploy and measure with real player traffic |

---

## Documents

- [Architecture](docs/architecture.md)
- [Impact Case (D3)](docs/impact-case.md)
- [Compliance Note (D4)](docs/compliance-note.md)
- [Dependencies & AI Disclosure](docs/dependencies.md)
