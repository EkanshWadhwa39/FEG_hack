# Later staging sandbox integration

## Current status

The staging URL is unavailable because of a technical issue and will not be accessible during the hackathon. The repository therefore contains a staging-ready **integration boundary**, not staging evidence. The main prototype remains `SIMULATED` and does not import the real browser requester.

No staging URL, credential, token, player data, or provider resource is committed here.

## Implemented boundary

- `prototype/src/sandbox.js` coordinates a `CONTROL` or `TREATMENT` warm phase.
- `prototype/src/browser-requester.js` supplies the later real browser `fetch` boundary.
- `prototype/src/manifest.js` resolves exactly one locale and resolution tier.
- `prototype/src/governor.js` fails closed on unknown/unsafe conditions.
- `prototype/src/warmer.js` preserves exact URL strings, excludes unsafe stages, supports cancellation, and caps concurrency at two.

The sandbox coordinator requires `AuthorizationState.GRANTED` before it reads the manifest, evaluates warming, or calls a requester. `DENIED`, `UNKNOWN`, and malformed states make zero speculative requests. The control arm resolves the same plan but sends zero speculative requests.

The browser requester:

- accepts absolute HTTPS URLs only;
- rejects embedded credentials and common credential-like query keys;
- sends `credentials: "omit"` and no custom headers;
- preserves the original URL string rather than reconstructing or normalising it;
- uses the standard browser HTTP cache, not a custom cache;
- reports only request completion, never cache admission or reuse.

## Integration contract when staging is introduced

The staging adapter must inject all of the following from approved, non-sensitive integration sources:

1. An authoritative `GRANTED` authorization state. Never hardcode this state in a player flow.
2. An observed exact manifest for one title/build, locale, and tier.
3. A declared `CONTROL` or `TREATMENT` arm.
4. Current browser governor inputs and a per-session byte budget.
5. The credential-free browser requester with the request mode proven for that environment.
6. An abort signal tied to navigation, visibility changes, policy disablement, and budget/safety cancellation.

Environment-specific configuration must not be folded into the generic core. Never place credentials, cookies, Authorization headers, player identifiers, exclusion payloads, or credential-bearing launch URLs in a manifest or browser logs.

## Required staging protocol

1. Confirm written approval and the exact sandbox scope.
2. Define browser/device, title/build, locale/tier, and the observable launch milestone.
3. Confirm the authorization event and keep it fail-closed.
4. Derive exact candidate static URLs from an observed staging launch; do not guess from the private archive.
5. Validate credential-free request semantics, CSP/CORS, response cache policy, and exact URL identity one asset at a time.
6. Start each arm in a fresh isolated browser profile/context.
7. Run the disabled control and enabled treatment serially with all other settings identical.
8. Prove that treatment warming happened before click and that exact URLs were reused by the normal iframe launch.
9. Repeat each arm at least once.
10. Redact HARs and publish only approved aggregate evidence.

Until this protocol passes, do not call the integration staging-validated, production-ready, or player-facing. Historical cold/repeat HARs remain evidence of warm-state opportunity only.

## Local verification during the outage

```bash
./scripts/check.sh
```

Tests use injected fake request functions. They verify authorization ordering, control/treatment behavior, conservative governor blocking, exact URL preservation, credential omission, prohibited URL rejection, and the concurrency ceiling without contacting staging or production.
