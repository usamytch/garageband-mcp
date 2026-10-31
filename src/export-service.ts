import { basename, dirname, join } from "node:path";
import { copyFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { acquireGuiLock, defaultGuiLockPath } from "./gui-queue.js";
import { jobDirectory, loadExportJob } from "./export-job.js";
import { executeExportJob, type ExportDriver } from "./export-runner.js";
import { assertExportFenceAvailable, claimExportFence, clearExportFence, exportFencePath } from "./export-recovery.js";
import { operationContext } from "./operation-context.js";
import { verifyProject } from "./project-guard.js";
import { exportComplete, exportSong } from "./tools/export.js";
import { exportNormalization } from "./export-settings.js";
import { readTracks, setTrackToggle } from "./track-state.js";
import { renderExportRange, validateAudioFile } from "./audio-file.js";
import { fileHash } from "./audio-import.js";
import { writeJournal } from "./journal.js";
import { ensureReady } from "./ui.js";

export function nativeExportDriver(): ExportDriver {
  return {
    prepare: async () => {
      if (!await exportComplete()) throw new Error("GarageBand is still busy; export preparation has not changed the application.");
      await ensureReady({ needsProject: true });
    },
    read: async setting => {
      if (setting.field === "normalize") return exportNormalization();
      const track = (await readTracks()).find(t => t.index === setting.index);
      if (!track || track.name !== setting.name) throw new Error(`Export track identity changed: ${setting.key}`);
      return track[setting.field];
    },
    write: async (setting, value) => {
      if (setting.field === "normalize") { await exportNormalization(value); return; }
      const track = (await readTracks()).find(t => t.index === setting.index);
      if (!track || track.name !== setting.name) throw new Error(`Export track identity changed: ${setting.key}`);
      await setTrackToggle(setting.index, setting.field === "solo" ? "Solo" : "Mute", value);
    },
    idle: exportComplete,
    render: async path => { await exportSong({ filename: basename(path, ".wav"), directory: dirname(path), format: "wav", waitTimeoutSec: 1800 }); },
    finish: async (source, candidate, range) => {
      if (range) await renderExportRange(source, candidate, range);
      else await copyFile(source, candidate, constants.COPYFILE_EXCL);
    },
    verify: async (path, duration) => ({ audio: await validateAudioFile(path, duration), sha256: await fileHash(path) }),
  };
}

/** Detached worker owns the same GUI lock/target checks as ordinary MCP handlers. */
export async function runExportWorker(root: string, id: string, driver: ExportDriver, options: {
  restoreOnly?: boolean; guiLock?: string; fencePath?: string; verify?: typeof verifyProject;
} = {}) {
  const folder = jobDirectory(root, id);
  const releaseJob = await acquireGuiLock(join(folder, "worker.lock"));
  try {
    await writeJournal(join(folder, "worker.json"), { pid: process.pid, startedAt: new Date().toISOString() });
    await rm(join(folder, "worker-error.json"), { force: true });
    const releaseGui = await acquireGuiLock(options.guiLock ?? defaultGuiLockPath);
    try {
      const job = await loadExportJob(root, id);
      const verify = () => (options.verify ?? verifyProject)(job.request.projectPath);
      await assertExportFenceAvailable({ id, root, pid: process.pid }, options.fencePath ?? exportFencePath);
      await verify();
      await claimExportFence({ id, root, pid: process.pid }, options.fencePath ?? exportFencePath);
      return await operationContext.run({ projectPath: job.request.projectPath, verify }, async () => {
        const result = await executeExportJob(root, id, driver, options.restoreOnly);
        await verify();
        if (result.status === "completed" || result.status === "abandoned") await clearExportFence(id, options.fencePath ?? exportFencePath);
        return result;
      });
    } finally { await releaseGui(); }
  } finally { await releaseJob(); }
}
