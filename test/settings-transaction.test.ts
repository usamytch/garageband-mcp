import assert from "node:assert/strict";
import { test } from "node:test";
import { withTemporarySettings, type TemporarySetting, type SettingEvent } from "../src/settings-transaction.js";

test("temporary changes restore on action failure without writing unrelated fields", async () => {
  const state = { solo: false, mute: true, pan: 7 };
  const journal: SettingEvent[] = [];
  const setting = (key: "solo" | "mute", value: boolean): TemporarySetting => ({ key, value,
    read: async () => state[key], write: async v => { state[key] = v; },
  });
  await assert.rejects(withTemporarySettings([setting("solo", true), setting("mute", false)], async () => {
    assert.deepEqual(state, { solo: true, mute: false, pan: 7 });
    state.pan = 12;
    throw Error("export failed");
  }, async event => { journal.push(event); }), /export failed/);
  assert.deepEqual(state, { solo: false, mute: true, pan: 12 });
  assert.deepEqual(journal.filter(x => x.phase === "restore").map(x => x.key), ["mute", "solo"]);
});

test("a setup write that changes state and then fails is still restored", async () => {
  let current = false;
  await assert.rejects(withTemporarySettings([{ key: "solo", value: true, read: async () => current,
    write: async value => { current = value; if (value) throw Error("lost readback"); },
  }], async () => assert.fail("Must not export after setup failure")), /lost readback/);
  assert.equal(current, false);
});

test("all restorations are attempted and original failure is retained", async () => {
  const values = [false, false];
  const restored: number[] = [];
  const settings = values.map((_, index) => ({ key: String(index), value: true, read: async () => values[index],
    write: async (value: boolean) => { if (!value) { restored.push(index); throw Error(`restore ${index}`); } values[index] = value; },
  }));
  await assert.rejects(withTemporarySettings(settings, async () => { throw Error("primary"); }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 3);
    assert.match(error.message, /primary/);
    return true;
  });
  assert.deepEqual(restored, [1, 0]);
});
