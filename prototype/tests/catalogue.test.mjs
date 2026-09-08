import test from "node:test";
import assert from "node:assert/strict";
import { Chip, Rail, buildCatalogue, buildRails } from "../src/catalogue.js";

test("every tile gets its own cache namespace and its own poster", () => {
  const catalogue = buildCatalogue({ count: 5, gameOrigin: "http://game.test" });
  assert.equal(catalogue.length, 5);
  assert.deepEqual(catalogue.map((item) => item.url), [
    "http://game.test/g1/", "http://game.test/g2/", "http://game.test/g3/",
    "http://game.test/g4/", "http://game.test/g5/",
  ]);
  // Distinct URLs are the whole reason warming one tile does not warm another.
  assert.equal(new Set(catalogue.map((item) => item.url)).size, 5);
  assert.equal(new Set(catalogue.map((item) => item.poster)).size, 5);
});

test("the catalogue is deterministic, so a reload does not reshuffle the lobby", () => {
  const first = buildCatalogue({ count: 12 });
  const second = buildCatalogue({ count: 12 });
  assert.deepEqual(first, second);
});

test("more tiles than titles wraps rather than failing", () => {
  const catalogue = buildCatalogue({ count: 90 });
  assert.equal(catalogue.length, 90);
  assert.ok(catalogue.every((item) => typeof item.title === "string" && item.title.length > 0));
  assert.equal(new Set(catalogue.map((item) => item.id)).size, 90);
});

test("an invalid count is rejected", () => {
  assert.throws(() => buildCatalogue({ count: 0 }), RangeError);
  assert.throws(() => buildCatalogue({ count: 1.5 }), RangeError);
});

test("rails carry the production headings and are never algorithmic", () => {
  const catalogue = buildCatalogue({ count: 24 });
  const rails = buildRails({
    catalogue,
    recents: ["g3", "g1"],
    favourites: ["g7"],
  });

  assert.deepEqual(rails.map((rail) => rail.rail), [
    Rail.NASTAVI, Rail.FAVORITI, Rail.NOVE, Rail.POPULARNO,
  ]);
  assert.equal(rails[0].title.hr, "Nastavi igrati");
  // Continue-playing is the player's own launch order, untouched.
  assert.deepEqual(rails[0].items.map((item) => item.id), ["g3", "g1"]);
  // The contract the compliance rule depends on.
  assert.ok(rails.every((rail) => rail.algorithmic === false));
});

test("rails a player has not populated simply do not appear", () => {
  const catalogue = buildCatalogue({ count: 24 });
  const rails = buildRails({ catalogue, recents: [], favourites: [] });
  assert.deepEqual(rails.map((rail) => rail.rail), [Rail.NOVE, Rail.POPULARNO]);
});

test("unknown ids in history are dropped rather than rendered as holes", () => {
  const catalogue = buildCatalogue({ count: 6 });
  const rails = buildRails({ catalogue, recents: ["nope", "g2"], favourites: [] });
  assert.deepEqual(rails[0].items.map((item) => item.id), ["g2"]);
});

test("buildRails rejects a missing catalogue", () => {
  assert.throws(() => buildRails({ catalogue: null }), TypeError);
});

test("chips carry both the displayed text and the production original", () => {
  // The demo is read in English; the colours and vocabulary still have to be
  // checkable against the live lobby.
  const chips = new Set(buildCatalogue({ count: 24 })
    .map((item) => item.chip?.text).filter(Boolean));
  assert.ok(chips.size >= 3);
  assert.ok([...chips].every((text) => /^[A-Z ]+$/.test(text)));
  assert.equal(Chip.EKSKLUZIVNO.original, "EKSKLUZIVNO");
  assert.equal(Chip.NOVE.background, "#267808");
});
