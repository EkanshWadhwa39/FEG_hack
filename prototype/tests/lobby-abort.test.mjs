import test from "node:test";
import assert from "node:assert/strict";
import { GovernorReason } from "../src/governor.js";
import { RefusalReason } from "../src/speculation.js";
import { shouldAbortInFlight } from "../src/lobby.js";

test("a budget ceiling declines new work without killing work in flight", () => {
  // The bug this pins: treating every governor refusal as a stop meant a full
  // budget aborted a 2.8 MB transfer that was already part paid for, gaining
  // nothing — the bytes on the wire are spent either way.
  assert.equal(
    shouldAbortInFlight(RefusalReason.GOVERNOR, GovernorReason.BUDGET_EXCEEDED),
    false,
  );
  assert.equal(
    shouldAbortInFlight(RefusalReason.GOVERNOR, GovernorReason.BUDGET_INVALID),
    false,
  );
});

test("instructions about what the browser should be doing now do stop it", () => {
  for (const reason of [
    GovernorReason.SAVE_DATA,
    GovernorReason.PAGE_HIDDEN,
    GovernorReason.DISABLED,
    GovernorReason.VISIBILITY_UNKNOWN,
  ]) {
    assert.equal(shouldAbortInFlight(RefusalReason.GOVERNOR, reason), true, reason);
  }
});

test("a withdrawn authorization always stops everything", () => {
  assert.equal(shouldAbortInFlight(RefusalReason.AUTHORIZATION, undefined), true);
  assert.equal(
    shouldAbortInFlight(RefusalReason.AUTHORIZATION, GovernorReason.ALLOWED),
    true,
  );
});

test("refusals that are not stops leave in-flight work alone", () => {
  for (const refusal of [
    RefusalReason.NO_INTENT,
    RefusalReason.BUDGET,
    RefusalReason.ALREADY_DONE,
    RefusalReason.TIER_TOO_LOW,
    null,
    undefined,
  ]) {
    assert.equal(shouldAbortInFlight(refusal, GovernorReason.ALLOWED), false);
  }
});
