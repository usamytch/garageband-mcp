import { readFile, writeFile, appendFile, copyFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { spawnDetached } from "../src/export-launch.js";
import { runExportWorker } from "../src/export-service.js";
import type { ExportDriver } from "../src/export-runner.js";

const [role, root, id, mode] = process.argv.slice(2);
if (role === "client") {
  const pid = await spawnDetached(fileURLToPath(import.meta.url), ["worker", root, id, "wait"], join(root, "worker-test.log"));
  await writeFile(join(root, "launched.json"), JSON.stringify({ pid }));
  setInterval(() => {}, 1000);
} else if (role === "worker") {
  const driver: ExportDriver = {
    prepare: async () => {},
    read: async setting => JSON.parse(await readFile(join(root, "mixer.json"), "utf8"))[setting.key],
    write: async (setting, value) => {
      const state = JSON.parse(await readFile(join(root, "mixer.json"), "utf8"));
      state[setting.key] = value; await writeFile(join(root, "mixer.json"), JSON.stringify(state));
    },
    idle: async () => true,
    render: async path => {
      await writeFile(join(root, "render-started"), String(process.pid), { flag: "wx" });
      if (mode === "wait") {
        const deadline = Date.now() + 10000;
        while (!await access(join(root, "continue")).then(() => true, () => false)) {
          if (Date.now() > deadline) throw new Error("test gate timed out");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      await writeFile(path, "complete-wave", { flag: "wx" });
      if (mode === "orphan") {
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        await writeFile(join(root, "native-pid"), String(child.pid));
      }
      if (mode === "crash" || mode === "orphan") process.kill(process.pid, "SIGKILL");
    },
    finish: async (source, candidate) => { await copyFile(source, candidate); },
    verify: async path => {
      const data = await readFile(path);
      if (data.toString() !== "complete-wave") throw new Error("incomplete wave");
      return { audio: { duration: 1, sampleRate: 44100, channels: 2, codec: "test", bytes: data.length },
        sha256: createHash("sha256").update(data).digest("hex") };
    },
  };
  try {
    let verifications = 0;
    await runExportWorker(root, id, driver, { guiLock: join(root, "gui.lock"), fencePath: join(root, "fence.json"), verify: async () => {
      await appendFile(join(root, "project-reads"), "read\n");
      if (++verifications === 2 && mode === "completed-crash") process.kill(process.pid, "SIGKILL");
    } });
  } catch (error) { await writeFile(join(root, "worker-failed"), String(error)); }
}
