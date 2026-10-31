import { copyFile, link, lstat, mkdir, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import type { AudioInfo, ExportRange } from "./audio-file.js";
import { loadExportJob, outputDirectory, requestedSettings, saveExportJob, type ExportJob, type ExportSetting } from "./export-job.js";

export interface ExportDriver {
  prepare(): Promise<void>;
  read(setting: ExportSetting): Promise<boolean>;
  write(setting: ExportSetting, value: boolean): Promise<void>;
  idle(): Promise<boolean>;
  render(path: string): Promise<void>;
  finish(source: string, candidate: string, range?: ExportRange): Promise<void>;
  verify(path: string, duration?: number): Promise<{ audio: AudioInfo; sha256: string }>;
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
}

/** The caller holds both the job lock and the global GUI lock through recovery. */
export async function executeExportJob(root: string, id: string, driver: ExportDriver, restoreOnly = false): Promise<ExportJob> {
  const job = await loadExportJob(root, id);
  const persist = () => saveExportJob(root, job);
  let prepared = false;
  const prepare = async () => {
    if (!prepared) { await driver.prepare(); prepared = true; }
  };
  const restore = async (settings: ExportSetting[]) => {
    if (!await driver.idle()) throw new Error("GarageBand is still busy; settings have not been restored. Inspect and resume this job.");
    if (!settings.some(setting => setting.attempted && !setting.restored)) return;
    await prepare();
    const errors: string[] = [];
    for (const setting of [...settings].reverse()) {
      if (!setting.attempted || setting.restored) continue;
      try {
        if (await driver.read(setting) !== setting.before) await driver.write(setting, setting.before);
        if (await driver.read(setting) !== setting.before) throw new Error(`Restore readback failed: ${setting.key}`);
        setting.restored = true; await persist();
      } catch (error) { errors.push(String(error)); }
    }
    if (errors.length) throw new Error(errors.join("; "));
  };
  try {
    if (job.status === "abandoned") return job;
    if (restoreOnly) {
      for (const item of job.items) await restore(item.settings);
      job.status = "abandoned"; delete job.error; await persist(); return job;
    }
    job.status = "running"; delete job.error; await persist();
    for (const [index, item] of job.items.entries()) {
      const variant = job.request.jobs[index];
      const expectedDuration = variant.range ? variant.range.endSeconds - variant.range.startSeconds : undefined;
      if (item.phase === "completed") {
        if ((await driver.verify(item.target, expectedDuration)).sha256 !== item.candidateHash) throw new Error("Completed export changed; no overwrite or re-render attempted.");
        if (await exists(item.staging)) {
          const [staging, target] = await Promise.all([lstat(item.staging), lstat(item.target)]);
          if (!staging.isFile() || staging.ino !== target.ino || staging.dev !== target.dev) throw new Error("Unexpected staging file after completion; retained for inspection.");
          await rm(item.staging);
        }
        continue;
      }
      if (item.phase === "pending") {
        if (await outputDirectory(job.request.directory) !== job.request.directory) throw new Error("Output directory changed since planning.");
        if (await exists(item.target) || await exists(item.source) || await exists(item.candidate) || await exists(item.staging)) throw new Error("An export target already exists; no file was overwritten.");
        const settings = requestedSettings(variant);
        await prepare();
        for (const setting of settings) setting.before = await driver.read(setting);
        item.settings = settings; item.phase = "prepared"; await persist();
      }
      if (item.phase === "prepared") {
        await prepare();
        for (const setting of item.settings) {
          const current = await driver.read(setting);
          if ((!setting.attempted || setting.restored) && current !== setting.before) throw new Error(`Mixer changed since snapshot: ${setting.key}`);
          if (setting.before === setting.desired) continue;
          setting.attempted = true; setting.restored = false; await persist();
          await driver.write(setting, setting.desired);
          if (await driver.read(setting) !== setting.desired) throw new Error(`Apply readback failed: ${setting.key}`);
        }
        // Persist ambiguity BEFORE submission. A crash here must never trigger a blind second render.
        item.phase = "rendering"; await persist();
        await driver.render(item.source);
      }
      if (item.phase === "rendering") {
        if (!await driver.idle()) throw new Error("Export may still be rendering; resume later without resubmitting.");
        const rendered = await driver.verify(item.source);
        item.sourceHash = rendered.sha256; item.phase = "rendered"; await persist();
      }
      if (item.phase === "rendered" || item.phase === "restoring") {
        item.phase = "restoring"; await persist();
        await restore(item.settings);
        item.phase = "finalizing"; await persist();
      }
      if (item.phase === "finalizing") {
        if ((await driver.verify(item.source)).sha256 !== item.sourceHash) throw new Error("Rendered source changed before finalization.");
        if (!await exists(item.candidate)) await driver.finish(item.source, item.candidate, variant.range);
        const verified = await driver.verify(item.candidate, expectedDuration);
        if (!variant.range && verified.sha256 !== item.sourceHash) throw new Error("Untrimmed candidate differs from the rendered source.");
        item.candidateHash = verified.sha256; item.audio = verified.audio; item.phase = "publishing"; await persist();
      }
      if (item.phase === "publishing") {
        if ((await driver.verify(item.candidate, expectedDuration)).sha256 !== item.candidateHash) throw new Error("Candidate changed before publication.");
        if (await outputDirectory(job.request.directory) !== job.request.directory) throw new Error("Output directory changed before publication.");
        await mkdir(job.request.directory, { recursive: true });
        if (!await exists(item.staging)) await copyFile(item.candidate, item.staging, constants.COPYFILE_EXCL);
        if ((await driver.verify(item.staging, expectedDuration)).sha256 !== item.candidateHash) throw new Error("Incomplete publication staging file; retained for inspection.");
        if (!await exists(item.target)) await link(item.staging, item.target);
        else {
          const [staging, target] = await Promise.all([stat(item.staging), lstat(item.target)]);
          if (!target.isFile() || staging.ino !== target.ino || staging.dev !== target.dev) throw new Error("Output collision: existing file is not this job's published link.");
        }
        if ((await driver.verify(item.target, expectedDuration)).sha256 !== item.candidateHash) throw new Error("Published export did not verify.");
        item.phase = "completed"; await persist();
        await rm(item.staging);
      }
    }
    job.status = "completed"; await persist(); return job;
  } catch (error) {
    const errors = [String(error)];
    for (const item of job.items) {
      if (item.settings.some(setting => setting.attempted && !setting.restored)) {
        try { await restore(item.settings); } catch (failure) { errors.push(String(failure)); }
      }
    }
    job.status = "needs_review"; job.error = errors.join("; "); await persist(); return job;
  }
}
