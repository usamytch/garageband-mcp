import { GBError } from "./errors.js";

export interface AutomationPoint { beat: number; db: number }

export function planAutomation(points: AutomationPoint[], pixelsPerBeat: number, originX: number, left: number, right: number) {
  if (points.length < 2 || points.length > 64 || points[0].beat !== 0 || !Number.isFinite(pixelsPerBeat) || pixelsPerBeat <= 0) {
    throw new GBError("INVALID_INPUT", "Use 2–64 ordered points starting at beat 0 and a measured timeline scale.");
  }
  const base = points[0].db;
  const result = points.map((point, index) => {
    if (!Number.isFinite(point.beat) || !Number.isFinite(point.db) || point.beat < 0 || point.db < -20 || point.db > 0 || Math.abs(point.db - base) > 3) {
      throw new GBError("INVALID_INPUT", "This first automation writer supports finite volume points from -20 to 0 dB, within 3 dB of the initial level.");
    }
    const x = Math.round(originX + point.beat * pixelsPerBeat);
    if (x < left + 3 || x > right - 3) throw new GBError("INVALID_INPUT", "All automation points must fit in the visible timeline before editing.");
    if (index && (point.beat <= points[index - 1].beat || (point.beat - points[index - 1].beat) * pixelsPerBeat < 6)) {
      throw new GBError("INVALID_INPUT", "Automation points need increasing times and at least 6 screen pixels of separation. Zoom in or use fewer points.");
    }
    return { ...point, x, placedBeat: (x - originX) / pixelsPerBeat };
  });
  return result;
}
