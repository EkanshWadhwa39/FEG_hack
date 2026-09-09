/**
 * Lobby-to-game transition state machine.
 *
 * Two invariants from AGENTS.md drive this design:
 *
 *   - A transition may report `interactive` only from an authoritative
 *     input-accepted signal. An iframe `load` event, a first paint, or an
 *     elapsed timer are explicitly NOT that signal and are rejected.
 *   - The screen must stay long enough for assistive technology to announce
 *     its state before it disappears.
 *
 * The announcement duration is therefore a FLOOR, never a trigger. Elapsing it
 * clears nothing on its own; the screen waits indefinitely for the
 * authoritative signal. If the signal lands first, the screen holds for the
 * remainder of the floor so the announcement is not cut off.
 *
 * All clock and timer access is injected so the machine is deterministic under
 * test and makes no browser assumptions.
 */

export const TransitionState = Object.freeze({
  IDLE: "IDLE",
  VISIBLE: "VISIBLE",
  CLEARED: "CLEARED",
  FAILED: "FAILED",
});

/**
 * Signals the machine will accept as authoritative proof that the game is
 * accepting player input. Nothing else clears the screen.
 */
export const AUTHORITATIVE_SOURCES = Object.freeze(["INPUT_ACCEPTED"]);

/**
 * Signals that are commonly mistaken for readiness. They are named explicitly
 * so a future caller gets a loud error instead of a silent false-ready state.
 */
export const REJECTED_SOURCES = Object.freeze([
  "FIRST_PAINT",
  "IFRAME_LOAD",
  "DOM_CONTENT_LOADED",
  "SPLASH_VISIBLE",
  "TIMER",
  "ASSUMED",
]);

const authoritative = new Set(AUTHORITATIVE_SOURCES);

/** Default announcement floors, in milliseconds. */
export const ANNOUNCEMENT_FLOOR_MS = Object.freeze({
  STANDARD: 1_200,
  EXTENDED: 2_600,
});

export function createTransition({
  now = () => Date.now(),
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
  announcementMs = ANNOUNCEMENT_FLOOR_MS.STANDARD,
  extendedAnnouncementMs = ANNOUNCEMENT_FLOOR_MS.EXTENDED,
  extendedDuration = false,
} = {}) {
  for (const [name, value] of Object.entries({ now, schedule, cancel })) {
    if (typeof value !== "function") {
      throw new TypeError(`${name} must be a function`);
    }
  }
  for (const [name, value] of Object.entries({ announcementMs, extendedAnnouncementMs })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative finite number`);
    }
  }

  let state = TransitionState.IDLE;
  let useExtended = extendedDuration === true;
  let openedAt = null;
  let interactiveAt = null;
  let failureReason = null;
  let pendingTimer = null;
  const listeners = new Set();

  const floorMs = () => (useExtended ? extendedAnnouncementMs : announcementMs);

  function snapshot() {
    const elapsedMs = openedAt == null ? 0 : Math.max(0, now() - openedAt);
    return Object.freeze({
      state,
      // `interactive` is true only once an authoritative signal has arrived.
      // It is deliberately independent of whether the screen has cleared.
      interactive: interactiveAt != null,
      announcementFloorMs: floorMs(),
      announcementSatisfied: openedAt != null && elapsedMs >= floorMs(),
      extendedDuration: useExtended,
      elapsedMs,
      failureReason,
    });
  }

  function emit() {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function clearTimer() {
    if (pendingTimer != null) {
      cancel(pendingTimer);
      pendingTimer = null;
    }
  }

  /**
   * Clears only when the authoritative signal has arrived AND the announcement
   * floor has elapsed. Called on signal arrival and again when the floor is up.
   */
  function attemptClear() {
    pendingTimer = null;
    if (state !== TransitionState.VISIBLE || interactiveAt == null) return;

    const remainingMs = floorMs() - (now() - openedAt);
    if (remainingMs > 0) {
      // Hold for the remainder so the announcement is not truncated.
      pendingTimer = schedule(attemptClear, remainingMs);
      return;
    }

    state = TransitionState.CLEARED;
    emit();
  }

  return Object.freeze({
    /** Show the transition. Does not start any clearing countdown. */
    open() {
      if (state === TransitionState.VISIBLE) return snapshot();
      clearTimer();
      state = TransitionState.VISIBLE;
      openedAt = now();
      interactiveAt = null;
      failureReason = null;
      emit();
      return snapshot();
    },

    /**
     * Recorded for instrumentation only. First paint is not readiness and this
     * never advances the machine.
     */
    notifyFirstPaint() {
      return snapshot();
    },

    /**
     * The only path to CLEARED. Rejects any source that is not authoritative
     * proof that the game accepted input.
     */
    signalInteractive(source) {
      if (typeof source !== "string" || !authoritative.has(source)) {
        throw new RangeError(
          `refusing to treat "${source}" as interactive; `
          + `authoritative sources are ${AUTHORITATIVE_SOURCES.join(", ")}`,
        );
      }
      if (state !== TransitionState.VISIBLE) return snapshot();
      if (interactiveAt == null) {
        interactiveAt = now();
        emit();
      }
      attemptClear();
      return snapshot();
    },

    /** Roll back cleanly. Never reports interactive, never clears as success. */
    fail(reason = "UNKNOWN") {
      if (state !== TransitionState.VISIBLE) return snapshot();
      clearTimer();
      state = TransitionState.FAILED;
      interactiveAt = null;
      failureReason = String(reason);
      emit();
      return snapshot();
    },

    /** Return to idle so the lobby can be shown again after a failure. */
    reset() {
      clearTimer();
      state = TransitionState.IDLE;
      openedAt = null;
      interactiveAt = null;
      failureReason = null;
      emit();
      return snapshot();
    },

    /**
     * Extend the announcement floor. Takes effect on the current transition
     * too, so enabling it mid-transition cannot shorten an in-flight hold.
     */
    setExtendedDuration(enabled) {
      useExtended = enabled === true;
      if (state === TransitionState.VISIBLE) {
        clearTimer();
        attemptClear();
      }
      emit();
      return snapshot();
    },

    getState: snapshot,

    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
