import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import type { AudioInfo } from "./audio-file.js";
import { rangeFilter } from "./audio-file.js";
import { writeJournal } from "./journal.js";
import { GBError } from "./errors.js";
import { acquireGuiLock } from "./gui-queue.js";

export const exportVariantSchema = z.object({
  filename: z.string().min(1), normalize: z.boolean().optional(),
  tracks: z.array(z.object({ index: z.number().int().min(1), name: z.string().min(1), solo: z.boolean().optional(), mute: z.boolean().optional() }).strict()).max(128).default([]),
  range: z.object({ startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive(), exportOriginSeconds: z.number().finite().nonnegative(), fadeOutSeconds: z.number().finite().nonnegative().optional() }).strict().optional(),
}).strict();
export const exportRequestSchema = z.object({
  projectPath: z.string().min(1), directory: z.string().min(1),
  jobs: z.array(exportVariantSchema).min(1).max(16),
}).strict();
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export interface ExportSetting {
  key: string; index?: number; name?: string; field: "solo" | "mute" | "normalize";
  before: boolean; desired: boolean; attempted: boolean; restored: boolean;
}
export interface ExportItem {
  phase: "pending" | "prepared" | "rendering" | "rendered" | "restoring" | "finalizing" | "publishing" | "completed";
  settings: ExportSetting[];
  source: string; candidate: string; staging: string; target: string;
  sourceHash?: string; candidateHash?: string; audio?: AudioInfo;
}
export interface ExportJob {
  version: 1; id: string; requestHash: string; request: ExportRequest;
  status: "queued" | "running" | "needs_review" | "completed" | "abandoned";
  createdAt: string; updatedAt: string; items: ExportItem[]; error?: string;
}

export function requestedSettings(variant: ExportRequest["jobs"][number]): ExportSetting[] {
  const settings: ExportSetting[] = [];
  for (const track of variant.tracks) for (const field of ["solo", "mute"] as const) {
    const desired = track[field];
    if (desired !== undefined) settings.push({ key: `${track.index}:${field}`, index: track.index, name: track.name, field, desired, before: false, attempted: false, restored: false });
  }
  if (variant.normalize !== undefined) settings.push({ key: "Auto Normalize", field: "normalize", desired: variant.normalize, before: false, attempted: false, restored: false });
  return settings;
}

const settingSchema = z.object({
  key: z.string(), index: z.number().int().positive().optional(), name: z.string().optional(),
  field: z.enum(["solo", "mute", "normalize"]), before: z.boolean(), desired: z.boolean(), attempted: z.boolean(), restored: z.boolean(),
}).strict();
const itemSchema = z.object({
  phase: z.enum(["pending", "prepared", "rendering", "rendered", "restoring", "finalizing", "publishing", "completed"]),
  settings: z.array(settingSchema), source: z.string(), candidate: z.string(), staging: z.string(), target: z.string(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), candidateHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  audio: z.object({ duration: z.number().finite().positive(), sampleRate: z.number().int().positive(), channels: z.number().int().positive(), codec: z.string(), bytes: z.number().int().positive() }).strict().optional(),
}).strict();
const jobSchema = z.object({
  version: z.literal(1), id: z.string(), requestHash: z.string(), request: exportRequestSchema,
  status: z.enum(["queued", "running", "needs_review", "completed", "abandoned"]),
  createdAt: z.string(), updatedAt: z.string(), items: z.array(itemSchema), error: z.string().optional(),
}).strict();

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function hashText(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export function jobDirectory(root: string, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new GBError("INVALID_INPUT", "Invalid export job ID.");
  return join(root, id);
}

/** Resolve existing ancestors before creating anything; aliases cannot enter a .band. */
export async function outputDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new GBError("INVALID_INPUT", "Output directory must be absolute.");
  let current = resolve(path);
  const suffix: string[] = [];
  while (!(await lstat(current).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; }))) {
    suffix.unshift(basename(current)); current = dirname(current);
  }
  const canonical = join(await realpath(current), ...suffix);
  if (canonical.split("/").some(part => /\.(band|logicx)$/i.test(part))) throw new GBError("INVALID_INPUT", "Output must be outside DAW project packages.");
  return canonical;
}

