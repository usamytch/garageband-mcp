import assert from "node:assert/strict";
import { runFixture, arrangement } from "./live-client.mjs";

await runFixture(process.argv[2], "audio-regression", async ({ call, json, evidence, project }) => {
  const before = await json("gb_list_regions");
  assert.equal(before.project, "MCP-Mixer-Test.band - Tracks");
  assert.equal(before.tracks.length, 3);
  let source = before.tracks[1].regions[0];
  assert.equal(source.name, "Audio-Region-Fixture");
  assert.equal(source.kind, "audio"); assert.equal(source.startBar, 1); assert.equal(source.endBar, 3);
  await call("gb_select_track", { index: 3 });
  await call("gb_add_track", { type: "audio" });
  const baseline = await json("gb_list_regions");
  assert.equal(baseline.tracks.length, 4);
  assert.equal(baseline.tracks[3].regions.length, 0);
  source = baseline.tracks[1].regions[0];
  await call("gb_move_region", { regionId: source.id, toBar: 9, targetTrackIndex: 1 }, true);
  source = await json("gb_move_region", { regionId: source.id, toBar: 3 });
  assert.equal(source.startBar, 3); assert.equal(source.endBar, 5);
  source = await json("gb_move_region", { regionId: source.id, toBar: 5, targetTrackIndex: 4 });
  assert.equal(source.trackIndex, 4); assert.equal(source.startBar, 5); assert.equal(source.endBar, 7);
  source = await json("gb_move_region", { regionId: source.id, toBar: 1, targetTrackIndex: 2 });
  assert.deepEqual(arrangement(await json("gb_list_regions")), arrangement(baseline));
  await call("gb_move_region", { regionId: source.id, toBar: 5, targetTrackIndex: 4 });
  await call("gb_set_track_volume", { trackIndex: 4, level: 45 });
  await call("gb_set_track_pan", { trackIndex: 4, pan: 0 });
  const expected = await json("gb_list_regions");
  await call("gb_save_project");
  await call("gb_close_project");
  await call("gb_open_project", { path: project });
  assert.deepEqual(arrangement(await json("gb_list_regions")), arrangement(expected));
  await call("gb_set_track_solo", { trackIndex: 4, enabled: true });
  try {
    await call("gb_export_song", { filename: "Audio-Solo", format: "wav", directory: evidence, waitTimeoutSec: 60 });
  } finally {
    await call("gb_set_track_solo", { trackIndex: 4, enabled: false });
  }
  await call("gb_export_song", { filename: "Audio-and-MIDI-Regions", format: "wav", directory: evidence, waitTimeoutSec: 60 });
  await call("gb_save_project");
});
