import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import { validateAudioFile, verifyWaveContainer } from "./audio-file.js";
import { verifyAudioImport } from "./audio-import-model.js";
import { readRegions, REGION_SCRIPT } from "./region-state.js";
import { runAX } from "./native-ax.js";
import { dataDirectory } from "./runtime-paths.js";
import { GBError } from "./errors.js";
import { writeJournal, recordFailure } from "./journal.js";
import { withCleanup } from "./cleanup.js";

export async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function importAudio(path: string, expectedSha256: string, trackIndex: number, trackName: string) {
  if (!isAbsolute(path) || !/\.wav$/i.test(path)) throw new GBError("INVALID_INPUT", "Import requires an absolute WAV path.");
  path = await realpath(path);
  const audio = await validateAudioFile(path);
  const sourceAudio = await verifyWaveContainer(path);
  if (await fileHash(path) !== expectedSha256) throw new GBError("INVALID_INPUT", "Source SHA-256 differs; no import performed.");
  const before = await readRegions();
  const target = before.tracks.find(t => t.index === trackIndex);
  if (!target || target.name !== trackName || target.regions.length || target.audio === false) throw new GBError("INVALID_INPUT", "Select the named empty audio track before import.");
  const folder = join(dataDirectory(), "imports", randomUUID());
  await mkdir(folder, { recursive: true });
  const manifestPath = join(folder, "manifest.json");
  const record = { source: path, sourceSha256: expectedSha256, sourceAudio, audio, trackIndex, trackName, before };
  await writeJournal(manifestPath, { ...record, status: "pending" });
  try {
    await runAX(`${REGION_SCRIPT}
      const params = ${JSON.stringify({ path, file: basename(path), trackIndex, trackName })};
      noSheet(); stopped();
      const h = showTrack(params.trackIndex);
      if (state(h).name !== params.trackName) fail('VERIFICATION_FAILED', 'Destination track changed');
      const scroll = one(scan(window, el => scalar(el, 'AXRole') === 'AXScrollBar' && scalar(el, 'AXOrientation') === 'AXHorizontalOrientation' && bounds(el).size[0] > 500), 'timeline scroll');
      if ($.AXUIElementSetAttributeValue(scroll.element, $('AXValue'), $(0)) !== 0) fail('VERIFICATION_FAILED', 'Cannot scroll to bar 1');
      delay(.2);
      if (Number(scalar(scroll.element, 'AXValue')) !== 0) fail('VERIFICATION_FAILED', 'Timeline origin not visible');
      const lane = one(lanes().filter(hit => hit.index === params.trackIndex), 'destination lane');
      if (regionHits(lane).length) fail('INVALID_INPUT', 'Destination is not empty');
      const destination = geometry(lane);
      const to = { x: destination.pos[0] + 12, y: destination.pos[1] + destination.size[1] / 2 };
      try { visible(to, destination.clips); } catch (error) { fail('VERIFICATION_FAILED', 'Destination lane is not visible: ' + String(error)); }
      const finder = Application('Finder');
      finder.reveal(Path(params.path)); finder.activate(); delay(.5);
      const fw = finder.finderWindows[0], oldBounds = fw.bounds();
      const covered = finder.finderWindows().filter(w => w.id() !== fw.id() && !w.collapsed());
      const withCleanup = ${withCleanup.toString()};
      withCleanup(() => {
        for (const w of covered) w.collapsed = true;
        fw.bounds = { x: Math.round(to.x + 80), y: 150, width: 630, height: 400 }; delay(.3);
        finder.reveal(Path(params.path)); delay(.2);
        const fp = Application('System Events').processes['Finder'];
        if (!fp.frontmost()) fail('NOT_FRONTMOST', 'Finder is not frontmost');
        const fa = $.AXUIElementCreateApplication(fp.unixId());
        const win = attr(fa, 'AXWindows').objectAtIndex(0);
        const box = bounds(win);
        if (to.x >= box.pos[0] && to.x < box.pos[0] + box.size[0] && to.y >= box.pos[1] && to.y < box.pos[1] + box.size[1]) fail('VERIFICATION_FAILED', 'Finder covers the destination');
        const file = one(scan({ element: win, path: [] }, el => scalar(el, 'AXRole') === 'AXTextField' && scalar(el, 'AXValue') === params.file), 'source file');
        const source = bounds(file.element);
        const from = { x: source.pos[0] + 20, y: source.pos[1] + source.size[1] / 2 };
        const clips = [win]; let parent = win;
        for (const index of file.path) { parent = children(parent)[index]; if (scalar(parent, 'AXRole') === 'AXScrollArea') clips.push(parent); }
        try { visible(from, clips); } catch (error) { fail('VERIFICATION_FAILED', 'Source file is not visible in Finder: ' + JSON.stringify({ source: source, point: from, clips: clips.map(bounds) })); }
        const selection = finder.selection().map(item => decodeURIComponent(item.url()).replace(/^file:\\/\\//, ''));
        if (selection.length !== 1 || selection[0] !== params.path) fail('VERIFICATION_FAILED', 'Finder selection does not match source');
        assertTarget();
        function mouse(type, point) {
          const event = $.CGEventCreateMouseEvent(null, type, point, $.kCGMouseButtonLeft);
          $.CGEventSetFlags(event, 0); $.CGEventSetIntegerValueField(event, $.kCGMouseEventClickState, 1); $.CGEventPost($.kCGHIDEventTap, event);
        }
        let last = from;
        mouse($.kCGEventLeftMouseDown, from);
        try {
          delay(.2);
          for (let i = 1; i <= 24; i++) { last = { x: from.x + (to.x - from.x) * i / 24, y: from.y + (to.y - from.y) * i / 24 }; mouse($.kCGEventLeftMouseDragged, last); delay(.025); }
          delay(1);
        } finally { mouse($.kCGEventLeftMouseUp, last); }
        delay(1.2);
      }, [() => { fw.bounds = oldBounds; }, ...covered.map(w => () => { w.collapsed = false; }),
        () => { Application('GarageBand').activate(); delay(.2); }]);
      return true;
    `);
    const after = await readRegions();
    const region = verifyAudioImport(before, after, trackIndex, trackName, path);
    if (await fileHash(path) !== expectedSha256) throw new GBError("VERIFICATION_FAILED", "Source changed during import.");
    const media = join(before.projectPath, "Media", "Audio Files");
    const copies = [];
    for (const file of await readdir(media, { withFileTypes: true })) {
      if (file.isFile() && /\.wav$/i.test(file.name) && basename(file.name, extname(file.name)) === region.name.replace(/, muted$/, "")) {
        const copy = join(media, file.name);
        if (JSON.stringify(await verifyWaveContainer(copy)) === JSON.stringify(sourceAudio)) copies.push(copy);
      }
    }
    if (!copies.length) throw new GBError("VERIFICATION_FAILED", "No project media copy with identical WAV format and audio samples found; inspect import before saving.");
    const result = { ...record, after, region, projectMedia: copies, status: "verified-in-memory", persistenceVerified: false };
    await writeJournal(manifestPath, result);
    return { manifestPath, region, projectMedia: copies, sourceUnchanged: true, persistenceVerified: false,
      next: "Save and reopen only when authorized; verify region layout and a control export against the source. This import does not save the project." };
  } catch (error) {
    const failure = await recordFailure(error, () => writeJournal(manifestPath, { ...record, status: "failed-inspect-before-retry", error: String(error) }));
    throw new GBError("VERIFICATION_FAILED", `${failure} Import journal: ${manifestPath}. Inspect partial state; do not retry blindly.`);
  }
}
