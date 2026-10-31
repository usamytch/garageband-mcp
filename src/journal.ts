import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/** Keep the last complete recovery record if a new write is interrupted. */
export async function writeJournal(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function recordFailure(error: unknown, record: () => Promise<void>): Promise<string> {
  try { await record(); return String(error); }
  catch (journalError) { return `${String(error)}; recovery journal also failed: ${String(journalError)}`; }
}
