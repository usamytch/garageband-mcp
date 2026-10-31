import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { exportSong } from "./export.js";
import { prepareExport } from "../export-file.js";
import { renderExportRange, rangeFilter } from "../audio-file.js";
import { readTracks, setTrackToggle } from "../track-state.js";
import { withTemporarySettings, type TemporarySetting } from "../settings-transaction.js";
import { dataDirectory } from "../runtime-paths.js";
import { GBError, guarded, ok } from "../errors.js";
import { writeJournal, recordFailure } from "../journal.js";
import { trackTogglePlan } from "../track-toggle-plan.js";

export function registerBatchExportTools(server: McpServer): void {
  server.registerTool("gb_export_batch", {
    title: "Export WAV variants with restored mixer state",
    description: "Export variants in one guarded operation. Requested solo/mute states and their coupled controls are snapshotted and restored, including on failure. Optional project ranges require independently verified exportOriginSeconds; full-song bounces may not begin at project zero. Saves a recovery journal, never saves the project.",
    inputSchema: {
      directory: z.string(),
      jobs: z.array(z.object({
        filename: z.string().min(1), normalize: z.boolean().optional(),
        tracks: z.array(z.object({ index: z.number().int().min(1), name: z.string(), solo: z.boolean().optional(), mute: z.boolean().optional() })).max(128).default([]),
        range: z.object({ startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(), exportOriginSeconds: z.number().nonnegative(), fadeOutSeconds: z.number().nonnegative().optional() }).optional(),
      })).min(1).max(16),
    },
  }, async ({ directory, jobs }) => guarded(async () => {
    if (new Set(jobs.map(job => job.filename)).size !== jobs.length) throw new GBError("INVALID_INPUT", "Batch filenames must be unique.");
    const plans = jobs.map(job => trackTogglePlan(job.tracks));
    for (const job of jobs) if (job.range) rangeFilter(job.range, Number.MAX_VALUE);
    const targets = await Promise.all(jobs.map(job => prepareExport(directory, job.filename, "wav")));
    const folder = join(dataDirectory(), "exports", randomUUID());
    await mkdir(folder, { recursive: true });
    const journal: unknown[] = [];
    const journalPath = join(folder, "journal.json");
    const record = async (event: unknown) => { journal.push(event); await writeJournal(journalPath, journal); };
    const results = [];
    try {
      for (const [i, job] of jobs.entries()) {
        const settings: TemporarySetting[] = [];
        for (const track of plans[i]) {
          const { field, value } = track;
          const read = async () => {
            const current = (await readTracks()).find(t => t.index === track.index);
            if (!current || current.name !== track.name) throw new GBError("VERIFICATION_FAILED", "Batch track identity changed.");
            return current[field];
          };
          settings.push({ key: `${track.index}:${field}`, value, read,
            write: async value => { await read(); return setTrackToggle(track.index, field === "solo" ? "Solo" : "Mute", value); },
          });
        }
        await record({ job: job.filename, target: targets[i], range: job.range });
        const result = await withTemporarySettings(settings, async () => {
          const full = await exportSong({ filename: job.range ? `full-${i + 1}` : job.filename, directory: job.range ? folder : directory, format: "wav", normalize: job.normalize, record });
          return job.range ? { path: targets[i], audio: await renderExportRange(full.path, targets[i], job.range), fullSource: full.path } : full;
        }, record);
        results.push(result);
        await record({ completed: result });
      }
      return ok(JSON.stringify({ results, journalPath, mixerRestored: true }));
    } catch (error) {
      const failure = await recordFailure(error, () => record({ failure: String(error) }));
      throw new GBError("VERIFICATION_FAILED", `${failure} Recovery journal: ${journalPath}. Completed exports are retained; inspect before retrying.`);
    }
  }));
}
