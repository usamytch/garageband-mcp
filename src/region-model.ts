import { createHash } from "node:crypto";
import { GBError } from "./errors.js";

export interface RegionState {
  id: string;
  trackIndex: number;
  index: number;
  name: string;
  kind: "midi" | "audio" | "unsupported";
  startBar: number | null;
  endBar: number | null;
  selected: boolean;
  help: string;
}

export interface RegionTrack {
  index: number;
  name: string;
  audio: boolean | null;
  regions: RegionState[];
}

/** Fail closed on beat/tick positions or localization that has not been verified. */
export function parseRegion(help: string): Pick<RegionState, "kind" | "startBar" | "endBar"> {
  const kind = /, MIDI region\./.test(help) ? "midi" : /, Audio region\./i.test(help) ? "audio" : "unsupported";
  const match = /^Region starts at (\d+) bars?\s+and ends at (\d+) bars?\s*,/.exec(help);
  const startBar = match ? Number(match[1]) : null;
  const endBar = match ? Number(match[2]) : null;
  return startBar !== null && endBar !== null && startBar >= 1 && endBar > startBar
    ? { kind, startBar, endBar } : { kind, startBar: null, endBar: null };
}

export function regionId(project: string, region: Omit<RegionState, "id">): string {
  return createHash("sha256").update(JSON.stringify([project, region.trackIndex, region.index, region.name, region.help])).digest("hex").slice(0, 20);
}

export function planMove(tracks: RegionTrack[], id: string, toBar: number, targetTrackIndex?: number) {
  if (!Number.isInteger(toBar) || toBar < 1 || toBar > 9999) throw new GBError("INVALID_INPUT", "Destination bar must be an integer from 1 to 9999.");
  const matches = tracks.flatMap((track) => track.regions).filter((region) => region.id === id);
  if (matches.length !== 1) throw new GBError("INVALID_INPUT", "Region ID is stale or ambiguous. Read gb_list_regions again.");
  const region = matches[0];
  if (region.kind === "unsupported" || region.startBar === null || region.endBar === null) {
    throw new GBError("INVALID_INPUT", "Only audio/MIDI regions with whole-bar start and end positions are currently supported.");
  }
  const destination = tracks.find((track) => track.index === (targetTrackIndex ?? region.trackIndex));
  if (!destination) throw new GBError("INVALID_INPUT", "Destination track does not exist.");
  const others = destination.regions.filter((other) => other.id !== id);
  if ((destination.audio === true && region.kind !== "audio") || (destination.audio === false && region.kind !== "midi") || others.some((other) => other.kind !== region.kind)) {
    throw new GBError("INVALID_INPUT", "Destination track is incompatible with the region type.");
  }
  const endBar = toBar + region.endBar - region.startBar;
  if (others.some((other) => other.startBar === null || other.endBar === null || (toBar < other.endBar && endBar > other.startBar))) {
    throw new GBError("INVALID_INPUT", "Destination overlaps another region, or its boundaries cannot be verified. No move performed.");
  }
  return { region, targetTrackIndex: destination.index, startBar: toBar, endBar, unchanged: destination.index === region.trackIndex && toBar === region.startBar };
}

export function verifyMove(before: RegionTrack[], after: RegionTrack[], plan: ReturnType<typeof planMove>): RegionState {
  const signature = (region: RegionState) => JSON.stringify([region.trackIndex, region.name, region.kind, region.startBar, region.endBar, region.startBar === null ? region.help : null]);
  const expected = before.flatMap((track) => track.regions).map((region) => signature(region.id === plan.region.id
    ? { ...region, trackIndex: plan.targetTrackIndex, startBar: plan.startBar, endBar: plan.endBar } : region)).sort();
  const actual = after.flatMap((track) => track.regions).map(signature).sort();
  if (JSON.stringify(before.map((track) => [track.index, track.name])) !== JSON.stringify(after.map((track) => [track.index, track.name])) || JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new GBError("VERIFICATION_FAILED", "Region move did not match the requested arrangement. Inspect gb_list_regions before any further edit; the project may have changed.");
  }
  const moved = after.flatMap((track) => track.regions).filter((region) => region.trackIndex === plan.targetTrackIndex && region.name === plan.region.name && region.startBar === plan.startBar && region.endBar === plan.endBar);
  if (moved.length !== 1) throw new GBError("VERIFICATION_FAILED", "Moved region could not be identified uniquely.");
  return moved[0];
}

export function verifySelection(before: RegionTrack[], selected: RegionTrack[], id: string): void {
  const selection = selected.flatMap((track) => track.regions).filter((region) => region.selected);
  if (selection.length !== 1 || selection[0].id !== id) {
    throw new GBError("VERIFICATION_FAILED", "Could not select exactly the requested region. No drag performed.");
  }
  const original = before.flatMap((track) => track.regions).find((region) => region.id === id);
  if (!original || original.startBar === null) throw new GBError("INVALID_INPUT", "Region is no longer available.");
  verifyMove(before, selected, planMove(before, id, original.startBar));
}
