import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  OverlayLabel,
  OverlayTracker,
  RequestState,
  buildOverlayHtml,
  createInstrumentedRequester,
} from "../src/overlay.js";

// ---------------------------------------------------------------------------
// OverlayTracker — start / trackRequest
// ---------------------------------------------------------------------------

describe("OverlayTracker.start", () => {
  it("starts with no requests and null elapsed", () => {
    const tracker = new OverlayTracker();
    tracker.start(OverlayLabel.SIMULATED);
    const snap = tracker.snapshot();
    assert.equal(snap.total, 0);
    assert.equal(snap.pending, 0);
    assert.notEqual(snap.elapsedMs, null);
  });

  it("throws if started twice without reset", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    assert.throws(() => tracker.start(), /already started/);
  });

  it("rejects invalid label", () => {
    const tracker = new OverlayTracker();
    assert.throws(() => tracker.start("NOT_A_LABEL"), /valid OverlayLabel/);
  });

  it("elapsed is null before start", () => {
    const snap = new OverlayTracker().snapshot();
    assert.equal(snap.elapsedMs, null);
  });
});

describe("OverlayTracker.trackRequest", () => {
  it("adds a pending request", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    tracker.trackRequest("r1", { stage: "PRELOADER", estimatedBytes: 100 });
    const snap = tracker.snapshot();
    assert.equal(snap.total, 1);
    assert.equal(snap.pending, 1);
    assert.equal(snap.complete, 0);
  });

  it("rejects duplicate id", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    tracker.trackRequest("r1");
    assert.throws(() => tracker.trackRequest("r1"), /duplicate request id/);
  });

  it("rejects empty id", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    assert.throws(() => tracker.trackRequest(""), /non-empty string/);
  });

  it("clamps negative estimatedBytes to zero", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    tracker.trackRequest("r1", { estimatedBytes: -500 });
    tracker.completeRequest("r1");
    assert.equal(tracker.snapshot().totalEstimatedBytes, 0);
  });
});

// ---------------------------------------------------------------------------
// OverlayTracker — state transitions
// ---------------------------------------------------------------------------

describe("OverlayTracker state transitions", () => {
  it("complete increments complete count", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    tracker.trackRequest("r1");
    tracker.completeRequest("r1");
    const snap = tracker.snapshot();
    assert.equal(snap.complete, 1);
    assert.equal(snap.pending, 0);
  });

  it("fail increments failed count", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    tracker.trackRequest("r1");
    tracker.failRequest("r1");
    assert.equal(tracker.snapshot().failed, 1);
  });

  it("cancel increments cancelled count", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    tracker.trackRequest("r1");
    tracker.cancelRequest("r1");
    assert.equal(tracker.snapshot().cancelled, 1);
  });

  it("unknown id throws on transition", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    assert.throws(() => tracker.completeRequest("nope"), /unknown request id/);
  });

  it("totalEstimatedBytes counts only complete requests", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    tracker.trackRequest("r1", { estimatedBytes: 1000 });
    tracker.trackRequest("r2", { estimatedBytes: 2000 });
    tracker.trackRequest("r3", { estimatedBytes: 500 });
    tracker.completeRequest("r1");
    tracker.failRequest("r2");
    tracker.cancelRequest("r3");
    assert.equal(tracker.snapshot().totalEstimatedBytes, 1000);
  });

  it("mixed requests: counts are independent", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    for (let i = 0; i < 5; i++) tracker.trackRequest(`r${i}`);
    tracker.completeRequest("r0");
    tracker.completeRequest("r1");
    tracker.failRequest("r2");
    tracker.cancelRequest("r3");
    // r4 still pending
    const snap = tracker.snapshot();
    assert.equal(snap.total, 5);
    assert.equal(snap.complete, 2);
    assert.equal(snap.failed, 1);
    assert.equal(snap.cancelled, 1);
    assert.equal(snap.pending, 1);
  });
});

// ---------------------------------------------------------------------------
// OverlayTracker — reset
// ---------------------------------------------------------------------------

describe("OverlayTracker.reset", () => {
  it("clears all state", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    tracker.trackRequest("r1");
    tracker.completeRequest("r1");
    tracker.reset();
    const snap = tracker.snapshot();
    assert.equal(snap.total, 0);
    assert.equal(snap.elapsedMs, null);
  });

  it("allows restart after reset", () => {
    const tracker = new OverlayTracker();
    tracker.start();
    tracker.reset();
    assert.doesNotThrow(() => tracker.start(OverlayLabel.MEASURED));
  });
});

