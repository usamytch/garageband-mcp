import assert from "node:assert/strict";
import { test } from "node:test";
import { setAutomationView } from "../src/automation-view.js";

test("automation view requests are explicit, idempotent and return verified visibility", async () => {
  let visible = false, toggles = 0;
  const io = { read: async () => visible, toggle: async () => { toggles++; visible = !visible; } };
  assert.deepEqual(await setAutomationView(false, io), { visible: false, changed: false });
  assert.deepEqual(await setAutomationView(true, io), { visible: true, changed: true });
  assert.deepEqual(await setAutomationView(true, io), { visible: true, changed: false });
  assert.deepEqual(await setAutomationView(false, io), { visible: false, changed: true });
  assert.equal(toggles, 2);
});

test("automation view does not claim success or blindly toggle again after a failed change", async () => {
  let toggles = 0;
  await assert.rejects(setAutomationView(true, { read: async () => false, toggle: async () => { toggles++; } }), { code: "VERIFICATION_FAILED" });
  assert.equal(toggles, 1);
  await assert.rejects(setAutomationView(true, { read: async () => { throw new Error("WRONG_PROJECT"); }, toggle: async () => { toggles++; } }), /WRONG_PROJECT/);
  assert.equal(toggles, 1, "failed discovery must not click");
  await assert.rejects(setAutomationView(true, { read: async () => false, toggle: async () => { throw new Error("MENU_NOT_FOUND"); } }), /MENU_NOT_FOUND/);
});
