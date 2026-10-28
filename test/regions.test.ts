import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRegion, parseRegionPositions, planMove, regionId, verifyMove, verifySelection, type RegionState, type RegionTrack } from "../src/region-model.js";

function region(trackIndex: number, startBar: number, endBar: number, name = "Guitar", kind: "audio" | "midi" = "audio"): RegionState {
  const help = `Region starts at ${startBar} bars  and ends at ${endBar} bars , ${kind === "midi" ? "MIDI" : "Audio"} region. Recorded test.`;
  const state = { trackIndex, index: 1, name, kind, startBar, endBar, ...parseRegionPositions(help), selected: false, help };
  return { ...state, id: regionId("fixture", state) };
}
const tracks = (): RegionTrack[] => [
  { index: 1, name: "Guitar", audio: true, regions: [region(1, 1, 5)] },
  { index: 2, name: "Vocal", audio: true, regions: [region(2, 9, 13, "Vocal")] },
  { index: 3, name: "Bass", audio: false, regions: [region(3, 1, 5, "Bass", "midi")] },
];

test("a move requires exactly its source selected and an unchanged arrangement", () => {
  const before = tracks(), id = before[0].regions[0].id;
  const selected = tracks();
  assert.throws(() => verifySelection(before, selected, id));
  selected[1].regions[0].selected = true;
  assert.throws(() => verifySelection(before, selected, id));
  selected[0].regions[0].selected = true;
  assert.throws(() => verifySelection(before, selected, id));
  selected[1].regions[0].selected = false;
  verifySelection(before, selected, id);
  selected[1].regions[0].endBar = 12;
  assert.throws(() => verifySelection(before, selected, id));
});

test("region parser preserves exact whole-bar timing and refuses unverified precision/types", () => {
  assert.deepEqual(parseRegion("Region starts at 1 bar  and ends at 6 bars , MIDI region. Contains notes."), { kind: "midi", startBar: 1, endBar: 6 });
  assert.deepEqual(parseRegion("Region starts at 2 bars  and ends at 4 bars , audio region. Recorded audio."), { kind: "audio", startBar: 2, endBar: 4 });
  for (const help of ["Region starts at 1 bar 2 beats and ends at 6 bars , MIDI region.", "Region starts at 0 bars and ends at 4 bars , MIDI region.", "Region starts at 6 bars and ends at 2 bars , MIDI region.", "Начало: 1 такт"]) {
    assert.equal(parseRegion(help).startBar, null);
  }
  assert.equal(parseRegion("Region starts at 1 bar and ends at 5 bars , Drummer region.").kind, "unsupported");
});

test("move planning rejects stale IDs, collisions, incompatible tracks and invalid bars before editing", () => {
  const before = tracks(), id = before[0].regions[0].id;
  assert.equal(planMove(before, id, 5, 2).endBar, 9); // Touching boundaries is legal.
  assert.equal(planMove(before, id, 1).unchanged, true);
  for (const [toBar, target] of [[6, 2], [1, 3], [1, 99], [0, 1], [1.5, 1], [NaN, 1]]) {
    assert.throws(() => planMove(before, id, toBar, target), { code: "INVALID_INPUT" });
  }
  assert.throws(() => planMove(before, "stale", 5), { code: "INVALID_INPUT" });
  before[1].regions[0].startBar = null;
  assert.throws(() => planMove(before, id, 1, 2), { code: "INVALID_INPUT" });
});

test("region positions retain fractional display units without inventing omitted units or a tick rate", () => {
  const help = "Region starts at 10 bars 3 beats 2 divisions  and ends at 15 bars 3 beats 2 divisions 121 ticks , Audio region.";
  assert.deepEqual(parseRegionPositions(help), {
    startPosition: { bar: 10, beat: 3, division: 2, tick: null, text: "10 bars 3 beats 2 divisions" },
    endPosition: { bar: 15, beat: 3, division: 2, tick: 121, text: "15 bars 3 beats 2 divisions 121 ticks" },
  });
  for (const [text, values] of [
    ["1 bar", [1, null, null, null]],
    ["20 bars 61 ticks", [20, null, null, 61]],
    ["4 bars 2 divisions", [4, null, 2, null]],
    ["4 bars 7 beats 1 division 0 ticks", [4, 7, 1, 0]],
  ] as const) {
    const position = parseRegionPositions(`Region starts at ${text} and ends at 30 bars , Audio region.`).startPosition;
    assert.deepEqual(position, { bar: values[0], beat: values[1], division: values[2], tick: values[3], text });
  }
  const state = { ...region(1, 10, 15), ...parseRegion(help), ...parseRegionPositions(help), help };
  assert.equal(state.startBar, null);
  assert.throws(() => planMove([{ index: 1, name: "Guitar", audio: true, regions: [state] }], state.id, 20), { code: "INVALID_INPUT" });
});

test("region position parsing fails closed on unknown, malformed or unsafe coordinates", () => {
  for (const text of ["0 bars", "2 bars 0 beats", "2 bars 0 divisions", "2 bars -1 ticks", "2 bars 1.5 beats", "2 bars 4 ticks 3 beats", "2 bars 3 beats 4 beats", "2 bars extra", "9007199254740993 bars", "2 bars 9007199254740993 ticks"]) {
    assert.equal(parseRegionPositions(`Region starts at ${text} and ends at 30 bars , Audio region.`).startPosition, null, text);
  }
  assert.deepEqual(parseRegionPositions("Начало: 1 такт"), { startPosition: null, endPosition: null });
  assert.equal(parseRegion("Region starts at 1 bar and ends at 9007199254740993 bars , Audio region.").endBar, null);
});

test("move verification requires the target, unchanged length, no lost/duplicated/damaged neighbors", () => {
  const before = tracks(), plan = planMove(before, before[0].regions[0].id, 5, 2);
  const after = tracks();
  after[0].regions = [];
  after[1].regions.push(region(2, 5, 9));
  assert.equal(verifyMove(before, after, plan).startBar, 5);
  assert.throws(() => verifyMove(before, before, plan), { code: "VERIFICATION_FAILED" });
  for (const mutate of [
    (state: RegionTrack[]) => { state[1].regions[1].endBar = 8; },
    (state: RegionTrack[]) => { state[1].regions[0].startBar = 10; },
    (state: RegionTrack[]) => { state[0].regions.push(before[0].regions[0]); },
    (state: RegionTrack[]) => { state[2].regions = []; },
  ]) {
    const broken = structuredClone(after); mutate(broken);
    assert.throws(() => verifyMove(before, broken, plan), { code: "VERIFICATION_FAILED" });
  }
  assert.notEqual(region(1, 1, 5).id, region(1, 5, 9).id);
  assert.notEqual(region(1, 1, 5).id, region(2, 1, 5).id);
  assert.notEqual(regionId("/one/song.band", before[0].regions[0]), regionId("/two/song.band", before[0].regions[0]));
});
