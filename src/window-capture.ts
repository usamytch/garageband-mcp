import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { runAX } from "./native-ax.js";
import { dataDirectory } from "./runtime-paths.js";
import { GBError } from "./errors.js";

interface Bounds { X: number; Y: number; Width: number; Height: number }
export interface CaptureWindow { kCGWindowNumber: number; kCGWindowOwnerPID: number; kCGWindowLayer: number; kCGWindowBounds: Bounds }

export function chooseCaptureWindow(pid: number, bounds: Bounds, windows: CaptureWindow[]): number {
  const matches = windows.filter(win => win.kCGWindowOwnerPID === pid && win.kCGWindowLayer === 0 &&
    (Object.keys(bounds) as Array<keyof Bounds>).every(key => Math.abs(win.kCGWindowBounds[key] - bounds[key]) <= 2));
  if (matches.length !== 1 || !Number.isInteger(matches[0].kCGWindowNumber)) {
    throw new GBError("VERIFICATION_FAILED", "Cannot identify one GarageBand-owned window for capture.");
  }
  return matches[0].kCGWindowNumber;
}

async function captureTarget(): Promise<{ id: number; pid: number; title: string }> {
  const state = await runAX<{ pid: number; title: string; bounds: Bounds; windows: CaptureWindow[] }>(`
    const box = bounds(window.element);
    const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, $.kCGNullWindowID)));
    return { pid: process.unixId(), title: scalar(window.element, 'AXTitle'),
      bounds: { X: box.pos[0], Y: box.pos[1], Width: box.size[0], Height: box.size[1] }, windows: all };
  `);
  return { id: chooseCaptureWindow(state.pid, state.bounds, state.windows), pid: state.pid, title: state.title };
}

export async function captureGarageBandWindow(savePath?: string): Promise<{ data: Buffer; title: string; windowId: number }> {
  if (savePath && !isAbsolute(savePath)) throw new GBError("INVALID_INPUT", "Screenshot destination must be absolute.");
  const folder = join(dataDirectory(), "captures", randomUUID());
  await mkdir(folder, { recursive: true });
  const path = join(folder, "window.png");
  const exec = promisify(execFile);
  try {
    const before = await captureTarget();
    await exec("screencapture", ["-x", "-o", "-l", String(before.id), path], { timeout: 10000 });
    const after = await captureTarget();
    if (after.id !== before.id || after.pid !== before.pid || after.title !== before.title) {
      throw new GBError("VERIFICATION_FAILED", "Window identity changed during capture; image discarded.");
    }
    const full = await readFile(path);
    if (full.length < 100 || full.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new GBError("VERIFICATION_FAILED", "Window capture is unavailable; check Screen Recording permission.");
    if (savePath) await copyFile(path, savePath, constants.COPYFILE_EXCL);
    await exec("sips", ["-Z", "1200", path], { timeout: 10000 });
    return { data: await readFile(path), title: before.title, windowId: before.id };
  } finally { await rm(folder, { recursive: true, force: true }); }
}
