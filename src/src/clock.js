const IST_TIME_ZONE = "Asia/Kolkata";

const istFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function getIstClockReading(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError("A valid Date is required");
  }

  const parts = Object.fromEntries(
    istFormatter
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  return Object.freeze({
    display: `${parts.day} ${parts.month} ${parts.year} · ${parts.hour}:${parts.minute}:${parts.second} IST`,
    datetime: date.toISOString(),
  });
}

export function startIstClock(element, {
  now = () => new Date(),
  schedule = globalThis.setInterval,
} = {}) {
  if (!element || typeof element !== "object") {
    throw new TypeError("A clock element is required");
  }
  if (typeof now !== "function" || typeof schedule !== "function") {
    throw new TypeError("Clock dependencies must be functions");
  }

  const update = () => {
    const reading = getIstClockReading(now());
    element.textContent = reading.display;
    element.dateTime = reading.datetime;
  };

  update();
  return schedule(update, 1_000);
}

export { IST_TIME_ZONE };
