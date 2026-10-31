import { GBError } from "./errors.js";
import { runAX } from "./native-ax.js";
import { sleep } from "./osa.js";
import { TRACK_SCRIPT } from "./track-state.js";
import { parseRegion, parseRegionPositions, planMove, regionId, verifyMove, verifySelection, type RegionState, type RegionTrack } from "./region-model.js";

export const REGION_SCRIPT = `${TRACK_SCRIPT}
  function lanes() {
    if (scan(group('Tracks'), el => scalar(el, 'AXDescription') === 'Automation Parameter').length) fail('INVALID_INPUT', 'Call gb_set_automation_view with visible=false before reading or moving regions; GarageBand mislabels lanes in automation view.');
    return scan(group('Tracks'), el => scalar(el, 'AXRole') === 'AXLayoutArea' && /^Track \\d+ /.test(scalar(el, 'AXDescription') || ''))
      .map(hit => ({ ...hit, index: Number(/^Track (\\d+) /.exec(scalar(hit.element, 'AXDescription'))[1]) }));
  }
  function regionHits(lane) {
    return scan(lane, el => scalar(el, 'AXRole') === 'AXLayoutItem' && /^Region starts at/.test(scalar(el, 'AXHelp') || ''));
  }
  function regionTracks() {
    const allLanes = lanes();
    return headers().map(header => {
      const lane = one(allLanes.filter(hit => hit.index === header.index), 'track lane ' + header.index);
      return { index: header.index, name: scalar(control(header, 'name').element, 'AXDescription'),
        audio: null,
        regions: regionHits(lane).map(hit => ({ name: scalar(hit.element, 'AXDescription'), help: scalar(hit.element, 'AXHelp'), selected: scalar(hit.element, 'AXSelected') === true })) };
    });
  }
  function stopped() {
    const controls = scan(group('Control Bar'), el => scalar(el, 'AXRole') === 'AXCheckBox' && ['Play', 'Record'].indexOf(scalar(el, 'AXTitle')) >= 0);
    if (controls.length !== 2 || controls.some(hit => Number(scalar(hit.element, 'AXValue')) !== 0)) fail('INVALID_INPUT', 'Stop playback and recording before moving regions.');
  }
`;

export async function readRegions(): Promise<{ project: string; projectPath: string; tracks: RegionTrack[] }> {
  const raw = await runAX<{ project: string; projectPath: string; tracks: Array<Omit<RegionTrack, "regions"> & { regions: Array<Pick<RegionState, "name" | "help" | "selected">> }> }>(`${REGION_SCRIPT}
    noSheet();
    return { project: scalar(window.element, 'AXTitle'), projectPath: Application('GarageBand').documents[0].path(), tracks: regionTracks() };
  `);
  return { ...raw, tracks: raw.tracks.map((track) => {
    const regions = track.regions.map((item, index) => {
      const region = { ...item, ...parseRegion(item.help), ...parseRegionPositions(item.help), trackIndex: track.index, index: index + 1 };
      return { ...region, id: regionId(raw.projectPath || raw.project, region) };
    });
    // Monitoring controls also appear on software tracks; they do not identify type.
    const audio = regions.length && regions.every((region) => region.kind === "audio") ? true
      : regions.length && regions.every((region) => region.kind === "midi") ? false : null;
    return { ...track, audio, regions };
  }) };
}

let moving = false;

