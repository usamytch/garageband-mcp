import assert from "node:assert/strict";
import { test } from "node:test";
import { selectWholeSongExport } from "../src/export-range.js";
import { withNormalization } from "../src/export-settings.js";

test("disabled stale range checkbox means no selectable cycle/region range", () => {
  for (const value of [0, 1]) {
    const result = selectWholeSongExport({
      read: () => ({ enabled: false, value }),
      click: () => assert.fail("Disabled range must not be pressed"),
      wait: () => assert.fail("No change needs settling"),
    });
    assert.equal(result.enabled, false);
  }
});

test("enabled range is clicked once and its settled state is verified", () => {
  let clicks = 0, waits = 0;
  const result = selectWholeSongExport({
    read: () => ({ enabled: true, value: waits >= 2 ? 0 : 1 }),
    click: () => { clicks++; }, wait: () => { waits++; },
  });
  assert.equal(result.value, 0);
  assert.equal(clicks, 1);
  assert.equal(waits, 2);
});

test("unknown range state and ignored toggle cannot report export readiness", () => {
  for (const state of [{ enabled: null, value: 0 }, { enabled: true, value: null }, { enabled: true, value: 1 }]) {
    assert.throws(() => selectWholeSongExport({ read: () => state, click() {}, wait() {} }), { code: "VERIFICATION_FAILED" });
  }
});

test("normalization restoration failure retains the original export error", async () => {
  const primary = new Error("Export range failed"), restoration = new Error("Settings lost focus");
  let current = true;
  await assert.rejects(withNormalization(false, async enabled => {
    if (enabled === true) throw restoration;
    if (enabled !== undefined) current = enabled;
    return current;
  }, async () => { throw primary; }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, restoration]);
    assert.match(error.message, /Export range failed/);
    assert.match(error.message, /Settings lost focus/);
    return true;
  });
});
