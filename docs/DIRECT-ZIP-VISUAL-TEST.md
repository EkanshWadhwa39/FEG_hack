# Direct unchanged-ZIP visual timing test

This test helps a human time when the supplied Empire of Gold **Play button first becomes visible** without the Vault lobby or speculative loading.

It does not establish that the button accepts input or that gameplay is ready. The provider exposes no authoritative accepted-input event, so every Play-button result is labelled `HUMAN-ANNOTATED`.

## What the test does

- verifies the reviewed archive SHA-256 before opening a listener;
- reads the unchanged ZIP in place without extracting or patching it;
- serves the provider directly as a top-level page over a random loopback port;
- sends `Cache-Control: no-store` for every response;
- launches a fresh Chromium process for every run;
- applies no Vault wrapper, iframe, prefetch, network interception, CPU/network throttle, CSP rewrite, or artificial delay;
- records the browser-document elapsed time when the tester presses the marker hotkey.

Human reaction time and any browser main-thread delay in receiving the key event are included. The test does not contact a real authorization system and must not be used as production-performance evidence.

## macOS setup

From a clean checkout of `integration/empire-catalogue`:

```bash
npm pkg get scripts.test:empire:visual
npm ci
npx playwright install chromium
```

Keep the private provider ZIP outside Git. Do not upload it, tunnel the localhost server, or copy it into evidence.

## Run five fresh visual trials

```bash
npm run test:empire:visual -- \
  --zip '/Users/ekansh/path/to/empireofgold (1).zip' \
  --runs 5 \
  --output /tmp/empire-direct-visual.json
```

For each run:

1. The terminal asks whether you are ready. Press **Return**.
2. A new Chromium process opens the unchanged provider directly.
3. Watch the game—not the terminal.
4. On the first frame where you can see the provider's Play button, press **F8**.
   - On a Mac whose function keys control media, press **Fn+F8**.
   - Alternative: press **Option+Shift+P**.
5. The browser closes and the terminal prints the marked time.
6. Return to the terminal and press **Return** to start the next fresh run.

Do not press the marker while only the canvas, loading animation, background, or Vault dialog is visible. Use the same visual rule in every run.

## Interpreting the report

The JSON contains each marked time and their minimum, median, and maximum. Appropriate wording is:

> HUMAN-ANNOTATED — on this Mac and Chromium version, the Play button was first seen at a median of X ms across N fresh direct-ZIP runs.

Do not relabel the result as `MEASURED playable`, `interactive`, or `input accepted`. For a fair comparison with a future treatment, use the same Mac, browser version, viewport, run count, start event, visual rule, and marker procedure. Run the arms serially; never run two browser experiments concurrently.

## Limitations

- The marker is a human observation, not a provider event.
- A visible button may still reject or delay input.
- Headless timing is not substituted for this graphical test.
- Localhost performance does not predict production CDN, authorization, mobile, or network behavior.
- The supplied build has known missing late dependencies; this test does not repair or hide them.
