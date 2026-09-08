import test from "node:test";
import assert from "node:assert/strict";
import {
  LoadPhase,
  MAX_PLACEHOLDERS,
  applyProgressiveRender,
  planProgressiveRender,
} from "../src/progressive.js";

test("nothing loaded yet renders a full shell, not a blank area", () => {
  const plan = planProgressiveRender({ expectedCount: 8 });
  assert.equal(plan.phase, LoadPhase.SHELL);
  assert.equal(plan.placeholders, 8);
  assert.equal(plan.ariaBusy, true);
});

test("placeholders shrink as real tiles arrive", () => {
  const plan = planProgressiveRender({ expectedCount: 8, items: [1, 2, 3] });
  assert.equal(plan.phase, LoadPhase.PARTIAL);
  assert.equal(plan.items.length, 3);
  assert.equal(plan.placeholders, 5);
});

test("placeholder count is capped for a large catalogue", () => {
  const plan = planProgressiveRender({ expectedCount: 900 });
  assert.equal(plan.placeholders, MAX_PLACEHOLDERS);
});

test("settling clears busy and announces the real count once", () => {
  const plan = planProgressiveRender({ expectedCount: 8, items: [1, 2], settled: true });
  assert.equal(plan.phase, LoadPhase.COMPLETE);
  assert.equal(plan.placeholders, 0);
  assert.equal(plan.ariaBusy, false);
  // The announcement reports what actually arrived, not what was expected.
  assert.equal(plan.announcement, "2 games loaded.");
});

test("an empty result is announced, not left as silent placeholders", () => {
  const plan = planProgressiveRender({ expectedCount: 10, settled: true });
  assert.equal(plan.phase, LoadPhase.EMPTY);
  assert.equal(plan.placeholders, 0);
  assert.equal(plan.announcement, "No games to show.");
});

test("nothing is announced while still loading", () => {
  // Repeating a count on every arrival would flood a screen reader.
  assert.equal(planProgressiveRender({ expectedCount: 5, items: [1] }).announcement, null);
  assert.equal(planProgressiveRender({ expectedCount: 5 }).announcement, null);
});

test("singular wording is used for one game", () => {
  assert.equal(
    planProgressiveRender({ items: [1], settled: true }).announcement,
    "1 game loaded.",
  );
});

test("more arrivals than expected do not produce negative placeholders", () => {
  const plan = planProgressiveRender({ expectedCount: 2, items: [1, 2, 3, 4] });
  assert.equal(plan.placeholders, 0);
});

test("invalid input is rejected", () => {
  assert.throws(() => planProgressiveRender({ expectedCount: -1 }), RangeError);
  assert.throws(() => planProgressiveRender({ expectedCount: 1.5 }), RangeError);
  assert.throws(() => planProgressiveRender({ items: "no" }), TypeError);
});

test("placeholders render inert and hidden from assistive technology", () => {
  const created = [];
  const documentImpl = {
    createElement: () => {
      const node = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, className: "" };
      created.push(node);
      return node;
    },
  };
  let children = [];
  const container = {
    attrs: {},
    replaceChildren: (...nodes) => { children = nodes; },
    setAttribute(k, v) { this.attrs[k] = v; },
  };

  const plan = planProgressiveRender({ expectedCount: 4, items: ["a"] });
  applyProgressiveRender(container, plan, (item) => ({ real: item }), { documentImpl });

  assert.equal(children.length, 4);          // 1 real + 3 placeholders
  assert.equal(created.length, 3);
  for (const node of created) {
    assert.equal(node.attrs["aria-hidden"], "true");
    assert.equal(node.className, "tile-placeholder");
  }
  assert.equal(container.attrs["aria-busy"], "true");
});

test("applyProgressiveRender validates its arguments", () => {
  assert.throws(() => applyProgressiveRender(null, {}, () => {}), TypeError);
  assert.throws(
    () => applyProgressiveRender({ replaceChildren() {} }, {}, "no"),
    TypeError,
  );
});
