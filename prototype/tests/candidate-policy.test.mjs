import test from "node:test";
import assert from "node:assert/strict";
import { createSyntheticCatalogue, getPlayerCatalogue } from "../src/catalogue.js";
import { CandidatePolicy, createPopularityPrior, createSyntheticSession, selectCandidate } from "../src/candidate-policy.js";

const catalogue = createSyntheticCatalogue({ origin: "https://fixtures.example" });
const prior = createPopularityPrior({ catalogue });
const pick = (options = {}) => selectCandidate({ catalogue, prior, ...options });

test("Zipf bisection independently reproduces measured aggregate; buckets partition all 887 ranks", () => {
  assert.equal(prior.label, "SIMULATED");
  assert.match(prior.explanation, /NOT real 20-game popularity/);
  assert.match(prior.explanation, /MEASURED aggregate/);
  const values = Array.from({ length: 887 }, (_, i) => (i + 1) ** -prior.exponent);
  const sum = numbers => numbers.reduce((a, b) => a + b, 0);
  const total = sum(values);
  assert.ok(Math.abs(sum(values.slice(0, 10)) / total - 0.347) < 1e-12);
  assert.ok(Math.abs(prior.calibratedTop10Share - 0.347) < 1e-12);
  assert.equal(prior.buckets.length, 20);
  assert.equal(prior.buckets[0].rankStart, 1);
  assert.equal(prior.buckets.at(-1).rankEnd, 887);
  prior.buckets.forEach((bucket, i) => {
    assert.ok(Object.isFrozen(bucket));
    if (i) assert.equal(bucket.rankStart, prior.buckets[i - 1].rankEnd + 1);
    assert.ok([44, 45].includes(bucket.rankEnd - bucket.rankStart + 1));
    assert.ok(Math.abs(bucket.weight - sum(values.slice(bucket.rankStart - 1, bucket.rankEnd)) / total) < 1e-14);
    assert.equal(prior.weights[bucket.gameId], bucket.weight);
  });
  assert.ok(Math.abs(sum(Object.values(prior.weights)) - 1) < 1e-12);
  assert.deepEqual(createPopularityPrior(), prior);
  assert.ok(Object.isFrozen(prior.weights));
  assert.throws(() => createPopularityPrior({ catalogue: [] }));
});

test("sessions are fresh in-memory records with immutable, detached snapshots", () => {
  const session = createSyntheticSession({ catalogue });
  const before = session.snapshot();
  assert.deepEqual(before, { label: "SIMULATED", plays: [] });
  assert.equal(session.recordPlayed("unknown"), false);
  assert.equal(session.recordPlayed("title-02"), true);
  session.recordPlayed("title-01");
  session.recordPlayed("title-02");
  assert.deepEqual(session.snapshot().plays, [
    { id: "title-01", count: 1, lastPlayedSequence: 2 },
    { id: "title-02", count: 2, lastPlayedSequence: 3 },
  ]);
  assert.deepEqual(before.plays, []);
  assert.ok(Object.isFrozen(session.snapshot().plays[0]));
  assert.deepEqual(createSyntheticSession({ catalogue }).snapshot(), before);
});

test("OFF and unknown policy fail closed even with explicit intent", () => {
  for (const policy of [CandidatePolicy.OFF, "unknown", "__proto__"]) {
    for (const kind of ["CLICK", "HOVER_DWELL"]) {
      assert.equal(pick({ policy, intent: { gameId: "title-01", kind } }), null);
    }
  }
  assert.equal(selectCandidate({ policy: CandidatePolicy.POPULAR_UNPLAYED }), null);
});

test("favourite uses counts, then recency, then catalogue order; no history yields null", () => {
  const session = createSyntheticSession({ catalogue });
  const policy = CandidatePolicy.FAVOURITE;
  assert.equal(pick({ session, policy }), null);
  session.recordPlayed("title-02");
  session.recordPlayed("title-01");
  assert.equal(pick({ session, policy }).gameId, "title-01");
  session.recordPlayed("title-02");
  assert.equal(pick({ session, policy }).gameId, "title-02");
  assert.equal(pick({ policy, session: { plays: [
    { id: "title-02", count: 3, lastPlayedSequence: 5 },
    { id: "title-01", count: 3, lastPlayedSequence: 5 },
  ] } }).gameId, "title-01");
});

test("popular unplayed chooses highest remaining weight; exhaustion has no fallback", () => {
  const session = createSyntheticSession({ catalogue });
  const policy = CandidatePolicy.POPULAR_UNPLAYED;
  for (let i = 0; i < 20; i += 1) {
    const expected = catalogue.filter(entry => !session.snapshot().plays.some(play => play.id === entry.id))
      .sort((a, b) => prior.weights[b.id] - prior.weights[a.id])[0];
    const chosen = pick({ session, policy });
    assert.equal(chosen.gameId, expected.id);
    session.recordPlayed(chosen.gameId);
  }
  assert.equal(pick({ session, policy }), null);
  assert.equal(pick({ policy, prior: { weights: { "title-01": 1, "title-02": 1 } } }).gameId, "title-01");
});

test("valid intent overrides enabled policies, exact reason; no selection mutation/UI output", () => {
  const session = createSyntheticSession({ catalogue });
  session.recordPlayed("title-01");
  const before = JSON.stringify({ catalogue, session: session.snapshot(), prior });
  const visible = getPlayerCatalogue(catalogue);
  for (const policy of [CandidatePolicy.FAVOURITE, CandidatePolicy.POPULAR_UNPLAYED]) {
    for (const kind of ["HOVER_DWELL", "CLICK"]) {
      const chosen = pick({ session, policy, intent: { gameId: "title-20", kind } });
      assert.deepEqual(Object.keys(chosen), ["gameId", "policy", "policyLabel", "reason", "label"]);
      assert.equal(chosen.gameId, "title-20");
      assert.equal(chosen.reason, kind);
      assert.equal(chosen.label, "SIMULATED");
      assert.equal(chosen.policy, policy);
      assert.ok(chosen.policyLabel && Object.isFrozen(chosen));
    }
  }
  assert.equal(pick({ session, policy: CandidatePolicy.FAVOURITE,
    intent: { gameId: "unknown", kind: "CLICK" } }).gameId, "title-01");
  assert.equal(pick({ session, policy: CandidatePolicy.FAVOURITE,
    intent: { gameId: "title-20", kind: "FOCUS" } }).gameId, "title-01");
  assert.equal(JSON.stringify({ catalogue, session: session.snapshot(), prior }), before);
  assert.deepEqual(getPlayerCatalogue(catalogue), visible);
});
