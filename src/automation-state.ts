import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runAX } from "./native-ax.js";
import { TRACK_SCRIPT, selectTrack, setTrackDecibels } from "./track-state.js";
import { TRANSPORT_SCRIPT, seekBar, setControlToggle } from "./transport-state.js";
import * as ui from "./ui.js";
import { runAppleScript, runJXA } from "./osa.js";
import { GBError } from "./errors.js";
import { planAutomation, type AutomationPoint } from "./automation-model.js";
import { dataDirectory } from "./runtime-paths.js";

const exec = promisify(execFile);

export const AUTOMATION_SCRIPT = `${TRACK_SCRIPT}\n${TRANSPORT_SCRIPT}
  function automationLane(index, expectedName) {
    const header = track(index);
    if (state(header).name !== expectedName) fail('VERIFICATION_FAILED', 'The target track name changed.');
    if (checked('Play') || checked('Record')) fail('INVALID_INPUT', 'Stop playback and recording before editing automation.');
    const parameter = one(scan(header, el => scalar(el, 'AXDescription') === 'Automation Parameter'), 'automation parameter');
    if (scalar(parameter.element, 'AXValue') !== 'Volume') fail('INVALID_INPUT', 'Select Volume automation on the target track.');
    const box = bounds(header.element);
    // GarageBand mislabels region lanes while automation is visible. Match the
    // automation lane to the real track header by its vertical bounds instead.
    const lane = one(scan(group('Tracks'), el => scalar(el, 'AXRole') === 'AXButton' && /^Automation track/.test(scalar(el, 'AXHelp') || '')).filter(hit => {
      const y = bounds(hit.element).pos[1]; return y >= box.pos[1] && y < box.pos[1] + box.size[1];
    }), 'automation lane for ' + expectedName);
    return { header: header, lane: lane };
  }
  function automationGeometry(index, name) {
    const target = automationLane(index, name), box = geometry(target.lane);
    const clip = bounds(box.clips[box.clips.length - 1]);
    visible({ x: clip.pos[0] + 10, y: box.pos[1] + 3 }, box.clips);
    visible({ x: clip.pos[0] + 10, y: box.pos[1] + box.size[1] - 3 }, box.clips);
    return { x: clip.pos[0], y: box.pos[1], width: clip.size[0], height: box.size[1] };
  }
  function automationMouse(type, point) {
    // AX/Apple Events may block inside GarageBand's mouse-tracking loop. Check
    // before mouse-down; the short drag/up sequence must not query the UI.
    if (type === $.kCGEventLeftMouseDown) {
      assertTarget();
      if (!process.frontmost()) fail('NOT_FRONTMOST', 'GarageBand lost focus during automation editing.');
    }
    const event = $.CGEventCreateMouseEvent(null, type, point, $.kCGMouseButtonLeft);
    $.CGEventSetFlags(event, 0);
    $.CGEventSetIntegerValueField(event, $.kCGMouseEventClickState, 1);
    $.CGEventPost($.kCGHIDEventTap, event);
  }
  function automationClick(point) {
    automationMouse($.kCGEventLeftMouseDown, point); delay(0.06);
    automationMouse($.kCGEventLeftMouseUp, point); delay(0.18);
  }
  function automationDrag(from, to) {
    automationMouse($.kCGEventLeftMouseDown, from);
    try {
      delay(0.08);
      // Cross the drag threshold first, then return to the one-pixel step.
      automationMouse($.kCGEventLeftMouseDragged, { x: from.x, y: from.y + (to.y > from.y ? 4 : -4) }); delay(0.08);
      automationMouse($.kCGEventLeftMouseDragged, to); delay(0.12);
    }
    finally { automationMouse($.kCGEventLeftMouseUp, to); }
  }
`;

interface LaneGeometry { x: number; y: number; width: number; height: number }

async function captureLane(box: LaneGeometry, file: string): Promise<{ y: number | null; coverage: number }> {
  await exec("screencapture", ["-x", "-R", `${box.x},${box.y},${box.width},${box.height}`, file]);
  const text = await runJXA(`
    ObjC.import('AppKit');
    const image = $.NSBitmapImageRep.imageRepWithContentsOfFile($(${JSON.stringify(file)}));
    if (!image) throw new Error('Cannot read automation screenshot.');
    const width = Number(image.pixelsWide), height = Number(image.pixelsHigh), counts = [];
    for (let y = 0; y < height; y++) {
      let count = 0;
      for (let i = 1; i <= 30; i++) {
        const c = image.colorAtXY(Math.floor(width * i / 31), y);
        const r = Number(c.redComponent), g = Number(c.greenComponent), b = Number(c.blueComponent);
        if (r > 0.6 && g > 0.55 && r - b > 0.18 && g - b > 0.18) count++;
      }
      counts.push(count);
    }
    const max = Math.max.apply(null, counts), rows = [];
    counts.forEach((n, y) => { if (n >= 24 && n === max) rows.push(y); });
    JSON.stringify({ y: rows.length ? (rows.reduce((a, b) => a + b, 0) / rows.length + 0.5) * ${box.height} / height : null, coverage: max / 30 });
  `);
  return JSON.parse(text);
}

