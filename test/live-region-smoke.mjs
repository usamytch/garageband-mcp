import assert from "node:assert/strict";
import { runFixture, arrangement } from "./live-client.mjs";

await runFixture(process.argv[2], "region-smoke", async ({ call, json, project }) => {
  const before = await json("gb_list_regions");
  assert.equal(before.projectPath, project);
  assert.equal(before.tracks.length, 4);
  let source = before.tracks[3].regions[0];
  assert.equal(source.kind, "audio");
  assert.equal(source.startBar, 5);
  assert.equal(source.endBar, 7);
  source = await json("gb_move_region", { regionId: source.id, toBar: 1, targetTrackIndex: 2 });
  await call("gb_move_region", { regionId: source.id, toBar: 5, targetTrackIndex: 4 });
  assert.deepEqual(arrangement(await json("gb_list_regions")), arrangement(before));
  await call("gb_save_project");
});
