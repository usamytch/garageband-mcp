import { lstat, mkdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { GBError } from "./errors.js";

export const FORMAT_EXT = { aac: ".m4a", mp3: ".mp3", aiff: ".aif", wav: ".wav" };

export async function prepareExport(directory: string, filename: string, format: keyof typeof FORMAT_EXT): Promise<string> {
  if (!filename || filename !== basename(filename) || /[\/\\:\x00]/.test(filename) || filename === "." || filename === "..") {
    throw new GBError("INVALID_INPUT", "Use a filename without directory separators, a colon, or a null byte.");
  }
  if (!isAbsolute(directory)) throw new GBError("INVALID_INPUT", "Export directory must be absolute.");
  const target = join(directory, filename + FORMAT_EXT[format]);
  if (await lstat(target).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; })) {
    throw new GBError("INVALID_INPUT", `Export target already exists: ${target}. Choose a new filename.`);
  }
  await mkdir(directory, { recursive: true });
  return target;
}

export async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The caller must first reject existing targets; size stability alone is not freshness. */
export async function waitForFile(
  path: string,
  timeoutMs: number,
  io = { size: fileSize, now: Date.now, wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) },
): Promise<number | null> {
  const deadline = io.now() + timeoutMs;
  let last: number | null = null;
  while (io.now() < deadline) {
    const size = await io.size(path);
    if (size !== null && size > 0 && size === last) return size;
    last = size;
    await io.wait(Math.min(1500, Math.max(0, deadline - io.now())));
  }
  return null;
}
