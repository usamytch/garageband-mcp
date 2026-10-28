import assert from "node:assert/strict";
import { test } from "node:test";
import { drivePointerSlider } from "../src/control-model.js";

test("pointer slider reaches nonlinear, pixel-quantized values without accessibility writes", () => {
  for (const target of [0, 0.28, 0.65, 1]) {
    let value = 0.4, clicks = 0, time = 0;
    const result = drivePointerSlider({ value, min: 0, max: 1 }, target, 0.025, {
      read: () => value,
      click: fraction => {
        assert.ok(fraction >= 0 && fraction <= 1);
        value = (Math.round(fraction * 48) / 48) ** 1.4;
        clicks++;
      },
      wait: seconds => { time += seconds * 1000; }, now: () => time,
    });
    assert.ok(Math.abs(result.value - target) <= 0.025);
    assert.ok(clicks > 0 && clicks <= 10);
  }
});

test("pointer slider does not click an already settled value or hide failed readback", () => {
  assert.equal(drivePointerSlider({ value: 0.28, min: 0, max: 1 }, 0.28, 0.025, {
    read: () => 0.28, click: () => assert.fail("No click expected"), wait() {}, now: () => 0,
  }).value, 0.28);
  for (const read of [() => 0, () => NaN, () => 2, () => null as unknown as number]) {
    let clicks = 0;
    assert.throws(() => drivePointerSlider({ value: 0, min: 0, max: 1 }, 0.8, 0.025, {
      read, click: () => { clicks++; }, wait() {}, now: () => 0,
    }), { code: "VERIFICATION_FAILED" });
    assert.ok(clicks <= 20, "An ignored mouse action must not loop indefinitely");
  }
  assert.throws(() => drivePointerSlider({ value: 0.28, min: 0, max: 1 }, 0.28, 0.025, {
    read: () => 0.5, click: () => assert.fail("No click expected"), wait() {}, now: () => 0,
  }), { code: "VERIFICATION_FAILED" });
});

test("pointer slider handles native controls that nudge instead of jumping to the mouse", () => {
  for (const [initial, target] of [[0, 1], [1, 0], [0.4, 0.1], [0.7, 0.28]]) {
    let value = initial, time = 0;
    const result = drivePointerSlider({ value, min: 0, max: 1 }, target, 0.05, {
      read: () => value,
      click: fraction => { value = Math.max(0, Math.min(1, value + Math.sign(fraction - value) * 0.085864)); time += 300; },
      wait: seconds => { time += seconds * 1000; }, now: () => time,
    });
    assert.ok(Math.abs(result.value - target) <= 0.05);
  }
});

test("pointer slider propagates focus loss and rejects invalid targets before acting", () => {
  assert.throws(() => drivePointerSlider({ value: 0, min: 0, max: 1 }, 0.8, 0.025, {
    read: () => 0, click: () => { throw new Error("NOT_FRONTMOST"); }, wait() {}, now: () => 0,
  }), /NOT_FRONTMOST/);
  for (const target of [NaN, Infinity, -0.1, 1.1]) {
    assert.throws(() => drivePointerSlider({ value: 0, min: 0, max: 1 }, target, 0.025, {
      read: () => 0, click: () => assert.fail("No click expected"), wait() {}, now: () => 0,
    }), { code: "INVALID_INPUT" });
  }
});
