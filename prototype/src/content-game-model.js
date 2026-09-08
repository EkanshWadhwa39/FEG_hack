/** Original non-wagering sandbox scene. No DOM, provider code or cache APIs. */
export const ASSET_SPEC = Object.freeze([
  Object.freeze({ stage: "PRELOADER", file: "preloader", estimatedBytes: 16384 }),
  Object.freeze({ stage: "COMMON", file: "common", estimatedBytes: 32768 }),
  Object.freeze({ stage: "SPLASH", file: "splash", estimatedBytes: 65536 }),
]);
export const TOTAL_BODY_BYTES = 114688;
const BUILD = "synthetic-v1";

function fail() { throw new TypeError("Invalid synthetic launch plan"); }
function text(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Validate WITHOUT normalizing cache keys. Return a detached, frozen whitelist.
 * Existing resolved manifests use uppercase stages and lowercase URL filenames.
 * The parent owns fail-closed sandbox authorization before sending CONTENT_LAUNCH.
 */
export function validateLaunchPlan(message, origin) {
  let base;
  try { base = new URL(origin); } catch { fail(); }
  if (base.origin !== origin || !(base.protocol === "https:"
      || (base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))) fail();
  if (!message || message.type !== "CONTENT_LAUNCH" || !text(message.launchId, 128)
      || typeof message.title?.id !== "string"
      || !/^title-(0[1-9]|1[0-9]|20)$/.test(message.title.id)
      || !text(message.title?.title, 120)
      || !["hr-HR", "en"].includes(message.locale)
      || !["1x", "0.5x"].includes(message.tier)
      || !Array.isArray(message.assets) || message.assets.length !== 3) fail();
  const id = message.title.id;
  const assets = ASSET_SPEC.map(spec => {
    const matches = message.assets.filter(asset => asset?.stage === spec.stage);
    if (matches.length !== 1) fail();
    const asset = matches[0];
    const exact = `${origin}/synthetic/${id}/${BUILD}/${message.locale}/${message.tier}/${spec.file}.bin?v=1`;
    if (asset.url !== exact || asset.estimatedBytes !== spec.estimatedBytes || asset.version !== "1"
        || (asset.versionKey !== undefined && asset.versionKey !== "v")
        || (asset.versionInPath !== undefined && asset.versionInPath !== false)) fail();
    return Object.freeze({ stage: spec.stage, url: asset.url, estimatedBytes: spec.estimatedBytes, version: "1" });
  });
  return Object.freeze({ launchId: message.launchId,
    title: Object.freeze({ id, title: message.title.title }), build: BUILD,
    locale: message.locale, tier: message.tier, assets: Object.freeze(assets) });
}

function requireSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Expected uint32 seed");
}

/** Incremental FNV-1a: every consumed byte affects the seed, regardless of chunking.
 * Not cryptographic; these synthetic bodies are game inputs, not integrity proofs.
 */
export function hashBytes(bytes, seed = 2166136261) {
  requireSeed(seed);
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected byte array");
  let hash = seed;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}

/** Canonical PRELOADER/COMMON/SPLASH order, independent of network completion order. */
export function seedFromAssetHashes(hashes) {
  if (!Array.isArray(hashes) || hashes.length !== 3) throw new TypeError("Three body hashes required");
  let seed = 2166136261;
  for (const hash of hashes) {
    requireSeed(hash);
    seed = hashBytes(Uint8Array.of(hash & 255, (hash >>> 8) & 255,
      (hash >>> 16) & 255, hash >>> 24), seed);
  }
  return seed;
}

function randomSource(seed) {
  requireSeed(seed);
  let value = seed;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDeck(seed) {
  const random = randomSource(seed);
  const deck = Array.from({ length: 16 }, (_, i) => i % 8);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return Object.freeze(deck);
}

export function createTheme(seed) {
  const random = randomSource(seed);
  return Object.freeze({ hue: 155 + Math.floor(random() * 66),
    accentHue: 265 + Math.floor(random() * 56), rotation: Math.floor(random() * 24) - 12 });
}

function freezeState(state) {
  return Object.freeze({ ...state, faceUp: Object.freeze(state.faceUp), matched: Object.freeze(state.matched) });
}
export function createGame(seed) {
  return freezeState({ seed, deck: createDeck(seed), faceUp: [], matched: [], turns: 0, pairs: 0, complete: false });
}

/** Invalid indexes throw. Valid but unavailable cards are no-ops (same state).
 * A mismatch stays visible until explicitly dismissed; no inaccessible countdown.
 */
export function selectCard(state, index) {
  if (!Number.isInteger(index) || index < 0 || index >= 16) throw new RangeError("Invalid card index");
  if (state.complete || state.faceUp.length === 2 || state.matched.includes(index) || state.faceUp.includes(index)) return state;
  if (state.faceUp.length === 0) return freezeState({ ...state, faceUp: [index] });
  const first = state.faceUp[0];
  if (state.deck[first] !== state.deck[index]) {
    return freezeState({ ...state, faceUp: [first, index], turns: state.turns + 1 });
  }
  const pairs = state.pairs + 1;
  return freezeState({ ...state, faceUp: [], matched: [...state.matched, first, index],
    turns: state.turns + 1, pairs, complete: pairs === 8 });
}
export function dismissMismatch(state) {
  return state.faceUp.length === 2 ? freezeState({ ...state, faceUp: [] }) : state;
}
export function resetGame(state) { return createGame(state.seed); }
