import assert from "node:assert/strict";
import { test } from "node:test";
import { driveSlider, faderTarget, setToggle } from "../src/control-model.js";

test("volume uses the exposed range; pan has an exact MIDI center and both endpoints", () => {
  const volume = { min: 0, max: 233, value: 0 };
  assert.deepEqual([0, 68, 74, 100].map((v) => faderTarget(volume, "volume", v)), [0, 158, 172, 233]);
  const pan = { min: 0, max: 127, value: 64 };
  assert.deepEqual([-100, -35, 0, 35, 100].map((v) => faderTarget(pan, "pan", v)), [0, 42, 64, 86, 127]);
  assert.equal(faderTarget({ min: -1, max: 1, value: 0 }, "pan", 50), 0.5);
  for (const value of [NaN, Infinity, -101, 101]) assert.throws(() => faderTarget(pan, "pan", value));
});

test("a GarageBand slider that advances one unit per write reaches the requested value", () => {
  let value = 0, writes = 0, time = 0;
  const result = driveSlider({ min: 0, max: 233, value }, 233, 0, 0, {
    read: () => value,
    write: (target) => { value += Math.sign(target - value); writes++; },
    wait: (seconds) => { time += seconds * 1000; }, now: () => time,
  });
  assert.equal(result.value, 233);
  assert.equal(writes, 233);
});

test("slider rejects ignored writes, invalid readback, and drift after settling", () => {
  for (const read of [() => 0, () => NaN, () => Infinity]) {
    assert.throws(() => driveSlider({ min: 0, max: 1, value: 0 }, 1, 0, 0, {
      read, write() {}, wait() {}, now: () => 0,
    }), { code: "VERIFICATION_FAILED" });
  }
  assert.throws(() => driveSlider({ min: 0, max: 1, value: 0.65 }, 0.65, 0, 0.001, {
    read: () => 0.5, write() { assert.fail("No write expected"); }, wait() {}, now: () => 0,
  }), { code: "VERIFICATION_FAILED" });
  const result = driveSlider({ min: 0, max: 1, value: 0.65 }, 0.65, 0.0001, 1 / 127, {
    read: () => 82 / 127, write() { assert.fail("No write expected"); }, wait() {}, now: () => 0,
  });
  assert.equal(result.value, 82 / 127);
});

test("mute and solo explicit setters are idempotent; toggles invert and failures are errors", () => {
  let state = false, clicks = 0;
  const io = { read: () => state, click: () => { state = !state; clicks++; } };
  for (const enabled of [true, true, false, false]) assert.equal(setToggle(enabled, io), enabled);
  assert.equal(clicks, 2);
  assert.equal(setToggle(undefined, io), true);
  assert.equal(setToggle(undefined, io), false);
  assert.throws(() => setToggle(true, { read: () => false, click() {} }), { code: "VERIFICATION_FAILED" });
});

test("setting an already quantized master value is idempotent", () => {
  const current = 89 / 127;
  assert.equal(driveSlider({ min: 0, max: 1, value: current }, 0.7, 0.0001, 1 / 127, {
    read: () => current, write() { assert.fail("Quantized target already reached"); }, wait() {}, now: () => 0,
  }).value, current);
});
