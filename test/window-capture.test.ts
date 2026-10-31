import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseCaptureWindow } from "../src/window-capture.js";

test("capture selects the owner window even when another app covers identical bounds", () => {
  const bounds = { X: 100, Y: 100, Width: 800, Height: 600 };
  const wrong = { kCGWindowNumber: 1, kCGWindowOwnerPID: 5, kCGWindowLayer: 0, kCGWindowBounds: bounds };
  const right = { ...wrong, kCGWindowNumber: 2, kCGWindowOwnerPID: 10 };
  assert.equal(chooseCaptureWindow(10, bounds, [wrong, right]), 2);
  assert.throws(() => chooseCaptureWindow(10, bounds, [wrong]), /identify/);
  assert.throws(() => chooseCaptureWindow(10, bounds, [right, { ...right, kCGWindowNumber: 3 }]), /identify/);
  assert.throws(() => chooseCaptureWindow(10, bounds, [{ ...right, kCGWindowLayer: 5 }]), /identify/);
});
