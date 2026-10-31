export interface TrackToggleRequest {
  index: number;
  name: string;
  solo?: boolean;
  mute?: boolean;
}

/** Enabling Solo/Mute can clear its peer. Snapshot and set that peer first. */
export function trackTogglePlan(tracks: TrackToggleRequest[]) {
  if (new Set(tracks.map(track => track.index)).size !== tracks.length) throw new Error("Duplicate track in an export variant.");
  return tracks.flatMap(track => {
    if (track.solo === true && track.mute === true) throw new Error("An export track cannot request both Solo and Mute enabled.");
    const values = { mute: track.mute ?? (track.solo === true ? false : undefined),
      solo: track.solo ?? (track.mute === true ? false : undefined) };
    return (["mute", "solo"] as const).flatMap(field => {
      const value = values[field];
      return value === undefined ? [] : [{ key: `${track.index}:${field}`, index: track.index, name: track.name, field, value }];
    }).sort((a, b) => Number(a.value) - Number(b.value));
  });
}
