import { basename, extname } from "node:path";
import { GBError } from "./errors.js";

export interface ImportSnapshot {
  projectPath: string;
  tracks: Array<{ index: number; name: string; regions: Array<{ name: string; help: string; kind: string }> }>;
}

export function verifyAudioImport(before: ImportSnapshot, after: ImportSnapshot, trackIndex: number, trackName: string, path: string) {
  if (before.projectPath !== after.projectPath || before.tracks.length !== after.tracks.length) throw new GBError("VERIFICATION_FAILED", "Import changed the project or track count.");
  const previous = before.tracks.find(t => t.index === trackIndex);
  const target = after.tracks.find(t => t.index === trackIndex);
  if (!previous || previous.name !== trackName || previous.regions.length || !target || target.name !== trackName || target.regions.length !== 1) {
    throw new GBError("VERIFICATION_FAILED", "Import requires the same named empty track and exactly one resulting region.");
  }
  for (const old of before.tracks) {
    const current = after.tracks.find(t => t.index === old.index);
    if (!current || current.name !== old.name || old.index !== trackIndex && JSON.stringify(current.regions.map(r => [r.name, r.help, r.kind])) !== JSON.stringify(old.regions.map(r => [r.name, r.help, r.kind]))) {
      throw new GBError("VERIFICATION_FAILED", "Import changed a neighboring track or region.");
    }
  }
  const region = target.regions[0];
  const name = region.name.replace(/, muted$/, ""), expected = basename(path, extname(path));
  if (region.kind !== "audio" || name !== expected && !name.startsWith(expected + "_") || !/^Region starts at 1 bar\s+and ends at/.test(region.help)) {
    throw new GBError("VERIFICATION_FAILED", "Imported audio identity or start at bar 1 could not be verified.");
  }
  return region;
}
