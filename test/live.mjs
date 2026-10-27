import assert from "node:assert/strict";
import { runFixture, arrangement } from "./live-client.mjs";

await runFixture(process.argv[2], "regression", async ({ call, json, evidence, project }) => {
  const before = await json("gb_list_regions");
  assert.equal(before.project, "MCP-Mixer-Test.band - Tracks");
  assert.equal(before.tracks.length, 2);
  assert.ok(before.tracks.every(t => t.regions.length === 1 && t.regions[0].startBar === 1 && t.regions[0].endBar === 6));
  for (const type of ["software", "audio"]) {
    await call("gb_select_track", { index: 2 });
    await call("gb_add_track", { type });
    const added = await json("gb_list_tracks");
    assert.equal(added.length, 3);
    assert.equal(added.filter(t => t.selected).length, 1);
    assert.equal((await json("gb_list_regions")).tracks[2].regions.length, 0);
    await call("gb_delete_selected_track", { confirm: true });
    assert.equal((await json("gb_list_tracks")).length, 2);
  }
  for (const level of [0, 100, 68]) assert.equal((await json("gb_set_track_volume", { trackIndex: 1, level })).volume.value, Math.round(233 * level / 100));
  for (const [pan, raw] of [[-100, 0], [100, 127], [0, 64], [-35, 42]]) assert.equal((await json("gb_set_track_pan", { trackIndex: 1, pan })).pan.value, raw);
  for (const kind of ["mute", "solo"]) for (const enabled of [true, true, false]) assert.equal((await json(`gb_set_track_${kind}`, { trackIndex: 1, enabled }))[kind], enabled);
  await call("gb_set_master_volume", { level: 70 });
  await call("gb_select_track", { index: 64 }, true);
  assert.deepEqual(arrangement(await json("gb_list_regions")), arrangement(before));
  let source = before.tracks[0].regions[0];
  const originalId = source.id;
  source = await json("gb_move_region", { regionId: source.id, toBar: 3 });
  assert.equal(source.startBar, 3); assert.equal(source.endBar, 8);
  await call("gb_move_region", { regionId: originalId, toBar: 1 }, true);
  await call("gb_move_region", { regionId: source.id, toBar: 2, targetTrackIndex: 2 }, true);
  source = await json("gb_move_region", { regionId: source.id, toBar: 7, targetTrackIndex: 2 });
  assert.equal(source.trackIndex, 2); assert.equal(source.startBar, 7); assert.equal(source.endBar, 12);
  await call("gb_move_region", { regionId: source.id, toBar: 7, targetTrackIndex: 2 }); // idempotent
  source = await json("gb_move_region", { regionId: source.id, toBar: 1, targetTrackIndex: 1 });
  assert.deepEqual(arrangement(await json("gb_list_regions")), arrangement(before));
  // Leave an audible, verified +2-bar arrangement for the new export.
  await call("gb_move_region", { regionId: source.id, toBar: 3 });
  const expected = await json("gb_list_regions");
  await call("gb_save_project");
  await call("gb_close_project");
  await call("gb_open_project", { path: project });
  assert.deepEqual(arrangement(await json("gb_list_regions")), arrangement(expected));
  await call("gb_export_song", { filename: "MIDI-Regions", format: "wav", directory: evidence, waitTimeoutSec: 60 });
  await call("gb_export_song", { filename: "MIDI-Regions", format: "wav", directory: evidence }, true);
  for (const trackIndex of [1, 2]) await call("gb_set_track_mute", { trackIndex, enabled: true });
  try {
    await call("gb_export_song", { filename: "Muted", format: "wav", directory: evidence, waitTimeoutSec: 60 });
  } finally {
    for (const trackIndex of [1, 2]) await call("gb_set_track_mute", { trackIndex, enabled: false });
    await call("gb_save_project");
  }
});
