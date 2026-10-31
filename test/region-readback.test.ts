import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { REGION_SCRIPT } from "../src/region-state.js";

test("large-session readback scans lanes once and preserves all region metadata", () => {
  const tracks = Array.from({ length: 62 }, (_, i) => ({ index: i + 1, element: { AXDescription: `Guitar ${i + 1}` } }));
  let laneReads = 0;
  const result = runInNewContext(`(() => { ${REGION_SCRIPT}
    headers = () => tracks;
    lanes = () => { countLanes(); return tracks; };
    control = header => header;
    regionHits = lane => [{element: {AXDescription: 'take ' + lane.index, AXHelp: 'Region starts at 1 bar and ends at 3 bars , Audio region.', AXSelected: lane.index === 41}}];
    return regionTracks();
  })()`, {
    tracks, countLanes: () => { laneReads++; },
    one: (hits: unknown[]) => { assert.equal(hits.length, 1); return hits[0]; },
    scalar: (el: Record<string, unknown>, key: string) => el[key],
  });
  assert.equal(laneReads, 1);
  assert.equal(result.length, 62);
  assert.equal(result[40].name, "Guitar 41");
  assert.equal(result[40].regions[0].selected, true);
  assert.equal(result[61].regions[0].name, "take 62");
});
