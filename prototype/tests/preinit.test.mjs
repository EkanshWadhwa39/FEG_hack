import test from "node:test";
import assert from "node:assert/strict";
import {
  Authorization,
  HIDDEN_STYLE,
  PreinitState,
  createPreinitManager,
} from "../src/preinit.js";

/** Minimal DOM stand-in that records what the manager did to the frame. */
function fakeDom() {
  const created = [];
  const documentImpl = {
    createElement() {
      const node = {
        attrs: {}, listeners: {}, removed: false, src: null,
        setAttribute(k, v) { this.attrs[k] = v; },
        removeAttribute(k) { delete this.attrs[k]; },
        addEventListener(type, fn) { this.listeners[type] = fn; },
        remove() { this.removed = true; },
        fireLoad() { this.listeners.load?.(); },
      };
      created.push(node);
      return node;
    },
  };
  const appended = [];
  const host = { append: (n) => appended.push(n) };
  return { documentImpl, host, created, appended };
}

const build = () => {
  const dom = fakeDom();
  return { ...dom, mgr: createPreinitManager({ host: dom.host, documentImpl: dom.documentImpl }) };
};

test("prepare creates a hidden, inert frame and reports PREPARING", () => {
  const { mgr, created, appended } = build();
  const state = mgr.prepare("eog", "http://game/");
  assert.equal(state.state, PreinitState.PREPARING);
  assert.equal(appended.length, 1);

  const frame = created[0];
  assert.equal(frame.src, "http://game/");
  assert.equal(frame.attrs.style, HIDDEN_STYLE);
  // Hidden from assistive tech and out of the tab order while preparing.
  assert.equal(frame.attrs["aria-hidden"], "true");
  assert.equal(frame.attrs.tabindex, "-1");
});

test("the frame's load event reports PREPARED, never ready", () => {
  const { mgr, created } = build();
  mgr.prepare("eog", "http://game/", { now: () => 1234 });
  created[0].fireLoad();

  const state = mgr.getState();
  assert.equal(state.state, PreinitState.PREPARED);
  assert.equal(state.prepared, true);
  assert.equal(state.preparedAt, 1234);
  // The parent cannot see into a cross-origin frame, so no readiness claim.
  assert.equal("ready" in state, false);
  assert.equal("interactive" in state, false);
});

test("reveal is a style change, so the frame is never reloaded", () => {
  const { mgr, created } = build();
  mgr.prepare("eog", "http://game/");
  created[0].fireLoad();
  const before = created[0].src;

  const result = mgr.reveal({ authorization: Authorization.GRANTED });
  assert.equal(result.revealed, true);
  assert.equal(created[0].src, before, "src must not be touched; re-navigating discards the work");
  assert.equal(created[0].removed, false, "the node must not be re-parented");
  assert.notEqual(created[0].attrs.style, HIDDEN_STYLE);
  // Now a real, focusable part of the page.
  assert.equal("aria-hidden" in created[0].attrs, false);
  assert.equal("tabindex" in created[0].attrs, false);
  assert.equal(created[0].attrs.title, "Game");
});

test("reveal fails closed on anything other than an explicit grant", () => {
  for (const authorization of [Authorization.DENIED, Authorization.UNKNOWN, undefined, "granted", null]) {
    const { mgr, created } = build();
    mgr.prepare("eog", "http://game/");
    created[0].fireLoad();

    const result = mgr.reveal({ authorization });
    assert.equal(result.revealed, false, `authorization ${authorization} must not reveal`);
    assert.match(result.reason, /^AUTHORIZATION_/);
    assert.equal(created[0].attrs.style, HIDDEN_STYLE, "frame must stay hidden");
  }
});

test("revealing a different title than was prepared is refused", () => {
  const { mgr, created } = build();
  mgr.prepare("eog", "http://game/");
  created[0].fireLoad();

  const result = mgr.reveal({ authorization: Authorization.GRANTED, expectGameId: "other" });
  assert.equal(result.revealed, false);
  assert.equal(result.reason, "GAME_MISMATCH");
  assert.equal(created[0].attrs.style, HIDDEN_STYLE);
});

test("revealing with nothing prepared is refused", () => {
  const { mgr } = build();
  const result = mgr.reveal({ authorization: Authorization.GRANTED });
  assert.equal(result.revealed, false);
  assert.equal(result.reason, "NOTHING_PREPARED");
});

test("a still-preparing frame can be revealed rather than restarted", () => {
  // Better a partially loaded frame than throwing the work away.
  const { mgr, created } = build();
  mgr.prepare("eog", "http://game/");
  const result = mgr.reveal({ authorization: Authorization.GRANTED });
  assert.equal(result.revealed, true);
  assert.equal(created[0].src, "http://game/");
});

test("preparing another title tears down the previous instance", () => {
  const { mgr, created } = build();
  mgr.prepare("first", "http://a/");
  mgr.prepare("second", "http://b/");
  // Only one live engine instance is ever worth the memory.
  assert.equal(created[0].removed, true);
  assert.equal(created.length, 2);
  assert.equal(mgr.getState().gameId, "second");
});

test("preparing the same title again does not restart it", () => {
  const { mgr, created } = build();
  mgr.prepare("eog", "http://game/");
  mgr.prepare("eog", "http://game/");
  assert.equal(created.length, 1, "re-preparing must not discard in-flight work");
});

test("cancel reclaims the frame immediately and returns to idle", () => {
  const { mgr, created } = build();
  mgr.prepare("eog", "http://game/");
  mgr.cancel();
  assert.equal(created[0].removed, true);
  assert.equal(mgr.getState().state, PreinitState.IDLE);
  assert.equal(mgr.getState().gameId, null);
});

test("a revealed frame is not torn down by cancel or re-prepare", () => {
  const { mgr, created } = build();
  mgr.prepare("eog", "http://game/");
  created[0].fireLoad();
  mgr.reveal({ authorization: Authorization.GRANTED });

  mgr.cancel();
  assert.equal(created[0].removed, false, "cancel must not kill a game the player is in");
  mgr.prepare("other", "http://b/");
  assert.equal(created.length, 1, "must not prepare over a live game");
  assert.equal(mgr.getState().state, PreinitState.REVEALED);
});

test("reset clears everything for the next launch", () => {
  const { mgr, created } = build();
  mgr.prepare("eog", "http://game/");
  created[0].fireLoad();
  mgr.reveal({ authorization: Authorization.GRANTED });
  mgr.reset();
  assert.equal(created[0].removed, true);
  assert.equal(mgr.getState().state, PreinitState.IDLE);
});

test("subscribers see transitions and can unsubscribe", () => {
  const { mgr, created } = build();
  const seen = [];
  const off = mgr.subscribe((s) => seen.push(s.state));
  mgr.prepare("eog", "http://game/");
  created[0].fireLoad();
  mgr.reveal({ authorization: Authorization.GRANTED });
  assert.deepEqual(seen, [PreinitState.PREPARING, PreinitState.PREPARED, PreinitState.REVEALED]);
  off();
  mgr.reset();
  assert.equal(seen.length, 3);
});

test("constructor and arguments are validated", () => {
  assert.throws(() => createPreinitManager({}), TypeError);
  assert.throws(() => createPreinitManager({ host: {}, documentImpl: {} }), TypeError);
  const { mgr } = build();
  assert.throws(() => mgr.prepare("", "http://a/"), TypeError);
  assert.throws(() => mgr.prepare("a", ""), TypeError);
  assert.throws(() => mgr.subscribe("no"), TypeError);
});
