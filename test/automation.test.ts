import assert from "node:assert/strict";
import { test } from "node:test";
import { planAutomation } from "../src/automation-model.js";
import { runInNewContext } from "node:vm";
import { AUTOMATION_SCRIPT } from "../src/automation-state.js";

test("automation preserves requested musical time and reports bounded visible-pixel quantization", () => {
  const points = [{ beat: 0, db: -4.5 }, { beat: 30.125, db: -3.3 }, { beat: 60, db: -4.5 }];
  const planned = planAutomation(points, 15.33, 334, 325, 1512);
  assert.deepEqual(planned.map((p) => p.beat), points.map((p) => p.beat));
  for (const p of planned) assert.ok(Math.abs(p.placedBeat - p.beat) <= 0.5 / 15.33);
});

test("automation rejects unsafe, unordered, overlapping or offscreen points before editing", () => {
  const base = { beat: 0, db: -4.5 };
  for (const tail of [{ beat: 0, db: -4.5 }, { beat: -1, db: -4.5 }, { beat: 0.1, db: -4.5 }, { beat: 900, db: -4.5 }, { beat: 10, db: -12 }, { beat: NaN, db: -4.5 }, { beat: 10, db: Infinity }]) {
    assert.throws(() => planAutomation([base, tail], 15, 334, 325, 1512), { code: "INVALID_INPUT" });
  }
  assert.throws(() => planAutomation([{ beat: 1, db: -4.5 }, { beat: 3, db: -4.5 }], 15, 334, 325, 1512), { code: "INVALID_INPUT" });
  assert.throws(() => planAutomation([base, { beat: 4, db: -4.5 }], 0, 334, 325, 1512), { code: "INVALID_INPUT" });
});

test("native automation checks before mouse-down and avoids UI queries while held", () => {
  let held = false;
  let guards = 0;
  const events: number[] = [];
  const probe = () => { assert.equal(held, false, "AX/Apple Events must not enter the mouse-tracking loop"); guards++; };
  runInNewContext(`(() => { ${AUTOMATION_SCRIPT}
    automationDrag({ x: 100, y: 100 }, { x: 100, y: 98 });
  })()`, {
    assertTarget: probe, process: { frontmost: () => { probe(); return true; } }, delay() {},
    $: { kCGEventLeftMouseDown: 1, kCGEventLeftMouseDragged: 2, kCGEventLeftMouseUp: 3,
      CGEventCreateMouseEvent: (_source: unknown, type: number) => type,
      CGEventSetFlags() {}, CGEventSetIntegerValueField() {},
      CGEventPost: (_tap: unknown, type: number) => { events.push(type); if (type === 1) held = true; if (type === 3) held = false; },
    },
  });
  assert.deepEqual(events, [1, 2, 2, 3]);
  assert.equal(guards, 2);
  assert.equal(held, false);
});

test("native automation releases the mouse even when a drag event fails", () => {
  const events: number[] = [];
  assert.throws(() => runInNewContext(`(() => { ${AUTOMATION_SCRIPT}
    automationDrag({ x: 100, y: 100 }, { x: 100, y: 98 });
  })()`, {
    assertTarget() {}, process: { frontmost: () => true }, delay() {},
    $: { kCGEventLeftMouseDown: 1, kCGEventLeftMouseDragged: 2, kCGEventLeftMouseUp: 3,
      CGEventCreateMouseEvent: (_source: unknown, type: number) => type,
      CGEventSetFlags() {}, CGEventSetIntegerValueField() {},
      CGEventPost: (_tap: unknown, type: number) => { events.push(type); if (type === 2) throw new Error("drag failed"); },
    },
  }), /drag failed/);
  assert.deepEqual(events, [1, 2, 3]);
});
