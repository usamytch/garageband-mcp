import { readFile, rm } from "node:fs/promises";
import { defaultGuiLockPath } from "./gui-queue.js";
import { GBError } from "./errors.js";
import { writeJournal } from "./journal.js";

export const exportFencePath = defaultGuiLockPath + ".export-recovery.json";
export interface ExportFence { id: string; root: string; pid: number }

export async function readExportFence(path = exportFencePath): Promise<ExportFence | null> {
  try {
    const text = await readFile(path, "utf8");
    const value = JSON.parse(text) as ExportFence;
    if (!/^[a-f0-9]{64}$/.test(value.id) || typeof value.root !== "string" || !Number.isInteger(value.pid) || value.pid <= 0) throw new Error("Invalid export recovery fence; inspect it before GUI work.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function processGroupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; return true; }
}

export async function assertExportFenceAvailable(fence: ExportFence, path = exportFencePath): Promise<void> {
  const previous = await readExportFence(path);
  if (previous && (previous.id !== fence.id || previous.root !== fence.root)) throw new GBError("GUI_LOCK_FAILED", `Export ${previous.id} requires recovery first. Journal root: ${previous.root}`);
  if (previous && previous.pid !== process.pid && processGroupAlive(previous.pid)) throw new GBError("GUI_LOCK_FAILED", "The previous export worker or a native child is still alive. Do not resume until it has exited.");
}

export async function claimExportFence(fence: ExportFence, path = exportFencePath): Promise<void> {
  await assertExportFenceAvailable(fence, path);
  await writeJournal(path, fence);
}

export async function clearExportFence(id: string, path = exportFencePath): Promise<void> {
  const fence = await readExportFence(path);
  if (fence?.id !== id) throw new Error("Export recovery ownership changed");
  await rm(path);
}

export async function checkExportRecovery(tool: string, path = exportFencePath): Promise<void> {
  if (["gb_ui_state", "gb_list_projects", "gb_screenshot", "gb_check_permissions"].includes(tool)) return;
  const fence = await readExportFence(path);
  if (fence) throw new GBError("GUI_LOCK_FAILED", `Export ${fence.id} must finish or be restored before other GUI operations. Use gb_export_status / gb_export_resume. Journal root: ${fence.root}`);
}
