import test from "node:test";
import assert from "node:assert/strict";

import { getIstClockReading, IST_TIME_ZONE, startIstClock } from "../src/clock.js";

test("formats an instant in India Standard Time independently of host timezone", () => {
  const reading = getIstClockReading(new Date("2024-01-15T18:30:45.000Z"));

  assert.equal(IST_TIME_ZONE, "Asia/Kolkata");
  assert.equal(reading.display, "16 Jan 2024 · 00:00:45 IST");
  assert.equal(reading.datetime, "2024-01-15T18:30:45.000Z");
});

test("starts immediately and schedules a one-second clock update", () => {
  const element = { textContent: "", dateTime: "" };
  let scheduledCallback;
  let scheduledDelay;
  const dates = [
    new Date("2024-01-15T18:30:45.000Z"),
    new Date("2024-01-15T18:30:46.000Z"),
  ];

  const timerId = startIstClock(element, {
    now: () => dates.shift(),
    schedule: (callback, delay) => {
      scheduledCallback = callback;
      scheduledDelay = delay;
      return 42;
    },
  });

  assert.equal(timerId, 42);
  assert.equal(scheduledDelay, 1_000);
  assert.equal(element.textContent, "16 Jan 2024 · 00:00:45 IST");

  scheduledCallback();
  assert.equal(element.textContent, "16 Jan 2024 · 00:00:46 IST");
});

test("rejects invalid clock input instead of showing a misleading time", () => {
  assert.throws(() => getIstClockReading(new Date("invalid")), /valid Date/);
  assert.throws(() => startIstClock(null), /clock element/);
});
