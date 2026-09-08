/**
 * Real-browser verification of the player surface.
 *
 * Static assertions cannot prove that focus actually moves, that a roving
 * tabindex works, or that the transition refuses to clear on first paint.
 * These run in Chromium and check the behaviour rather than the markup.
 *
 * The whole suite skips cleanly when the Playwright browser binary is absent,
 * because ./scripts/bootstrap.sh installs the package but not the browser.
 * Run `npx playwright install chromium` to enable it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

let chromium = null;
let skipReason = null;
try {
  ({ chromium } = await import("playwright"));
  const probe = await chromium.launch();
  await probe.close();
} catch (error) {
  skipReason = `Chromium unavailable: ${error.message.split("\n")[0]}`;
}

/** Minimal static server; ES modules need a real origin, not file://. */
async function startServer() {
  const server = createServer(async (request, response) => {
    const requested = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = normalize(requested).replace(/^(\.\.[/\\])+/, "").replace(/^\/+/, "");
    try {
      const body = await readFile(join(ROOT, relative || "player.html"));
      response.writeHead(200, { "content-type": TYPES[extname(relative)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function withPage(run, contextOptions = {}) {
  const { server, origin } = await startServer();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/player.html`, { waitUntil: "load" });
    await run(page);
    assert.deepEqual(errors, [], "page must load without script errors");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

const options = { skip: skipReason ?? false };
const activeId = (page) => page.evaluate(() => document.activeElement?.id ?? "");

test("drawer is user-initiated and reports its expanded state", options, async () => {
  await withPage(async (page) => {
    assert.equal(await page.getAttribute("#drawer-trigger", "aria-expanded"), "false");
    assert.equal(await page.isHidden("#drawer"), true);

    await page.click("#drawer-trigger");
    assert.equal(await page.getAttribute("#drawer-trigger", "aria-expanded"), "true");
    assert.equal(await page.isVisible("#drawer"), true);
    // Focus moves into the drawer so a keyboard user is not stranded.
    assert.equal(await activeId(page), "drawer-search");
  });
});

test("Escape closes the drawer and returns focus to the trigger", options, async () => {
  await withPage(async (page) => {
    await page.click("#drawer-trigger");
    await page.keyboard.press("Escape");
    assert.equal(await page.isHidden("#drawer"), true);
    assert.equal(await activeId(page), "drawer-trigger");
  });
});

test("tabs follow the ARIA pattern with arrow keys", options, async () => {
  await withPage(async (page) => {
    await page.click("#drawer-trigger");
    await page.focus("#tab-FAVOURITES");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.getAttribute("#tab-RECENTS", "aria-selected"), "true");
    assert.equal(await activeId(page), "tab-RECENTS");

    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.getAttribute("#tab-FAVOURITES", "aria-selected"), "true");
    // Wrapping keeps a long list reachable with one key.
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.getAttribute("#tab-SEARCH", "aria-selected"), "true");
  });
});

test("results use a roving tabindex with exactly one tab stop", options, async () => {
  await withPage(async (page) => {
    await page.click("#drawer-trigger");
    const tabbable = () => page.$$eval(
      "#drawer-results button",
      (nodes) => nodes.filter((node) => node.tabIndex === 0).length,
    );
    assert.equal(await tabbable(), 1);

    await page.focus("#drawer-results button");
    const first = await page.evaluate(() => document.activeElement.dataset.index);
    await page.keyboard.press("ArrowDown");
    const second = await page.evaluate(() => document.activeElement.dataset.index);
    assert.notEqual(first, second);
    assert.equal(await tabbable(), 1);
  });
});

test("search filters and announces its result count", options, async () => {
  await withPage(async (page) => {
    await page.click("#drawer-trigger");
    await page.fill("#drawer-search", "zezelj");
    // Diacritic-folded search finds the accented title.
    assert.equal(await page.textContent("#drawer-results button .game-title"), "Žeželj Gold");
    assert.match(await page.textContent("#drawer-count"), /1 game in search/);

    await page.fill("#drawer-search", "qqqq");
    assert.equal(await page.$$eval("#drawer-results button", (n) => n.length), 0);
    assert.match(await page.textContent("#drawer-empty"), /No games match/);
  });
});

test("the drawer never renders a ranked or recommended view", options, async () => {
  await withPage(async (page) => {
    await page.click("#drawer-trigger");
    const tabNames = await page.$$eval('[role="tab"]', (nodes) =>
      nodes.map((node) => node.textContent.trim()));
    assert.deepEqual(tabNames, ["Favourites", "Recents", "Search"]);

    const body = (await page.textContent("body")).toLowerCase();
    for (const banned of ["picked for you", "recommended", "suggested", "top picks", "trending"]) {
      assert.equal(body.includes(banned), false, `player surface must not say "${banned}"`);
    }
  });
});

test("launching opens a modal transition and traps focus", options, async () => {
  await withPage(async (page) => {
    await page.click("#drawer-trigger");
    await page.click("#drawer-results button");

    assert.equal(await page.isVisible("#transition"), true);
    assert.equal(await page.getAttribute("#transition", "aria-modal"), "true");
    assert.equal(await activeId(page), "transition-cancel");

    // Tab must cycle within the dialog rather than reaching the page behind.
    const inDialog = () => page.evaluate(
      () => document.getElementById("transition").contains(document.activeElement),
    );
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Tab");
      assert.equal(await inDialog(), true, "Tab escaped the modal transition");
    }
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await inDialog(), true, "Shift+Tab escaped the modal transition");
    }
    // Cycling all the way round returns to where it started.
    assert.equal(await activeId(page), "transition-cancel");
  });
});

test("the page behind the modal is inert while it is open", options, async () => {
  await withPage(async (page) => {
    assert.equal(await page.$eval("main.shell", (node) => node.inert), false);

    await page.click("#drawer-trigger");
    await page.click("#drawer-results button");
    // Removed from the accessibility tree, not merely visually covered.
    assert.equal(await page.$eval("main.shell", (node) => node.inert), true);

    await page.click("#transition-cancel");
    assert.equal(await page.$eval("main.shell", (node) => node.inert), false);
  });
});

test("first paint does not clear the transition", options, async () => {
  await withPage(async (page) => {
    await page.click("#drawer-trigger");
    await page.click("#drawer-results button");
    await page.click("#signal-paint");

    await page.waitForTimeout(2_000);
    assert.equal(await page.isVisible("#transition"), true);
    assert.match(await page.textContent("#transition-status"), /not readiness/);
  });
});

test("an authoritative signal holds for the announcement floor, then clears", options, async () => {
  await withPage(async (page) => {
    await page.click("#drawer-trigger");
    await page.click("#drawer-results button");
    await page.click("#signal-interactive");

    // Still visible immediately after the signal: the hold is the point.
    assert.equal(await page.isVisible("#transition"), true);
    assert.match(await page.textContent("#transition-status"), /Holding briefly/);

    await page.waitForSelector("#transition", { state: "hidden", timeout: 5_000 });
    assert.match(await page.textContent("#page-status"), /accepting input/);
    // Focus returns to the launching tile rather than being lost to the body.
    // Result buttons carry no id, so identify them by their data attribute.
    const restored = await page.evaluate(
      () => document.activeElement?.dataset?.gameId ?? null,
    );
    assert.ok(restored, "focus must return to a real element after clearing");
  });
});

test("network failure rolls back without a false ready state", options, async () => {
  await withPage(async (page) => {
    await page.click("#drawer-trigger");
    await page.click("#drawer-results button");
    await page.click("#signal-fail");

    assert.equal(await page.isVisible("#transition"), true);
    assert.match(await page.textContent("#transition-status"), /Nothing was started/);
    assert.equal(await page.textContent("#transition-cancel"), "Return to lobby");

    await page.click("#transition-cancel");
    assert.equal(await page.isHidden("#transition"), true);
  });
});

test("reduced motion stops the animation and extends the announcement window", options, async () => {
  await withPage(async (page) => {
    assert.equal(await page.isChecked("#extended-duration"), true);
    assert.match(await page.textContent("#motion-state"), /does not animate/);

    await page.click("#drawer-trigger");
    await page.click("#drawer-results button");
    const animation = await page.$eval(
      ".pulse span",
      (node) => getComputedStyle(node).animationName,
    );
    assert.equal(animation, "none");
  }, { reducedMotion: "reduce" });
});

test("content reflows at 320px without horizontal scrolling (SC 1.4.10)", options, async () => {
  await withPage(async (page) => {
    const overflows = () => page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

    assert.equal(await overflows(), false, "lobby scrolls horizontally at 320px");

    await page.click("#drawer-trigger");
    assert.equal(await overflows(), false, "drawer scrolls horizontally at 320px");

    await page.click("#drawer-results button");
    assert.equal(await overflows(), false, "transition scrolls horizontally at 320px");

    // The dialog must still be operable, not merely non-overflowing.
    await page.click("#signal-fail");
    assert.match(await page.textContent("#transition-status"), /Nothing was started/);
  }, { viewport: { width: 320, height: 640 } });
});

test("text resized to 200% loses no content or function (SC 1.4.4)", options, async () => {
  await withPage(async (page) => {
    // Doubling the root font size is the text-only resize the SC describes.
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });

    assert.equal(
      await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1),
      false,
      "page scrolls horizontally at 200% text size",
    );

    await page.click("#drawer-trigger");
    await page.click("#drawer-results button");
    // Controls inside the scrolling overlay must remain reachable when text
    // doubles and the card grows past the viewport.
    await page.click("#signal-interactive");
    await page.waitForSelector("#transition", { state: "hidden", timeout: 6_000 });
  }, { viewport: { width: 800, height: 600 } });
});

test("counter-metrics stay out of the player-facing transition screen", options, async () => {
  await withPage(async (page) => {
    await page.click("#drawer-trigger");
    await page.click("#drawer-results button");

    const card = (await page.textContent(".transition-card")).toLowerCase();
    for (const banned of ["stake velocity", "time on device", "review flag"]) {
      assert.equal(card.includes(banned), false, `"${banned}" must not be player-facing`);
    }
    // They are present in the operator view instead.
    assert.match(await page.textContent(".operator"), /Stake velocity/);
  });
});
