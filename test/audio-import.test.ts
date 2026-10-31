import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyAudioImport, type ImportSnapshot } from "../src/audio-import-model.js";

test("import verifies identity, project zero, one region and untouched neighbors", () => {
  const original = { name: "existing", kind: "audio", help: "Region starts at 3 bars and ends at 4 bars , Audio region." };
  const before: ImportSnapshot = { projectPath: "/test.band", tracks: [{ index: 1, name: "Original", regions: [original] }, { index: 2, name: "Import", regions: [] }] };
  const imported = { name: "candidate", kind: "audio", help: "Region starts at 1 bar and ends at 3 bars , Audio region." };
  const after = structuredClone(before);
  after.tracks[1].regions.push(imported);
  assert.equal(verifyAudioImport(before, after, 2, "Import", "/candidate.wav"), imported);
  for (const change of [
    (s: ImportSnapshot) => { s.projectPath = "/wrong.band"; },
    (s: ImportSnapshot) => { s.tracks[0].regions[0].name = "damaged"; },
    (s: ImportSnapshot) => { s.tracks[1].regions.push(imported); },
    (s: ImportSnapshot) => { s.tracks[1].regions[0].help = "Region starts at 2 bars and ends at 4 bars , Audio region."; },
    (s: ImportSnapshot) => { s.tracks[1].regions[0].name = "other-file"; },
  ]) {
    const invalid = structuredClone(after); change(invalid);
    assert.throws(() => verifyAudioImport(before, invalid, 2, "Import", "/candidate.wav"));
  }
});
