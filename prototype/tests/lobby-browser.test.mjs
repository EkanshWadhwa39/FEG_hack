/**
 * Lobby behaviour in a real browser.
 *
 * These run against the static lobby only — no sandbox server, no game origin,
 * no posters. That is deliberate: the point is to pin the *decisions* the lobby
 * makes from intent, and those must hold whether or not a provider answers.
 * Manifests never arrive, so no rung above CONNECT can fire and the assertions
 * stay about wiring rather than about network timing.
 *
 * The end-to-end launch measurement lives in `tools/sandbox_measure.mjs`, which
 * needs the real package.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const prototypeDir = fileURLToPath(new URL("../", import.meta.url));

let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"));
} catch {
  chromium = null;
}
const options = chromium ? {} : { skip: "playwright is not installed" };

const PORT = Number(process.env.LOBBY_TEST_PORT ?? 8123);

async function withLobby(run, contextOptions = {}, { initScript = null } = {}) {
  const server = spawn("python3",
    ["-m", "http.server", String(PORT), "--directory", prototypeDir, "--bind", "127.0.0.1"],
    { stdio: "ignore" });
  const browser = await chromium.launch();
  try {
    // Wait for the static server rather than sleeping a fixed amount.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${PORT}/sandbox.html`);
        if (response.ok) break;
      } catch { /* not listening yet */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const context = await browser.newContext(contextOptions);
    if (initScript) await context.addInitScript(initScript);
    const page = await context.newPage();
    // No game origin exists in this test, so point it at an unroutable one and
    // let every provider request fail. The lobby must still work.
    await page.goto(
      `http://127.0.0.1:${PORT}/sandbox.html?game=http://127.0.0.1:9/nowhere&games=8`,
      { waitUntil: "load" },
    );
    await page.waitForSelector(".tile", { timeout: 10_000 });
    await run(page);
  } finally {
    await browser.close();
    server.kill();
  }
}

const speculation = (page) => page.evaluate(() => globalThis.__SPECULATION__());

test("the lobby renders rails of square tiles with titles and providers", options, async () => {
  await withLobby(async (page) => {
    const headings = await page.locator(".rail-head h2").allTextContents();
    // No launches yet, so there is no continue-playing rail; the seeded
    // favourites and the two editorial rails are all that can exist.
    assert.deepEqual(headings, ["PSK favourites", "New games", "Popular"]);
    assert.equal(await page.locator(".rail-head h2", { hasText: "Continue" }).count(), 0);

    // The production heading is kept beside the English one as evidence that
    // these rails are the site's own rather than invented for the demo.
    assert.deepEqual(await page.locator(".rail-en").allTextContents(),
      ["PSK Favoriti", "Nove igre", "Popularno"]);

    assert.ok(await page.locator(".tile").count() >= 8);
    assert.ok((await page.locator(".tile-title").first().textContent()).length > 0);
    assert.ok((await page.locator(".tile-provider").first().textContent()).length > 0);

    // Production tile geometry: square, so arriving posters cannot shift it.
    const box = await page.locator(".tile").first().boundingBox();
    assert.equal(Math.round(box.width), Math.round(box.height));
  });
});

test("posters declare intrinsic size and defer everything below the first rail", options, async () => {
  await withLobby(async (page) => {
    const posters = await page.locator(".tile img").evaluateAll((images) => images.map((image) => ({
      width: image.getAttribute("width"),
      height: image.getAttribute("height"),
      loading: image.getAttribute("loading"),
      decoding: image.getAttribute("decoding"),
    })));
    assert.ok(posters.length > 0);
    // Intrinsic dimensions on every poster: this is what keeps the grid from
    // reflowing as thumbnails arrive.
    assert.ok(posters.every((p) => p.width === "320" && p.height === "320"));
    assert.ok(posters.every((p) => p.decoding === "async"));
    assert.ok(posters.some((p) => p.loading === "eager"), "the first rail is eager");
    assert.ok(posters.some((p) => p.loading === "lazy"), "later rails are deferred");
  });
});

test("resting on a tile climbs the ladder; the lobby's contents never change", options, async () => {
  await withLobby(async (page) => {
    // Player-visible content only: the per-tile ladder badge is operator
    // instrumentation and is expected to change, which is the whole reason it
    // is hidden from players by default.
    const visibleContent = () => page.evaluate(() => [...document.querySelectorAll(".tile")]
      .map((tile) => [
        tile.dataset.gameId,
        tile.querySelector(".tile-title")?.textContent,
        tile.querySelector(".tile-provider")?.textContent,
        tile.querySelector(".chip")?.textContent ?? "",
      ].join("|")));

    const before = await visibleContent();
    assert.equal((await speculation(page)).plan.rung, "NONE");

    await page.locator(".tile").first().hover();
    await page.waitForFunction(
      () => globalThis.__SPECULATION__().plan.rung !== "NONE",
      null,
      { timeout: 5_000 },
    );
    const plan = (await speculation(page)).plan;
    const firstTileId = await page.locator(".tile").first().getAttribute("data-game-id");
    assert.equal(plan.target, firstTileId);
    assert.equal(plan.playerVisible, false);

    // The whole promise of the architecture: speculation is invisible. Same
    // titles, same providers, same order, before and after.
    assert.deepEqual(await visibleContent(), before);
  });
});

