/**
 * The challenge's own scoreboard, computed in the product rather than in a
 * spreadsheet afterwards.
 *
 * The brief names five metrics. Four of them can be computed honestly from
 * inside the page, and one cannot — and saying which is which is the point:
 *
 *   1. **Cold load p50 / p95** — measurable here, as click to the game frame
 *      being shown, split by which rung of the ladder the launch used.
 *   2. **Launch-to-play conversion** — NOT measurable here. "Play" means an
 *      accepted bet, which needs a backend this sandbox does not have. Recorded
 *      as UNKNOWN rather than approximated with something that sounds similar.
 *   3. **Games sampled per session** — measurable: distinct titles launched.
 *   4. **Perceived-load quality** — measurable as the gap between the first
 *      branded frame the player sees and the frame actually being shown.
 *   5. **Cache hit / prefetch accuracy** — measurable: of the titles we spent
 *      speculative bytes on, how many did the player actually launch.
 *
 * ### Perceived and real are different numbers and are kept apart
 *
 * The brief asks which gains are raw speed and which are perceived. So every
 * launch records two clocks:
 *
 *   - `perceivedMs` — click to the player seeing a correct, branded screen.
 *     Ours to control, and improvable by rendering something true immediately.
 *   - `shownMs` — click to the game's own frame being on screen. Real work.
 *
 * There is a third milestone this module deliberately does **not** record:
 * click to *playable*. The parent cannot see inside a cross-origin game frame,
 * and no input-accepted signal exists without a provider backend. Claiming it
 * from a `load` event would be the single most tempting dishonest number in
 * this project, so there is no field for it. `tools/sandbox_measure.mjs`
 * measures engine-canvas-present from outside the page, and even that is not
 * "playable".
 */

export const LaunchPath = Object.freeze({
  COLD: "COLD",
  WARM: "WARM",
  PREINIT: "PREINIT",
  BLOCKED: "BLOCKED",
});

/**
 * Nearest-rank percentile. No interpolation: with the handful of launches a
 * demo produces, an interpolated p95 invents a value between two real ones.
 */
export function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new RangeError("fraction must be in (0, 1]");
  }
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function distribution(values) {
  const finite = values.filter(Number.isFinite);
  return Object.freeze({
    count: finite.length,
    p50: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    min: finite.length ? Math.min(...finite) : null,
    max: finite.length ? Math.max(...finite) : null,
  });
}

export function createLaunchMetrics() {
  const launches = [];
  /** gameId -> the most expensive rung we spent on it. */
  const speculated = new Map();

  return Object.freeze({
    /**
     * Record that speculative work was actually paid for on a title.
     *
     * Only real spending counts. A transport hint is free, so it is not a bet
     * on the player's next move and must not dilute the accuracy figure.
     */
    noteSpeculation(gameId, rung) {
      if (typeof gameId !== "string" || gameId.length === 0) return false;
      if (rung !== "WARM" && rung !== "PREINIT") return false;
      // PREINIT outranks WARM: report the most expensive bet placed.
      if (speculated.get(gameId) === "PREINIT") return false;
      speculated.set(gameId, rung);
      return true;
    },

    /**
     * Start recording a launch. Returns an id for `settle`.
     *
     * `loadedMs` is usually not known yet: on the cold path the frame is
     * attached in a few milliseconds and then spends seconds loading, so
     * recording attachment time would report the baseline as the *fastest*
     * path in the product. The launch is opened here and closed by `settle`
     * when the frame reports that it finished.
     *
     * @param gameId
     * @param path        which rung the launch actually used
     * @param perceivedMs click to a correct branded screen
     * @param loadedMs    click to the game frame finishing its load, if known
     */
    record({ gameId, path, perceivedMs, loadedMs } = {}) {
      if (typeof gameId !== "string" || gameId.length === 0) return null;
      if (!Object.values(LaunchPath).includes(path)) return null;
      launches.push({
        gameId,
        path,
        perceivedMs: Number.isFinite(perceivedMs) ? perceivedMs : null,
        loadedMs: Number.isFinite(loadedMs) ? loadedMs : null,
        speculatedAs: speculated.get(gameId) ?? null,
      });
      return launches.length - 1;
    },

    /**
     * Close a launch when its frame finished loading.
     *
     * Only the first settle counts. A frame can fire `load` more than once and
     * a later, larger figure would quietly inflate the distribution.
     */
    settle(id, loadedMs) {
      const entry = launches[id];
      if (entry == null || entry.loadedMs != null) return false;
      if (!Number.isFinite(loadedMs)) return false;
      entry.loadedMs = loadedMs;
      return true;
    },

    summary() {
      // A blocked launch is a correct outcome, not a slow one. Including it in
      // the speed distribution would let the guardrail flatter the numbers.
      const completed = launches.filter((entry) => entry.path !== LaunchPath.BLOCKED);
      const byPath = {};
      for (const path of [LaunchPath.COLD, LaunchPath.WARM, LaunchPath.PREINIT]) {
        byPath[path] = distribution(
          completed.filter((entry) => entry.path === path).map((entry) => entry.loadedMs),
        );
      }

      const landed = new Set(
        completed.filter((entry) => entry.speculatedAs != null).map((entry) => entry.gameId),
      );

      return Object.freeze({
        launches: launches.length,
        blocked: launches.length - completed.length,

        // 1. Cold load p50/p95, and the same split by rung. A launch whose
        // frame has not finished loading yet simply is not in the
        // distribution; it is not a zero and it is not a failure.
        loaded: distribution(completed.map((entry) => entry.loadedMs)),
        byPath: Object.freeze(byPath),

        // 4. Perceived, kept separate from real on purpose.
        perceived: distribution(completed.map((entry) => entry.perceivedMs)),

        // 3. Discovery: the metric the whole problem statement is about.
        gamesSampled: new Set(completed.map((entry) => entry.gameId)).size,

        // 5. Did the speculation land?
        prefetch: Object.freeze({
          titlesSpeculated: speculated.size,
          titlesLaunched: landed.size,
          accuracy: speculated.size === 0 ? null : landed.size / speculated.size,
          launchesServedFromSpeculation: completed
            .filter((entry) => entry.path !== LaunchPath.COLD).length,
          hitRate: completed.length === 0
            ? null
            : completed.filter((entry) => entry.path !== LaunchPath.COLD).length / completed.length,
        }),

        // 2. Not measurable without a backend. Named, not approximated.
        launchToPlayConversion: "UNKNOWN",
      });
    },

    entries() {
      return Object.freeze(launches.map((entry) => Object.freeze({ ...entry })));
    },

    reset() {
      launches.length = 0;
      speculated.clear();
    },
  });
}