export async function moveRegion(id: string, toBar: number, targetTrackIndex?: number): Promise<RegionState> {
  if (moving) throw new GBError("INVALID_INPUT", "Another region move is in progress. Wait for its result.");
  moving = true;
  try {
    const before = await readRegions();
    if (!before.projectPath) throw new GBError("INVALID_INPUT", "Save the project before moving regions so its identity can be verified.");
    const plan = planMove(before.tracks, id, toBar, targetTrackIndex);
    if (plan.unchanged) return plan.region;
    await runAX(`${REGION_SCRIPT}
      noSheet(); stopped();
      if (Application('GarageBand').documents[0].path() !== ${JSON.stringify(before.projectPath)}) fail('VERIFICATION_FAILED', 'Project changed before the move.');
      const lane = one(lanes().filter(hit => hit.index === ${plan.region.trackIndex}), 'source lane');
      const hit = regionHits(lane)[${plan.region.index - 1}];
      if (!hit || scalar(hit.element, 'AXHelp') !== ${JSON.stringify(plan.region.help)}) fail('VERIFICATION_FAILED', 'Region changed before selection.');
      click(hit);
      return true;
    `);
    const selected = await readRegions();
    if (selected.project !== before.project || selected.projectPath !== before.projectPath) throw new GBError("VERIFICATION_FAILED", "Project changed before the move.");
    verifySelection(before.tracks, selected.tracks, id);
    await runAX(`${REGION_SCRIPT}
      noSheet(); stopped();
      if (Application('GarageBand').documents[0].path() !== ${JSON.stringify(before.projectPath)}) fail('VERIFICATION_FAILED', 'Project changed before the move.');
      if (scalar(window.element, 'AXTitle') !== ${JSON.stringify(before.project)}) fail('VERIFICATION_FAILED', 'Project changed before the move.');
      const lane = one(lanes().filter(hit => hit.index === ${plan.region.trackIndex}), 'source lane');
      const hits = regionHits(lane), hit = hits[${plan.region.index - 1}];
      if (!hit || scalar(hit.element, 'AXHelp') !== ${JSON.stringify(plan.region.help)} || scalar(hit.element, 'AXDescription') !== ${JSON.stringify(plan.region.name)}) fail('VERIFICATION_FAILED', 'Region changed before the move.');
      const target = one(lanes().filter(hit => hit.index === ${plan.targetTrackIndex}), 'destination lane');
      const source = geometry(hit), destination = geometry(target);
      if (source.size[0] < 12 || source.size[1] < 12) fail('INVALID_INPUT', 'Zoom in before moving this small region.');
      const dx = source.size[0] * ${plan.startBar - plan.region.startBar!} / ${plan.region.endBar! - plan.region.startBar!};
      const from = { x: source.pos[0] + source.size[0] / 2, y: source.pos[1] + source.size[1] / 2 };
      const to = { x: from.x + dx, y: destination.pos[1] + destination.size[1] / 2 };
      visible(from, source.clips); visible(to, destination.clips);
      if (!process.frontmost()) fail('NOT_FRONTMOST', 'GarageBand lost focus; no move performed.');
      if (process.windows[0].name() !== scalar(window.element, 'AXTitle')) fail('VERIFICATION_FAILED', 'The front window changed before the move.');
      // AXPosition can act on GarageBand's current selection rather than its receiver.
      // Drag only after a separate, fresh read verified the single-region selection.
      function mouse(type, point) {
        const event = $.CGEventCreateMouseEvent(null, type, point, $.kCGMouseButtonLeft);
        $.CGEventSetFlags(event, 0);
        $.CGEventSetIntegerValueField(event, $.kCGMouseEventClickState, 1);
        $.CGEventPost($.kCGHIDEventTap, event);
      }
      let lastPoint = from;
      mouse($.kCGEventLeftMouseDown, from);
      try {
        delay(0.15);
        for (let step = 1; step <= 16; step++) {
          if (!process.frontmost()) fail('NOT_FRONTMOST', 'Focus changed during drag. Inspect the arrangement before retrying.');
          lastPoint = { x: from.x + (to.x - from.x) * step / 16, y: from.y + (to.y - from.y) * step / 16 };
          mouse($.kCGEventLeftMouseDragged, lastPoint);
          delay(0.025);
        }
      } finally { mouse($.kCGEventLeftMouseUp, lastPoint); }
      return true;
    `);
    await sleep(300);
    // A new JXA process is intentional: GarageBand caches AXHelp on old handles.
    const after = await readRegions();
    if (after.project !== before.project || after.projectPath !== before.projectPath) throw new GBError("VERIFICATION_FAILED", "Project changed during verification.");
    return verifyMove(before.tracks, after.tracks, plan);
  } finally { moving = false; }
}
