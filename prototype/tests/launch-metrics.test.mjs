import test from "node:test";
import assert from "node:assert/strict";
import { LaunchPath, createLaunchMetrics, percentile } from "../src/launch-metrics.js";

test("percentiles use nearest rank rather than inventing a value", () => {
  const values = [10, 20, 30, 40];
  assert.equal(percentile(values, 0.5), 20);
  assert.equal(percentile(values, 0.95), 40);
  assert.equal(percentile([7], 0.5), 7);
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile(null, 0.5), null);
  assert.throws(() => percentile(values, 0), RangeError);
  assert.throws(() => percentile(values, 1.5), RangeError);
});

test("cold load reports p50 and p95, and splits by which rung was used", () => {
  const metrics = createLaunchMetrics();
  for (const loadedMs of [600, 700, 800]) {
    metrics.record({ gameId: `cold${loadedMs}`, path: LaunchPath.COLD, loadedMs });
  }
  metrics.record({ gameId: "fast", path: LaunchPath.PREINIT, loadedMs: 2 });

  const summary = metrics.summary();
  assert.equal(summary.launches, 4);
  assert.equal(summary.byPath.COLD.p50, 700);
  assert.equal(summary.byPath.COLD.p95, 800);
  assert.equal(summary.byPath.PREINIT.p50, 2);
  assert.equal(summary.byPath.WARM.count, 0);
});

test("a blocked launch is a correct outcome, not a slow one", () => {
  // Counting the guardrail's refusals as launches would let it flatter the
  // speed numbers, which is the opposite of what the guardrail is for.
  const metrics = createLaunchMetrics();
  metrics.record({ gameId: "a", path: LaunchPath.COLD, loadedMs: 900 });
  metrics.record({ gameId: "b", path: LaunchPath.BLOCKED, loadedMs: 3 });

  const summary = metrics.summary();
  assert.equal(summary.launches, 2);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.loaded.count, 1);
  assert.equal(summary.loaded.p50, 900);
  assert.equal(summary.gamesSampled, 1);
});

test("perceived and real are reported separately", () => {
  const metrics = createLaunchMetrics();
  metrics.record({ gameId: "a", path: LaunchPath.COLD, perceivedMs: 40, loadedMs: 900 });
  metrics.record({ gameId: "b", path: LaunchPath.COLD, perceivedMs: 50, loadedMs: 1_100 });
  metrics.record({ gameId: "c", path: LaunchPath.COLD, perceivedMs: 60, loadedMs: 1_300 });

  const summary = metrics.summary();
  assert.equal(summary.perceived.p50, 50);
  assert.equal(summary.loaded.p50, 1_100);
  // The whole reason both exist: a branded screen can be up long before the
  // game's own frame is, and reporting one number would hide that.
  assert.ok(summary.perceived.p95 < summary.loaded.p95);
});

test("launch-to-play is named as unknown rather than approximated", () => {
  // The parent cannot see inside a cross-origin frame and there is no backend,
  // so any number here would be invented.
  assert.equal(createLaunchMetrics().summary().launchToPlayConversion, "UNKNOWN");
});

test("prefetch accuracy counts only bets that actually cost something", () => {
  const metrics = createLaunchMetrics();
  metrics.noteSpeculation("a", "WARM");
  metrics.noteSpeculation("b", "PREINIT");
  metrics.noteSpeculation("c", "WARM");
  // A transport hint is free, so it is not a bet and must not dilute accuracy.
  assert.equal(metrics.noteSpeculation("d", "CONNECT"), false);

  metrics.record({ gameId: "a", path: LaunchPath.WARM, loadedMs: 400 });
  metrics.record({ gameId: "b", path: LaunchPath.PREINIT, loadedMs: 2 });
  metrics.record({ gameId: "z", path: LaunchPath.COLD, loadedMs: 900 });

  const summary = metrics.summary();
  assert.equal(summary.prefetch.titlesSpeculated, 3);
  assert.equal(summary.prefetch.titlesLaunched, 2);
  assert.equal(summary.prefetch.accuracy, 2 / 3);
  assert.equal(summary.prefetch.launchesServedFromSpeculation, 2);
  assert.equal(summary.prefetch.hitRate, 2 / 3);
});

test("the most expensive bet on a title is the one reported", () => {
  const metrics = createLaunchMetrics();
  metrics.noteSpeculation("a", "WARM");
  metrics.noteSpeculation("a", "PREINIT");
  // Downgrading afterwards must not rewrite history.
  assert.equal(metrics.noteSpeculation("a", "WARM"), false);
  metrics.record({ gameId: "a", path: LaunchPath.PREINIT, loadedMs: 2 });
  assert.equal(metrics.entries()[0].speculatedAs, "PREINIT");
});

test("accuracy is null rather than zero when nothing was speculated", () => {
  const metrics = createLaunchMetrics();
  metrics.record({ gameId: "a", path: LaunchPath.COLD, loadedMs: 900 });
  const summary = metrics.summary();
  assert.equal(summary.prefetch.accuracy, null);
  assert.equal(summary.prefetch.hitRate, 0);
});

test("games sampled counts distinct titles, which is the discovery metric", () => {
  const metrics = createLaunchMetrics();
  for (const gameId of ["a", "a", "a", "b"]) {
    metrics.record({ gameId, path: LaunchPath.COLD, loadedMs: 500 });
  }
  assert.equal(metrics.summary().launches, 4);
  assert.equal(metrics.summary().gamesSampled, 2);
});

test("malformed records are refused rather than skewing the distribution", () => {
  const metrics = createLaunchMetrics();
  assert.equal(metrics.record({ gameId: "", path: LaunchPath.COLD, loadedMs: 1 }), null);
  assert.equal(metrics.record({ gameId: "a", path: "NONSENSE", loadedMs: 1 }), null);
  assert.equal(metrics.record(), null);

  const id = metrics.record({ gameId: "a", path: LaunchPath.COLD, loadedMs: Number.NaN });
  assert.equal(metrics.entries()[0].loadedMs, null);
  assert.equal(metrics.summary().loaded.count, 0, "an unusable timing is not a zero");
  assert.equal(metrics.settle(id, Number.NaN), false);
});

test("reset clears launches and speculation together", () => {
  const metrics = createLaunchMetrics();
  metrics.noteSpeculation("a", "WARM");
  metrics.record({ gameId: "a", path: LaunchPath.WARM, loadedMs: 5 });
  metrics.reset();
  const summary = metrics.summary();
  assert.equal(summary.launches, 0);
  assert.equal(summary.prefetch.titlesSpeculated, 0);
});

test("a launch is opened on click and closed when its frame finishes", () => {
  // The cold path attaches a frame in about 3 ms and then loads for seconds.
  // Timing attachment would report the untouched baseline as the fastest path
  // in the product, which is the opposite of true.
  const metrics = createLaunchMetrics();
  const id = metrics.record({ gameId: "a", path: LaunchPath.COLD, perceivedMs: 4 });
  assert.equal(metrics.summary().loaded.count, 0, "not finished, so not a data point");

  assert.equal(metrics.settle(id, 4_800), true);
  assert.equal(metrics.summary().loaded.p50, 4_800);

  // A frame can fire load more than once; a later figure must not inflate it.
  assert.equal(metrics.settle(id, 9_000), false);
  assert.equal(metrics.summary().loaded.p50, 4_800);
  assert.equal(metrics.settle(999, 100), false);
});