/** Experimental visible-lane writer. Rendering is the persistence/shape check. */
export async function writeVolumeAutomation(index: number, name: string, points: AutomationPoint[]) {
  const directory = resolve(dataDirectory(), "automation", randomUUID());
  await ui.ensureReady({ needsProject: true });
  await runAX(`noSheet();
    const signature = one(scan(group('Control Bar'), el => scalar(el, 'AXDescription') === 'Time Signature'), 'time signature');
    if (scalar(signature.element, 'AXValue') !== '4/4') fail('INVALID_INPUT', 'The initial automation writer currently requires 4/4.');
    return true;
  `);
  await setControlToggle("Smart Controls", false);
  await selectTrack(index);
  const shown = await runAX<boolean>(`${TRACK_SCRIPT} return scan(track(${index}), el => scalar(el, 'AXDescription') === 'Automation Parameter').length === 1;`);
  if (!shown) await ui.clickMenu(["Mix", "Show Automation"]);
  await selectTrack(index);
  const args = `${index}, ${JSON.stringify(name)}`;
  const box = await runAX<LaneGeometry>(`${AUTOMATION_SCRIPT} noSheet(); return automationGeometry(${args});`);
  const maxBar = Math.ceil(points[points.length - 1].beat / 4) + 1;
  const positions = [];
  for (const bar of [1, maxBar]) {
    await seekBar(bar);
    positions.push(await runAX<number>(`const hit = one(scan(group('Tracks'), el => scalar(el, 'AXDescription') === 'Playhead thumb'), 'playhead'); const b = bounds(hit.element); return b.pos[0] + b.size[0] / 2;`));
  }
  const pixelsPerBeat = (positions[1] - positions[0]) / ((maxBar - 1) * 4);
  const planned = planAutomation(points, pixelsPerBeat, positions[0], box.x, box.x + box.width);
  await mkdir(directory, { recursive: true });
  const before = await captureLane(box, resolve(directory, "before.png"));
  if (before.coverage > 0.1) throw new GBError("INVALID_INPUT", "The lane already contains a visible automation curve. Use a fresh copy; this writer does not erase existing automation.");
  await setTrackDecibels(index, points[0].db);
  await seekBar(1);
  await runAX(`${AUTOMATION_SCRIPT} noSheet(); const box = automationGeometry(${args}); automationClick({ x: ${planned[0].x + 12}, y: box.y + box.height / 2 }); return true;`);
  const flat = await captureLane(box, resolve(directory, "flat.png"));
  if (flat.y === null || flat.coverage < 0.9) throw new GBError("VERIFICATION_FAILED", "Could not identify the new flat volume curve; inspect the copy before retrying.");
  const snap = await runAppleScript(`tell application "System Events" to tell process "GarageBand" to get value of attribute "AXMenuItemMarkChar" of menu item "Snap to Grid" of menu 1 of menu bar item "Edit" of menu bar 1`);
  const snapEnabled = snap !== "" && snap !== "missing value";
  const applied: Array<{ beat: number; placedBeat: number; requestedDb: number; actualDb: number }> = [];
  await writeFile(resolve(directory, "plan.json"), JSON.stringify({ planned, box, flat, snapEnabled }, null, 2));
  try {
    if (snapEnabled) await ui.clickMenu(["Edit", "Snap to Grid"]);
    for (const point of planned.slice(1)) {
      await runAX(`${AUTOMATION_SCRIPT} noSheet(); const box = automationGeometry(${args});
        if (box.x !== ${box.x} || box.y !== ${box.y} || box.height !== ${box.height}) fail('VERIFICATION_FAILED', 'Automation lane geometry changed.');
        automationClick({ x: ${point.x}, y: box.y + ${flat.y} }); return true;
      `);
    }
    for (const point of planned) {
      const actualDb = Math.abs(point.db - points[0].db) < 0.01 ? points[0].db : await runAX<number>(`${AUTOMATION_SCRIPT}
        noSheet(); const target = automationLane(${args}), box = automationGeometry(${args});
        if (box.x !== ${box.x} || box.y !== ${box.y} || box.height !== ${box.height}) fail('VERIFICATION_FAILED', 'Automation lane geometry changed.');
        const cursor = one(scan(group('Tracks'), el => scalar(el, 'AXDescription') === 'Playhead thumb'), 'playhead');
        const cursorBox = bounds(cursor.element);
        automationClick({ x: ${point.x}, y: cursorBox.pos[1] + cursorBox.size[1] / 2 });
        let y = box.y + ${flat.y}, current = ${points[0].db};
        for (let step = 0; step < 24 && Math.abs(current - ${point.db}) > 0.25; step++) {
          const nextY = y + (current < ${point.db} ? -1 : 1);
          visible({ x: ${point.x}, y: nextY }, geometry(target.lane).clips);
          automationDrag({ x: ${point.x}, y: y }, { x: ${point.x}, y: nextY });
          delay(0.12);
          const db = state(target.header).volumeDb;
          if (db === null || !Number.isFinite(db) || Math.abs(db - ${point.db}) >= Math.abs(current - ${point.db}) && Math.abs(db - ${point.db}) > 0.25) fail('VERIFICATION_FAILED', 'Point at beat ${point.beat}: target ${point.db}, previous ' + current + ', readback ' + db + '; inspect the copy. Evidence: ' + ${JSON.stringify(directory)});
          current = db; y = nextY;
        }
        if (Math.abs(current - ${point.db}) > 0.25) fail('VERIFICATION_FAILED', 'Automation point missed its requested level.');
        return current;
      `);
      applied.push({ beat: point.beat, placedBeat: point.placedBeat, requestedDb: point.db, actualDb });
      await writeFile(resolve(directory, "progress.json"), JSON.stringify(applied, null, 2));
    }
  } finally {
    if (snapEnabled) await ui.clickMenu(["Edit", "Snap to Grid"]);
  }
  await captureLane(box, resolve(directory, "after.png"));
  return { status: "drawn_requires_render_verification", trackIndex: index, trackName: name,
    points: applied, pixelsPerBeat, maximumPlacementErrorBeats: 0.5 / pixelsPerBeat,
    evidenceDirectory: directory,
    limitation: "GarageBand exposes no automation point list. Dragged levels have fader readback; curve timing, unchanged neighbors and persistence must be checked with exported audio and reopening the project. Do not retry blindly." };
}
