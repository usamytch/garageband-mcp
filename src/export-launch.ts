import { spawn } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobDirectory, loadExportJob } from "./export-job.js";
import { processGroupAlive, readExportFence } from "./export-recovery.js";
import { acquireGuiLock } from "./gui-queue.js";
import { writeJournal } from "./journal.js";

/** No pipes to the MCP client: closing or killing that client cannot kill this worker. */
export async function spawnDetached(entry: string, args: string[], log: string): Promise<number> {
  const file = await open(log, "a", 0o600);
  try {
    const child = spawn(process.execPath, [entry, ...args], { detached: true, stdio: ["ignore", file.fd, file.fd] });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    return child.pid!;
  } finally { await file.close(); }
}

export async function exportJobStatus(root: string, id: string, fencePath?: string) {
  const folder = jobDirectory(root, id);
  const job = await loadExportJob(root, id);
  let pid: number | undefined;
  try { pid = JSON.parse(await readFile(join(folder, "worker.json"), "utf8")).pid; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const fence = await readExportFence(fencePath);
  const recoveryRequired = fence?.id === id && fence.root === root;
  const workerAlive = (Number.isInteger(pid) && pid! > 0 && processGroupAlive(pid!)) ||
    (recoveryRequired && processGroupAlive(fence!.pid));
  let workerError: unknown;
  try { workerError = JSON.parse(await readFile(join(folder, "worker-error.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { id, status: job.status === "running" && !workerAlive ? "interrupted" : job.status, workerAlive, recoveryRequired,
    journalPath: join(folder, "job.json"), error: job.error, workerError,
    mixerRestored: job.items.every(item => item.settings.every(s => !s.attempted || s.restored)),
    items: job.items.map((item, i) => ({ filename: job.request.jobs[i].filename, phase: item.phase,
      ...(item.phase === "completed" ? { path: item.target, sha256: item.candidateHash, audio: item.audio } : {}) })) };
}

export async function launchExportWorker(root: string, id: string, action: "continue" | "restore" = "continue") {
  const release = await acquireGuiLock(join(jobDirectory(root, id), "launch.lock"));
  try {
    const status = await exportJobStatus(root, id);
    if (status.workerAlive || (["completed", "abandoned"].includes(status.status) && !status.recoveryRequired)) return status;
    const pid = await spawnDetached(fileURLToPath(new URL("./export-worker.js", import.meta.url)), [root, id, action], join(jobDirectory(root, id), "worker.log"));
    await writeJournal(join(jobDirectory(root, id), "worker.json"), { pid, startedAt: new Date().toISOString() });
    return { ...status, launchedPid: pid };
  } finally { await release(); }
}
