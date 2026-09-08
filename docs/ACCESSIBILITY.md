# Accessibility — player surface

Scope: [`prototype/player.html`](../prototype/player.html), the game drawer, and the launch
transition screen. This is the evidence behind the EAA / WCAG 2.1 AA line in the hackathon
ground rules.

Everything below was verified by an automated test that fails the build if it regresses.
Where something was **not** verified, it is listed under [Limitations](#limitations) rather
than left implied.

## How to reproduce

```bash
./scripts/bootstrap.sh
npx playwright install chromium     # bootstrap installs the package, not the browser
npm test
./scripts/serve.sh                  # then open http://127.0.0.1:8080/player.html
```

The browser suite skips cleanly (it does not fail) when the Chromium binary is absent.

## Colour contrast — SC 1.4.3, SC 1.4.11

Contrast is computed, not eyeballed. [`prototype/src/contrast.js`](../prototype/src/contrast.js)
implements the WCAG 2.1 relative-luminance formula and is checked against the published
reference values (`#000`/`#fff` = 21.00, `#767676`/`#fff` = 4.54).
[`prototype/tests/player-contrast.test.mjs`](../prototype/tests/player-contrast.test.mjs) parses
the colour tokens out of `player.css` and checks every combination that can actually render.

| Check | Requirement | Worst measured | Result |
|---|---|---|---|
| All 7 text tokens on all 4 surfaces (28 pairs) | 4.5:1 | 6.07:1 (`--text-muted` on `--surface-raised`) | PASS |
| Control borders and focus ring on all 4 surfaces | 3:1 | 3.27:1 (`--border-control` on `--surface-raised`) | PASS |
| Fixed accent pairs (labels, primary button, selected tab) | 4.5:1 | 5.99:1 | PASS |

Surfaces are asserted **opaque**. A translucent surface would composite to a colour no test
ever checked, so the tested ratios would not be the rendered ratios.

The focus indicator is a single 3px `--focus-ring` outline with a 3px offset, measuring
between 9.33:1 and 11.79:1 depending on surface — comfortably above the 3:1 required by
SC 1.4.11.

### Audit of the pre-existing scaffold

The same tooling was run against `prototype/styles/app.css`, which predates this work:

- All 19 text pairs already passed AA. An earlier suspicion that `#7f8ca4` and `#8491a9`
  were failing was **wrong**; they measure 5.46:1 and 5.98:1.
- Non-text contrast failed on two interactive control boundaries: `.toggle-row`/`.field`
  at 1.56:1 and `select` at 2.50:1. Both were raised to `#64748b`, which clears 3:1 on
  every surface in use. A regression test pins this.
- Decorative container borders (`.panel`, `.metric`, `.notice`) remain below 3:1 and were
  deliberately left alone. SC 1.4.11 covers boundaries needed to identify a control, not
  purely decorative framing.

## Keyboard — SC 2.1.1, SC 2.1.2, SC 2.4.3, SC 2.4.7

| Behaviour | Verified by |
|---|---|
| Drawer opens only on explicit user action and reports `aria-expanded` | browser test |
| Focus moves into the drawer on open, and back to the trigger on `Escape` | browser test |
| View tabs implement the ARIA tabs pattern; `ArrowLeft`/`ArrowRight` wrap at both ends | browser test + unit test |
| Results use a roving tabindex — exactly one tab stop for the whole list | browser test |
| `ArrowUp`/`ArrowDown`/`Home`/`End` move within results and wrap | unit test |
| Modal transition traps focus across 8 `Tab` and 8 `Shift+Tab` presses | browser test |
| The page behind the modal is `inert`, not merely covered | browser test |
| `Escape` cancels the launch and returns to the lobby | browser test |
| Focus returns to the launching tile after the transition clears | browser test |

A long catalogue costs one `Tab` to reach, not one per tile. The roving-tabindex and
focus-trap index maths are pure functions in
[`prototype/src/a11y.js`](../prototype/src/a11y.js) and unit-tested independently of the DOM.

There is no keyboard trap: the drawer is dismissible with `Escape`, and the modal always
contains a reachable cancel control.

## Reflow and text resize — SC 1.4.10, SC 1.4.4

| Check | Requirement | Result |
|---|---|---|
| Lobby, drawer, and transition at a 320px viewport | No horizontal scrolling | PASS |
| Transition remains operable at 320px | Controls still reachable and functional | PASS |
| Root font size doubled to 32px | No horizontal scrolling, no lost content | PASS |
| Full launch flow completed at 200% text | Dialog controls still reachable | PASS |

Both are verified by driving the real page, not by inspecting breakpoints. The 200% case
exercises the scrolling overlay directly: when text doubles, the transition card grows past the
viewport, and the test fails if its controls become unreachable.

## Announcements — SC 4.1.3

- Drawer result counts and every empty state are announced through a polite live region.
  The four empty states (`NO_FAVOURITES`, `NO_RECENTS`, `EMPTY_QUERY`, `NO_MATCHES`) produce
  four **distinct** messages, tested for uniqueness, so silence is never ambiguous.
- The transition screen carries its own `role="status"` region describing what is happening.
- When the transition clears, a page-level live region announces readiness — the dialog has
  gone by then, so its own region cannot carry that message.

### The extended-duration path

The transition's announcement duration is a **floor, never a trigger**. This is the single
most important behaviour in this surface:

- Elapsing the floor clears nothing. If the authoritative signal never arrives, the screen
  waits indefinitely.
- If the signal arrives *before* the floor elapses, the screen is held for the remainder so
  an announcement is not cut off mid-sentence.
- Enabling extended duration mid-transition only ever lengthens an in-flight hold.

Default floor is 1,200ms; extended is 2,600ms. Extended duration is exposed as a visible
preference and is switched **on automatically** when the browser reports
`prefers-reduced-motion: reduce`, on the reasoning that both preferences point at needing
more time.

## Motion — SC 2.3.3

`prefers-reduced-motion: reduce` removes the indeterminate pulse animation and all
transitions. The pulse becomes a static full-width bar, so the state remains visible rather
than disappearing. `prefersReducedMotion()` treats a missing or throwing `matchMedia` as
*reduce*, so the safer behaviour is the fallback.

The launch indicator is deliberately **indeterminate**. We cannot know when a game will
accept input, and a progress bar implying a completion time we do not have would be a dark
pattern.

## Non-personalisation guarantee

The drawer offers favourites, recents, and search. Nothing else. This is enforced
structurally, not by convention:

1. **Whitelist projection.** Rendered items are projected onto `id`, `title`, `provider`.
   An upstream scoring field cannot reach the DOM even if present.
2. **Loud rejection.** Fourteen predictor field names (`score`, `rank`, `affinity`,
   `propensity`, `prefetchScore`, `popularity`, …) throw a `RangeError`. A future caller
   that tries to rank the player view fails immediately instead of silently succeeding.
3. **Ordering provenance.** Favourites order by the player's own `favouritedAt`, recents by
   the player's own `lastPlayedAt`, search by text relevance only. A test proves ordering is
   independent of catalogue position, so no ambient ordering can leak in.
4. **One-way intent seam.** `createIntentReporter` lets the drawer report dwell to a cache
   policy. Nothing flows back, and no policy logic exists in the drawer.
5. **Vocabulary check.** A browser test asserts the rendered page never contains "picked for
   you", "recommended", "suggested", "top picks", or "trending".

Search folds Croatian diacritics, so a PSK player searching `zezelj` finds *Žeželj Gold*.

## Counter-metrics placement

Stake velocity and time on device are **operator-only**. A browser test asserts they never
appear in the player-facing transition card, and that they do appear in the operator panel.

Showing intensity metrics to a player mid-transition would function as an engagement cue,
which is the behaviour the no-dark-patterns rule exists to prevent. The reading itself
carries `playerFacing: false` so a future view layer has to override an explicit refusal
rather than merely forget.

## Truthful state and labelling

- The transition may report `interactive` only from an `INPUT_ACCEPTED` signal.
  `FIRST_PAINT`, `IFRAME_LOAD`, `DOM_CONTENT_LOADED`, `SPLASH_VISIBLE`, `TIMER`, and
  `ASSUMED` are named and rejected with a `RangeError`.
- Failure rolls back to a `FAILED` state that never reports interactive and cannot be
  resurrected by a late signal.
- Every RG and counter-metric reading carries a `provenance` label (`MEASURED` /
  `SIMULATED` / `UNKNOWN`) inside the data structure, so a view cannot render a number
  without having its label available.
- An unusable data source degrades to `UNKNOWN`, never to a confident zero.
- Limit headroom is worded as *limit remaining*, never as spending capacity, which would
  read as an inducement. Losses are shown with an explicit minus sign rather than as neutral.

## Defects found and fixed

Both were found by running the page in a real browser, not by reading the markup:

1. **Overlay could not scroll.** The fixed transition overlay had no `overflow-y`, so on a
   short viewport the lower dialog controls were permanently unreachable — by pointer and by
   keyboard. Fixed with a scrolling overlay and auto-margin centring that degrades to normal
   flow instead of clipping.
2. **Demo controls were unreachable.** The signal buttons sat behind the fullscreen overlay,
   so they could not be clicked and could not be tabbed to (focus was trapped in the dialog)
   at exactly the moment they were needed. They now live inside the dialog, within the trap.

## Limitations

Stated plainly, because an untested claim is worse than an absent one.

- **No real assistive-technology testing.** ARIA roles, live regions, and focus behaviour are
  verified programmatically. The surface has **not** been driven with NVDA, JAWS, VoiceOver,
  TalkBack, or Orca. Announcement wording and timing should be confirmed with at least one
  real screen reader before this is presented as AA-conformant.
- **One browser.** Chromium 136 headless only. No Firefox, Safari, or mobile browser run.
- **Automated contrast covers tokens, not renderings.** Combinations produced by future
  inline styles, images, or user stylesheets are unchecked.
- **No cognitive or plain-language review.** Copy has not been assessed for reading level.
- **Synthetic data only.** Every figure on this surface is `SIMULATED`. None of this
  demonstrates behaviour against real player data or a real game.
- **The interactivity signal is simulated.** A demo button stands in for a signal a real game
  would send. The waiting behaviour is real; the signal is not.
