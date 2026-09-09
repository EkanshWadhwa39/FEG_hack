import test from "node:test";
import assert from "node:assert/strict";
import { createSimulatedRequester } from "../src/simulation.js";

test("simulated requester performs only the injected local delay", async () => {
  const delays = [];
  const requester = createSimulatedRequester({
    delayMs: 25,
    sleep: async (milliseconds) => delays.push(milliseconds),
  });

  await requester("https://provider.invalid/asset.js?token=must-not-be-used");
  assert.deepEqual(delays, [25]);
});

test("simulated requester rejects invalid configuration", () => {
  assert.throws(() => createSimulatedRequester({ delayMs: -1 }), /delayMs/);
  assert.throws(() => createSimulatedRequester({ sleep: null }), /sleep/);
});