test("withdrawing authorization stops every rung", options, async () => {
  await withLobby(async (page) => {
    await page.locator(".tile").first().hover();
    await page.waitForFunction(
      () => globalThis.__SPECULATION__().plan.rung !== "NONE", null, { timeout: 5_000 },
    );

    await page.evaluate(() => document.getElementById("deny-auth").click());
    await page.waitForFunction(
      () => globalThis.__SPECULATION__().plan.refusedBecause === "AUTHORIZATION",
      null,
      { timeout: 5_000 },
    );
    const plan = (await speculation(page)).plan;
    assert.equal(plan.rung, "NONE");
    assert.equal((await speculation(page)).preinit.state, "IDLE");
  });
});

test("the baseline arm refuses everything, in the same page", options, async () => {
  await withLobby(async (page) => {
    await page.evaluate(() => document.getElementById("disable-spec").click());
    await page.locator(".tile").first().hover();
    await page.waitForTimeout(700);
    const plan = (await speculation(page)).plan;
    assert.equal(plan.rung, "NONE");
    assert.equal(plan.refusedBecause, "GOVERNOR");
  });
});

test("per-tile ladder state is instrumentation, hidden unless switched on", options, async () => {
  await withLobby(async (page) => {
    // It must exist for the demo, and it must not be a player-facing badge.
    assert.equal(await page.locator(".tile-state").first().isVisible(), true,
      "the overlay ships on in the sandbox");
    await page.evaluate(() => document.getElementById("overlay").click());
    assert.equal(await page.locator(".tile-state").first().isVisible(), false);
    assert.equal(await page.evaluate(() => document.body.dataset.overlay), "off");
  });
});

test("a touch device gets intent from a touch-down, where hover does not exist", options, async () => {
  await withLobby(async (page) => {
    const tile = page.locator(".tile").nth(2);
    const gameId = await tile.getAttribute("data-game-id");

    // A finger going down IS the intent — nothing is being predicted — and it
    // arrives 80-300 ms before the click. Dispatched without the click so the
    // commit can be observed before the launch consumes it.
    await tile.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    const plan = (await speculation(page)).plan;
    assert.equal(plan.target, gameId);
    assert.notEqual(plan.rung, "NONE");
  }, { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
});

test("a lobby whose provider never answers still works", options, async () => {
  await withLobby(async (page) => {
    // Manifests cannot load from an unroutable origin. Nothing may throw, and
    // the free rung must still fire, because it costs nothing to be wrong.
    await page.locator(".tile").first().hover();
    await page.waitForTimeout(600);
    const state = await speculation(page);
    assert.equal(state.bytesUsed, 0, "no manifest means no byte spend");
    assert.ok(state.connected.length > 0, "transport hints do not need a manifest");
    assert.match(await page.locator("#m-manifest").textContent(), /loading/);
  });
});

test("a lobby with no posters served still shows real tiles, not empty boxes", options, async () => {
  await withLobby(async (page) => {
    // This test's static server has no /posters route, exactly like every way
    // of serving prototype/ that is not tools/sandbox_server.py.
    await page.waitForFunction(
      () => [...document.querySelectorAll(".tile img")]
        .every((image) => image.src.startsWith("data:image/svg+xml")),
      null,
      { timeout: 5_000 },
    );
    const painted = await page.locator(".tile img").evaluateAll((images) => images.map((image) => ({
      isFallback: image.src.startsWith("data:image/svg+xml"),
      background: getComputedStyle(image).backgroundImage,
      width: image.naturalWidth,
    })));
    assert.ok(painted.length > 0);
    assert.ok(painted.every((p) => p.isFallback));
    assert.ok(painted.every((p) => p.background.includes("gradient")));

    // Only the first rail is eager; the rest are lazy and may not have decoded
    // yet, which is the point of them being lazy. Wait for one to prove the
    // fallback is a real image and not just a string in an attribute.
    await page.waitForFunction(
      () => [...document.querySelectorAll(".tile img")].some((image) => image.naturalWidth > 0),
      null,
      { timeout: 5_000 },
    );
  });
});

test("an unreachable provider says so instead of loading forever", options, async () => {
  await withLobby(async (page) => {
    await page.waitForSelector("#provider-warning:not([hidden])", { timeout: 10_000 });
    assert.match(await page.locator("#m-manifest").textContent(), /no provider reachable/);
    // It must name the origin it tried and the command that fixes it.
    assert.match(await page.locator("#provider-warning").textContent(), /127\.0\.0\.1:9/);
    assert.match(await page.locator("#provider-warning").textContent(), /sandbox_server\.py/);
    // And the lobby must still be a working lobby.
    assert.ok(await page.locator(".tile").count() >= 8);
  });
});

test("the boot guard is removed on success and survives a module that never runs", options, async () => {
  await withLobby(async (page) => {
    assert.equal(await page.locator("#boot-error").count(), 0,
      "a booted lobby removes its own warning");
  });
});

test("a browser with no Network Information API still warms", options, async () => {
  // Firefox and every browser on iOS. This ran green in Chromium for a week
  // while warming nothing at all anywhere else, so it is asserted here against
  // a Chromium with the API removed rather than left to a manual check.
  await withLobby(async (page) => {
    assert.equal(await page.evaluate(() => typeof navigator.connection), "undefined");

    await page.waitForFunction(
      () => document.getElementById("m-tier").textContent === "REDUCED",
      null,
      { timeout: 5_000 },
    );
    // The ladder must still climb its cheap rungs. A budget ceiling is not a
    // hard stop, and must not silence the free rung either.
    await page.locator(".tile").first().hover();
    await page.waitForFunction(
      () => globalThis.__SPECULATION__().connected.length > 0,
      null,
      { timeout: 5_000 },
    );
    const plan = (await speculation(page)).plan;
    assert.notEqual(plan.rung, "NONE");
  }, {}, {
    initScript: () => {
      Object.defineProperty(navigator, "connection", { get: () => undefined });
    },
  });
});

