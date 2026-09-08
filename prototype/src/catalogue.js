/**
 * The sandbox lobby's catalogue.
 *
 * Titles and provider names are the real ones listed publicly on
 * casino.psk.hr's own lobby page, so the demo reads like the product it is
 * proposing to change rather than like a wireframe with `Game 1`..`Game 6`.
 * Nothing else about them is real:
 *
 *   - **Every tile serves the same FEG-provided package**, under its own URL
 *     namespace (`/g1`, `/g2`, ...), so each has separate browser cache
 *     entries. Warming one does not warm another. That is what keeps the
 *     hit-rate story honest instead of a demo trick.
 *   - **Poster art is generated from that package's own splash background and
 *     symbol atlases** (`tools/poster_builder.py`). No PSK or third-party
 *     provider artwork is copied, hotlinked, or shipped.
 *   - Labels, rail membership, and the "popular" ordering are SIMULATED
 *     arrangements for the demo, not measured facts about these titles.
 *
 * ### Rails, and why none of them is a recommender
 *
 * The rails mirror what the production lobby actually shows -- `PSK Favoriti`,
 * `Nove igre`, and a continue-playing row -- and they are all constructed from
 * things the player did or from aggregate, non-personalised facts:
 *
 *   - `NASTAVI` — this session's own launches, most recent first.
 *   - `FAVORITI` — titles the player marked.
 *   - `NOVE` / `POPULARNO` — editorial and aggregate ordering, identical for
 *     every player.
 *
 * There is deliberately no "picks for you", no similarity model, and no
 * cross-player inference anywhere in this file. `CODE.md` forbids surfacing
 * predictor output to the player, and the way to keep that promise is to have
 * no player-visible surface capable of carrying it.
 */

/** Row headings, in the production lobby's own language. */
export const Rail = Object.freeze({
  NASTAVI: "NASTAVI",
  FAVORITI: "FAVORITI",
  NOVE: "NOVE",
  POPULARNO: "POPULARNO",
});

export const RAIL_TITLES = Object.freeze({
  [Rail.NASTAVI]: { hr: "Nastavi igrati", en: "Continue playing" },
  [Rail.FAVORITI]: { hr: "PSK Favoriti", en: "PSK favourites" },
  [Rail.NOVE]: { hr: "Nove igre", en: "New games" },
  [Rail.POPULARNO]: { hr: "Popularno", en: "Popular" },
});

/**
 * Corner chips the production tiles carry, with their measured colours.
 *
 * `original` is the Croatian text the live lobby renders; `text` is what this
 * demo shows, because the demo is read in English. Keeping both means the
 * colours and the chip vocabulary stay checkable against the real site.
 */
export const Chip = Object.freeze({
  NOVE: { text: "NEW", original: "NOVE", background: "#267808" },
  JACKPOT: { text: "JACKPOT", original: "JACKPOT", background: "#B02A15" },
  EKSKLUZIVNO: { text: "EXCLUSIVE", original: "EKSKLUZIVNO", background: "#1752BF" },
  IGRA_DANA: { text: "GAME OF THE DAY", original: "IGRA DANA", background: "#8A5A00" },
});

const PROVIDERS = Object.freeze([
  "Amusnet", "Playson", "EGT Digital", "Fazi", "Pragmatic Play",
  "Greentube", "Play'n GO", "Synot", "Amatic", "GameArt",
]);

/**
 * Titles as listed on the public lobby. Order is the order they appeared,
 * which is editorial, not measured popularity.
 */
const TITLES = Object.freeze([
  "Multiplay 81", "Frozzy Fruits", "Hunter's Dream 2", "Golden Fate 1000",
  "Dynamite Splash 20", "5 Burning Clover Clover Chance", "20 Super Hot Bell Link",
  "Fruit Force", "Diamonds Power: Hold and Win", "Lucky Piggies 2 Hold & Win",
  "Royal Coins 2: Hold and Win", "Hot Fruits 20 Extra Chillis", "Sizzling Hot Deluxe",
  "PSK Hot 40", "Reactoonz", "Lucky Streak 3", "Mystery Joker",
  "Book of Ra Deluxe Buy Bonus", "Lumberjack 2", "Cougar Blitz", "Dynamite Splash 5",
  "15 Diamonds", "Bufona Alegre 10", "King Rhino", "Cairo Dice", "100 Bulky Dice",
  "100 Burning Hot Buy Bonus", "Jungle Hustle", "Juicy Melons", "Monkey 27",
  "Savannah King", "Gold Gobblers", "Infectious 5 xways", "Pandora's Treasure",
  "Savanna Sunrise Deluxe", "Wild Cookies", "Black Pearl", "After Dark",
  "Treasures of Asgard", "Multi 5", "Fruit Blaster", "Multiplay Hot",
  "Very Hot 5 Extreme", "Wild Hot 40", "Chilli Respin", "Golden Crown",
  "Winning Clover 5 Extreme", "Very Hot 40 Extreme", "Bonus Epic Crown",
  "Wild Heat 40", "Clovers and Stars", "Epic Crown 10", "Book of Luxor Double",
  "Empire of Gold",
]);

/** Deterministic, so a reload never reshuffles the lobby. */
function chipFor(index) {
  if (index % 17 === 3) return Chip.IGRA_DANA;
  if (index % 7 === 1) return Chip.JACKPOT;
  if (index % 5 === 0) return Chip.NOVE;
  if (index % 11 === 4) return Chip.EKSKLUZIVNO;
  return null;
}

/**
 * Build the catalogue.
 *
 * @param count      how many tiles to produce
 * @param gameOrigin origin serving the package, e.g. `http://127.0.0.1:8091`
 * @param posterBase where the lobby serves generated posters from
 */
export function buildCatalogue({
  count = 24,
  gameOrigin = "",
  posterBase = "/posters",
} = {}) {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError("count must be a positive integer");
  }
  return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
    id: `g${index + 1}`,
    title: TITLES[index % TITLES.length],
    provider: PROVIDERS[index % PROVIDERS.length],
    chip: chipFor(index),
    // Every tile is the same package under a distinct cache namespace.
    url: `${gameOrigin}/g${index + 1}/`,
    poster: `${posterBase}/g${index + 1}.webp`,
  })));
}

/**
 * Which titles belong on which rail.
 *
 * `NASTAVI` is the player's own launch history this session and is therefore
 * passed in rather than baked here. Everything else is a fixed, identical-for-
 * everyone slice of the catalogue.
 */
export function buildRails({ catalogue, recents = [], favourites = [] } = {}) {
  if (!Array.isArray(catalogue)) throw new TypeError("catalogue must be an array");
  const byId = new Map(catalogue.map((item) => [item.id, item]));
  const resolve = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);

  const rails = [];
  const continuing = resolve(recents);
  if (continuing.length > 0) {
    rails.push({ rail: Rail.NASTAVI, items: continuing });
  }
  const favourite = resolve(favourites);
  if (favourite.length > 0) {
    rails.push({ rail: Rail.FAVORITI, items: favourite });
  }
  rails.push({ rail: Rail.NOVE, items: catalogue.slice(0, 12) });
  rails.push({ rail: Rail.POPULARNO, items: catalogue.slice(12, 24) });
  return Object.freeze(rails.map((entry) => Object.freeze({
    ...entry,
    title: RAIL_TITLES[entry.rail],
    items: Object.freeze(entry.items),
    // Read by the view layer as a refusal: no rail is a recommendation.
    personalised: entry.rail === Rail.NASTAVI || entry.rail === Rail.FAVORITI,
    algorithmic: false,
  })));
}
