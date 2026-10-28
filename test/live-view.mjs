import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runFixture } from "./live-client.mjs";

// A separate scenario: any expendable saved copy with at least one track.
await runFixture(process.argv[2], "automation-view", async ({ call, json, evidence }) => {
  const transport = await json("gb_transport_state");
  assert.equal(transport.playing, false);
  assert.equal(transport.recording, false);
  await json("gb_set_automation_view", { visible: false });
  const before = await json("gb_list_regions");
  const tracksBefore = await json("gb_list_tracks");
  assert.ok(before.tracks.length > 0);
  assert.deepEqual(await json("gb_set_automation_view", { visible: true }), { visible: true, changed: true });
  assert.deepEqual(await json("gb_set_automation_view", { visible: true }), { visible: true, changed: false });
  assert.match(await call("gb_list_regions", {}, true), /gb_set_automation_view/);
  assert.deepEqual(await json("gb_set_automation_view", { visible: false }), { visible: false, changed: true });
  assert.deepEqual(await json("gb_set_automation_view", { visible: false }), { visible: false, changed: false });
  assert.deepEqual(await json("gb_list_regions"), before, "view changes must preserve every region and selection");
  assert.deepEqual(await json("gb_list_tracks"), tracksBefore, "view changes must preserve the mixer");
  await call("gb_save_project");
  await call("gb_close_project");
  await call("gb_open_project", { path: process.argv[2] });
  assert.deepEqual(await json("gb_set_automation_view", { visible: false }), { visible: false, changed: false });
  assert.deepEqual(await json("gb_list_regions"), before, "region timing must persist through reopen");
  assert.deepEqual(await json("gb_list_tracks"), tracksBefore, "mixer state must persist through reopen");
  await writeFile(join(evidence, "regions.json"), JSON.stringify(before, null, 2));
  await call("gb_export_song", { filename: "View-Roundtrip", format: "wav", directory: evidence, normalize: false });
});
