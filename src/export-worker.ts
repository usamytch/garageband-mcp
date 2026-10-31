import { isAbsolute, join } from "node:path";
import { jobDirectory } from "./export-job.js";
import { nativeExportDriver, runExportWorker } from "./export-service.js";
import { writeJournal } from "./journal.js";

const [root, id, action] = process.argv.slice(2);
if (!root || !isAbsolute(root) || !["continue", "restore"].includes(action)) throw new Error("Invalid export worker arguments");
const folder = jobDirectory(root, id);
try {
  await runExportWorker(root, id, nativeExportDriver(), { restoreOnly: action === "restore" });
} catch (error) {
  await writeJournal(join(folder, "worker-error.json"), { error: String(error), time: new Date().toISOString() });
  console.error(error);
  process.exitCode = 1;
}
