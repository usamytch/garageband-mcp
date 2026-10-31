import assert from "node:assert/strict";
import { test } from "node:test";
import { trackTogglePlan } from "../src/track-toggle-plan.js";
import { withTemporarySettings } from "../src/settings-transaction.js";

test("solo-only temporary exports snapshot Mute and restore a previously muted track", async () => {
  const state = { solo: false, mute: true };
  const writes: string[] = [];
  const settings = trackTogglePlan([{ index: 20, name: "vocal", solo: true }]).map(setting => ({ ...setting,
    read: async () => state[setting.field],
    write: async (value: boolean) => {
      writes.push(`${setting.field}:${value}`);
      state[setting.field] = value;
      if (value) state[setting.field === "solo" ? "mute" : "solo"] = false;
    },
  }));
  await withTemporarySettings(settings, async () => assert.deepEqual(state, { solo: true, mute: false }));
  assert.deepEqual(state, { solo: false, mute: true });
  assert.deepEqual(writes, ["mute:false", "solo:true", "solo:false", "mute:true"]);
});

test("coupled settings recover a native toggle that changes state before rejecting", async () => {
  const state = { solo: false, mute: true };
  const settings = trackTogglePlan([{ index: 20, name: "vocal", solo: true, mute: false }]).map(setting => ({ ...setting,
    read: async () => state[setting.field],
    write: async (value: boolean) => {
      state[setting.field] = value;
      if (value) state[setting.field === "solo" ? "mute" : "solo"] = false;
      if (setting.field === "solo" && value) throw new Error("native reply lost after click");
    },
  }));
  await assert.rejects(withTemporarySettings(settings, async () => assert.fail("must not render")), /native reply lost/);
  assert.deepEqual(state, { solo: false, mute: true });
});

test("temporary export final readback detects a later restoration undoing its peer", async () => {
  const state = { solo: false, mute: true };
  const settings = trackTogglePlan([{ index: 20, name: "vocal", solo: true }]).map(setting => ({ ...setting,
    read: async () => state[setting.field],
    write: async (value: boolean) => {
      state[setting.field] = value;
      if (setting.field === "mute" && value) state.solo = true;
    },
  }));
  await assert.rejects(withTemporarySettings(settings, async () => {}), /Final restoration did not settle: 20:solo/);
});

test("Mute enabling uses the reciprocal safe order and contradictory requests are refused", () => {
  assert.deepEqual(trackTogglePlan([{ index: 1, name: "vocal", mute: true }]).map(setting => [setting.field, setting.value]), [["solo", false], ["mute", true]]);
  assert.throws(() => trackTogglePlan([{ index: 1, name: "vocal", mute: true, solo: true }]), /both Solo and Mute/);
  assert.throws(() => trackTogglePlan([{ index: 1, name: "vocal" }, { index: 1, name: "vocal" }]), /Duplicate track/);
});
