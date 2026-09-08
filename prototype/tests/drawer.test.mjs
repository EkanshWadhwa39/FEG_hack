import test from "node:test";
import assert from "node:assert/strict";
import {
  DrawerView,
  FORBIDDEN_FIELDS,
  PLAYER_VISIBLE_FIELDS,
  buildDrawer,
  createIntentReporter,
  normalizeSearchText,
} from "../src/drawer.js";

const CATALOGUE = [
  { id: "eog", title: "Empire of Gold", provider: "Spiniq" },
  { id: "ssd", title: "Savanna Sunrise Deluxe", provider: "Spiniq" },
  { id: "zez", title: "Žeželj Gold", provider: "Amusnet" },
  { id: "sun", title: "Sunset Reels", provider: "Pragmatic" },
  { id: "gld", title: "Golden Hour", provider: "Playtech" },
];

test("favourites use the player's own ordering, most recent first", () => {
  const result = buildDrawer({
    catalogue: CATALOGUE,
    favourites: [
      { id: "sun", favouritedAt: 100 },
      { id: "eog", favouritedAt: 300 },
      { id: "gld", favouritedAt: 200 },
    ],
    view: DrawerView.FAVOURITES,
  });
  assert.deepEqual(result.items.map((item) => item.id), ["eog", "gld", "sun"]);
  assert.equal(result.emptyReason, null);
});

test("recents order by the player's own last-played time", () => {
  const result = buildDrawer({
    catalogue: CATALOGUE,
    recents: [
      { id: "zez", lastPlayedAt: 10 },
      { id: "ssd", lastPlayedAt: 90 },
    ],
    view: DrawerView.RECENTS,
  });
  assert.deepEqual(result.items.map((item) => item.id), ["ssd", "zez"]);
});

test("entries for titles absent from the catalogue are dropped", () => {
  const result = buildDrawer({
    catalogue: CATALOGUE,
    favourites: [{ id: "gone", favouritedAt: 999 }, { id: "eog", favouritedAt: 1 }],
    view: DrawerView.FAVOURITES,
  });
  assert.deepEqual(result.items.map((item) => item.id), ["eog"]);
});

test("search ranks by text relevance only, prefix before substring", () => {
  const result = buildDrawer({
    catalogue: CATALOGUE,
    query: "gol",
    view: DrawerView.SEARCH,
  });
  // "Golden Hour" prefix-matches; "Empire of Gold" and "Žeželj Gold" contain it.
  assert.equal(result.items[0].title, "Golden Hour");
  assert.deepEqual(
    result.items.slice(1).map((item) => item.title).sort(),
    ["Empire of Gold", "Žeželj Gold"],
  );
});

test("search folds Croatian diacritics and case", () => {
  assert.equal(normalizeSearchText("Žeželj"), "zezelj");
  assert.equal(normalizeSearchText("ČĆŠĐ"), "ccsd");
  assert.equal(normalizeSearchText(null), "");

  const result = buildDrawer({
    catalogue: CATALOGUE,
    query: "  ZEZELJ ",
    view: DrawerView.SEARCH,
  });
  assert.deepEqual(result.items.map((item) => item.id), ["zez"]);
});

test("empty states are distinguishable so they can be announced precisely", () => {
  const cases = [
    [{ view: DrawerView.FAVOURITES }, "NO_FAVOURITES"],
    [{ view: DrawerView.RECENTS }, "NO_RECENTS"],
    [{ view: DrawerView.SEARCH, query: "   " }, "EMPTY_QUERY"],
    [{ view: DrawerView.SEARCH, query: "zzzz" }, "NO_MATCHES"],
  ];
  for (const [options, expected] of cases) {
    const result = buildDrawer({ catalogue: CATALOGUE, ...options });
    assert.equal(result.items.length, 0);
    assert.equal(result.emptyReason, expected);
  }
});

test("predictor fields in the catalogue are a hard error, not a silent strip", () => {
  for (const field of FORBIDDEN_FIELDS) {
    assert.throws(
      () => buildDrawer({
        catalogue: [{ id: "x", title: "X", [field]: 0.99 }],
        favourites: [{ id: "x", favouritedAt: 1 }],
        view: DrawerView.FAVOURITES,
      }),
      RangeError,
      `field "${field}" must be refused`,
    );
  }
});

test("rendered items expose only whitelisted fields", () => {
  const result = buildDrawer({
    catalogue: [{ id: "x", title: "X", provider: "P", internalNote: "leak" }],
    favourites: [{ id: "x", favouritedAt: 1 }],
    view: DrawerView.FAVOURITES,
  });
  assert.deepEqual(Object.keys(result.items[0]).sort(), [...PLAYER_VISIBLE_FIELDS].sort());
  assert.equal("internalNote" in result.items[0], false);
});

test("ordering never depends on catalogue position or any external signal", () => {
  const forward = buildDrawer({
    catalogue: CATALOGUE,
    favourites: [{ id: "sun", favouritedAt: 5 }, { id: "eog", favouritedAt: 9 }],
    view: DrawerView.FAVOURITES,
  });
  const reversed = buildDrawer({
    catalogue: [...CATALOGUE].reverse(),
    favourites: [{ id: "sun", favouritedAt: 5 }, { id: "eog", favouritedAt: 9 }],
    view: DrawerView.FAVOURITES,
  });
  assert.deepEqual(
    forward.items.map((item) => item.id),
    reversed.items.map((item) => item.id),
  );
});

test("input validation rejects unusable arguments", () => {
  assert.throws(() => buildDrawer({ view: "PICKS_FOR_YOU" }), RangeError);
  assert.throws(() => buildDrawer({ catalogue: "no" }), TypeError);
  assert.throws(
    () => buildDrawer({
      catalogue: [{ id: "", title: "X" }],
      view: DrawerView.SEARCH,
      query: "x",
    }),
    TypeError,
  );
});

test("the intent seam is one-way and cannot feed the drawer", () => {
  const seen = [];
  const report = createIntentReporter((intent) => seen.push(intent.gameId));

  report("eog");
  report("");
  report(null);
  assert.deepEqual(seen, ["eog"]);

  // Reporting intent changes nothing about what the player is shown.
  const before = buildDrawer({ catalogue: CATALOGUE, query: "gol", view: DrawerView.SEARCH });
  report("zez");
  const after = buildDrawer({ catalogue: CATALOGUE, query: "gol", view: DrawerView.SEARCH });
  assert.deepEqual(
    before.items.map((item) => item.id),
    after.items.map((item) => item.id),
  );
  assert.throws(() => createIntentReporter("nope"), TypeError);
});
