# Dependencies and Disclosure

FEG Challenge 3 — Game Load Time. Browser-native cache warming for the PSK casino lobby.

## Production Dependencies

**None.** The lobby is built with vanilla HTML, CSS, and ES Modules using only standard browser APIs. There is no framework, no bundler, no build step, and no npm production dependency. This is a deliberate architectural choice: zero vendor lock-in, zero supply-chain surface, and nothing to install before evaluation.

## Development Tooling

| Tool | Version | Purpose | Licence |
|------|---------|---------|---------|
| Node.js | 18+ | JS test runner, static dev server | MIT |
| Python | 3.11+ | Sandbox server, HAR analysis, tests | PSF |
| Playwright | 1.63.0 | Browser automation tests | Apache-2.0 |
| ShellCheck | 0.9+ | Shell script linting | GPL-3.0 |

## Python Packages (dev only)

All listed in `requirements-dev.txt`. None run in the browser or process player data.

| Package | Version | Purpose | Licence |
|---------|---------|---------|---------|
| duckdb | 1.5.5 | Offline analytical queries | MIT |
| openpyxl | 3.1.5 | Spreadsheet processing | MIT |
| polars | 1.44.1 | Data analysis | MIT |
| pytest | 9.1.1 | Python test runner | MIT |
| ruff | 0.15.8 | Python linter | MIT |

## npm Packages (dev only)

| Package | Version | Purpose | Licence |
|---------|---------|---------|---------|
| playwright | 1.63.0 | Browser test automation | Apache-2.0 |

## External Resources

| Resource | Details |
|----------|---------|
| Google Fonts (Roboto) | Loaded in the lobby UI; falls back to system fonts if unavailable |
| Empire of Gold game bundle | FEG-provided, served locally unchanged, not committed to the repository |

## Supplied vs Team-Authored

- **FEG-provided:** Empire of Gold game bundle (unchanged, served as-is behind simulated slot aliases)
- **Team-authored:** All lobby source code, prefetch engine, governor logic, measurement tooling, tests, and documentation

No game code was modified. No player data is collected, stored, or processed.

## AI Assistance

Claude and cptr assisted with audit, planning, documentation, and packaging. The team authored all application code. No model, training pipeline, or AI inference runs in the application.

## Browser Compatibility

Targets Chromium-based browsers (Chrome, Edge, Brave) for shared HTTP cache partition support. The cache-warming technique relies on standard browser caching behaviour and requires no browser extensions or modifications.