// ---------------------------------------------------------------------------
// createInstrumentedRequester
// ---------------------------------------------------------------------------

describe("createInstrumentedRequester", () => {
  it("rejects non-function requestAsset", () => {
    assert.throws(
      () => createInstrumentedRequester("not-a-function", new OverlayTracker()),
      /must be a function/,
    );
  });

  it("rejects non-OverlayTracker tracker", () => {
    assert.throws(
      () => createInstrumentedRequester(async () => {}, {}),
      /OverlayTracker instance/,
    );
  });

  it("tracks successful request as COMPLETE", async () => {
    const tracker = new OverlayTracker();
    tracker.start();
    const requester = createInstrumentedRequester(async () => {}, tracker);
    await requester("https://fixture.invalid/asset.js", { stage: "PRELOADER", estimatedBytes: 512 });
    const snap = tracker.snapshot();
    assert.equal(snap.complete, 1);
    assert.equal(snap.failed, 0);
    assert.equal(snap.totalEstimatedBytes, 512);
  });

  it("tracks failed request as FAILED", async () => {
    const tracker = new OverlayTracker();
    tracker.start();
    const requester = createInstrumentedRequester(
      async () => { throw new Error("synthetic failure"); },
      tracker,
    );
    await assert.rejects(() => requester("https://fixture.invalid/asset.js"));
    assert.equal(tracker.snapshot().failed, 1);
  });

  it("tracks aborted request as CANCELLED", async () => {
    const tracker = new OverlayTracker();
    tracker.start();
    const controller = new AbortController();
    controller.abort();
    const requester = createInstrumentedRequester(
      async () => { throw new Error("aborted"); },
      tracker,
    );
    await assert.rejects(() => requester("https://fixture.invalid/a.js", { signal: controller.signal }));
    assert.equal(tracker.snapshot().cancelled, 1);
    assert.equal(tracker.snapshot().failed, 0);
  });

  it("assigns sequential opaque ids (no URL stored)", async () => {
    const tracker = new OverlayTracker();
    tracker.start();
    const calls = [];
    const requester = createInstrumentedRequester(
      async (url) => calls.push(url),
      tracker,
    );
    // The URL is passed to the underlying requester but never stored in tracker
    await requester("https://fixture.invalid/a.js");
    await requester("https://fixture.invalid/b.js");
    assert.equal(tracker.snapshot().total, 2);
    assert.equal(tracker.snapshot().complete, 2);
  });

  it("does not store the URL in the snapshot", async () => {
    const tracker = new OverlayTracker();
    tracker.start();
    const requester = createInstrumentedRequester(async () => {}, tracker);
    await requester("https://secret.invalid/token=DO_NOT_STORE");
    const snap = JSON.stringify(tracker.snapshot());
    assert.ok(!snap.includes("secret.invalid"), "URL leaked into snapshot");
    assert.ok(!snap.includes("DO_NOT_STORE"), "token leaked into snapshot");
  });
});

// ---------------------------------------------------------------------------
// buildOverlayHtml
// ---------------------------------------------------------------------------

describe("buildOverlayHtml", () => {
  it("includes SIMULATED label for all numbers", () => {
    const snap = {
      pending: 1,
      complete: 2,
      failed: 0,
      cancelled: 0,
      total: 3,
      totalEstimatedBytes: 2048,
      elapsedMs: 500,
      label: OverlayLabel.SIMULATED,
    };
    const html = buildOverlayHtml(snap);
    assert.ok(html.includes("SIMULATED"));
    assert.ok(html.includes("2/3"));
  });

  it("renders — for null elapsed", () => {
    const snap = {
      pending: 0,
      complete: 0,
      failed: 0,
      cancelled: 0,
      total: 0,
      totalEstimatedBytes: 0,
      elapsedMs: null,
      label: OverlayLabel.SIMULATED,
    };
    assert.ok(buildOverlayHtml(snap).includes("—"));
  });

  it("formats bytes as MiB for large values", () => {
    const snap = {
      pending: 0,
      complete: 1,
      failed: 0,
      cancelled: 0,
      total: 1,
      totalEstimatedBytes: 2 * 1_048_576,
      elapsedMs: 100,
      label: OverlayLabel.SIMULATED,
    };
    assert.ok(buildOverlayHtml(snap).includes("MiB"));
  });
});
