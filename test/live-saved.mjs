import assert from "node:assert/strict";
import { runFixture, arrangement } from "./live-client.mjs";

await runFixture(process.argv[2], "final-regression", async ({ call, json, evidence, project }) => {
  const expected = await json("gb_list_regions");
  assert.equal(expected.project, "MCP-Mixer-Test.band - Tracks");
  assert.deepEqual(expected.tracks.map((track) => track.regions.map((region) => [region.kind, region.startBar, region.endBar])), [
    [["midi", 3, 8]], [], [["midi", 1, 6]], [["audio", 5, 7]],
  ]);
  const tracks = await json("gb_list_tracks");
  assert.ok(tracks.every((track) => !track.mute && !track.solo));
  assert.equal(tracks[0].volume.value, 158);
  assert.equal(tracks[2].volume.value, 172);
  assert.equal(tracks[3].volume.value, 105);
  await call("gb_set_track_solo", { trackIndex: 4, enabled: false });
  await call("gb_set_master_volume", { level: 70 });
  await call("gb_save_project");
  await call("gb_close_project");
  await call("gb_open_project", { path: project });
  assert.deepEqual(arrangement(await json("gb_list_regions")), arrangement(expected));
  await call("gb_export_song", { filename: "MCP-Regions-Demo", format: "wav", directory: evidence, waitTimeoutSec: 60 });
});