export function validateRequest(value: unknown): ExportRequest {
  const request = exportRequestSchema.parse(value);
  if (!isAbsolute(request.projectPath) || !/\.band$/i.test(request.projectPath) || !isAbsolute(request.directory)) throw new GBError("INVALID_INPUT", "Expected absolute project and output paths.");
  const names = new Set<string>();
  for (const variant of request.jobs) {
    if (variant.filename !== basename(variant.filename) || /[\\/:\x00]/.test(variant.filename) || [".", ".."].includes(variant.filename)) throw new GBError("INVALID_INPUT", "Use plain export filenames.");
    const name = variant.filename.normalize("NFC").toLowerCase();
    if (name.startsWith(".gb-")) throw new GBError("INVALID_INPUT", "The .gb- prefix is reserved for export publication files.");
    if (names.has(name)) throw new GBError("INVALID_INPUT", "Export filenames must be unique, including case and Unicode normalization.");
    names.add(name);
    if (new Set(variant.tracks.map(t => t.index)).size !== variant.tracks.length) throw new GBError("INVALID_INPUT", "Duplicate track in an export variant.");
    if (variant.range) rangeFilter(variant.range, Number.MAX_VALUE);
  }
  return request;
}

export async function saveExportJob(root: string, job: ExportJob): Promise<void> {
  job.updatedAt = new Date().toISOString();
  await writeJournal(join(jobDirectory(root, job.id), "job.json"), job);
}

export async function loadExportJob(root: string, id: string): Promise<ExportJob> {
  await outputDirectory(root);
  const path = join(jobDirectory(root, id), "job.json");
  const bytes = await readFile(path);
  if (bytes.length > 4 * 1024 * 1024) throw new Error("Export journal exceeds limit");
  const job = jobSchema.parse(JSON.parse(bytes.toString()));
  const request = validateRequest(job.request);
  if (job.version !== 1 || job.id !== id || job.requestHash !== hashText(stableJson(request)) || job.items.length !== request.jobs.length) throw new Error("Invalid export journal identity");
  for (const [i, item] of job.items.entries()) {
    const folder = jobDirectory(root, id);
    if (item.source !== join(folder, `source-${i}.wav`) || item.candidate !== join(folder, `candidate-${i}.wav`) ||
        item.target !== join(request.directory, request.jobs[i].filename + ".wav") || item.staging !== join(request.directory, `.gb-${id}-${i}.wav`)) throw new Error("Invalid export journal paths");
    const expected = item.phase === "pending" ? [] : requestedSettings(request.jobs[i]);
    if (item.settings.length !== expected.length || item.settings.some((setting, j) => {
      const wanted = expected[j];
      return setting.key !== wanted.key || setting.index !== wanted.index || setting.name !== wanted.name ||
        setting.field !== wanted.field || setting.desired !== wanted.desired || (setting.restored && !setting.attempted);
    })) throw new Error("Invalid export journal settings");
    if (["rendered", "restoring", "finalizing", "publishing", "completed"].includes(item.phase) && !item.sourceHash) throw new Error("Missing rendered source identity");
    if (["finalizing", "publishing", "completed"].includes(item.phase) && item.settings.some(s => s.attempted && !s.restored)) throw new Error("Unrestored mixer in finalized journal");
    if (["publishing", "completed"].includes(item.phase) && (!item.candidateHash || !item.audio)) throw new Error("Missing candidate identity");
  }
  if (job.status === "completed" && job.items.some(item => item.phase !== "completed")) throw new Error("Incomplete journal marked completed");
  return job;
}

export async function createExportJob(root: string, value: unknown, key: string): Promise<{ job: ExportJob; created: boolean }> {
  await outputDirectory(root);
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(key)) throw new GBError("INVALID_INPUT", "Use a 1–128 character idempotency key containing letters, digits, dots, underscores or hyphens.");
  const request = validateRequest(value);
  request.directory = await outputDirectory(request.directory);
  const id = hashText(request.projectPath + "\n" + key);
  const folder = jobDirectory(root, id);
  const requestHash = hashText(stableJson(request));
  await mkdir(root, { recursive: true });
  const release = await acquireGuiLock(join(root, id + ".init.lock"));
  try {
    try { await mkdir(folder); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const job = await loadExportJob(root, id);
      if (job.requestHash !== requestHash) throw new GBError("INVALID_INPUT", "This idempotency key already belongs to a different export plan.");
      return { job, created: false };
    }
    const job: ExportJob = { version: 1, id, requestHash, request, status: "queued", createdAt: new Date().toISOString(), updatedAt: "",
      items: request.jobs.map((variant, i) => ({ phase: "pending", settings: [], source: join(folder, `source-${i}.wav`),
        candidate: join(folder, `candidate-${i}.wav`), target: join(request.directory, variant.filename + ".wav"), staging: join(request.directory, `.gb-${id}-${i}.wav`) })) };
    await saveExportJob(root, job);
    return { job, created: true };
  } finally { await release(); }
}
