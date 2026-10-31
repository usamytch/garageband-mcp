import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createExportJob, loadExportJob } from "../src/export-job.js";
import { exportJobStatus, spawnDetached } from "../src/export-launch.js";
import { processGroupAlive } from "../src/export-recovery.js";

const entry = fileURLToPath(new URL("./export-process-fixture.js", import.meta.url));
async function until(predicate: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 15000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const exists = (path: string) => access(path).then(() => true, () => false);

async function fixture() {
  const root = await mkdtemp(resolve("test-build/export-process-"));
  const { job } = await createExportJob(root, { projectPath: join(root, "existing.band"), directory: join(root, "delivery"),
    jobs: [{ filename: "Intro 10", tracks: [{ index: 1, name: "guitar", solo: true }] }] }, "process-test");
  await writeFile(join(root, "mixer.json"), JSON.stringify({ "1:solo": false }));
  const pids: number[] = [];
  return { root, job, pids,
    launch: async (mode: string) => { const pid = await spawnDetached(entry, ["worker", root, job.id, mode], join(root, "test.log")); pids.push(pid); return pid; },
    completed: () => until(async () => (await loadExportJob(root, job.id)).status === "completed", "completed job"),
    cleanup: async () => { for (const pid of pids) { try { process.kill(-pid, "SIGKILL"); } catch {} } await rm(root, { recursive: true, force: true }); },
  };
}

test("an actual detached export continues after the client is killed", async () => {
  const f = await fixture();
  const client = spawn(process.execPath, [entry, "client", f.root, f.job.id, ""], { stdio: "ignore" });
  try {
    await until(() => exists(join(f.root, "render-started")), "render start");
    const { pid } = JSON.parse(await readFile(join(f.root, "launched.json"), "utf8")); f.pids.push(pid);
    const closed = once(client, "exit"); client.kill("SIGKILL"); await closed;
    assert.equal(processGroupAlive(pid), true);
    assert.equal((await exportJobStatus(f.root, f.job.id, join(f.root, "fence.json"))).workerAlive, true);
    await writeFile(join(f.root, "continue"), "go");
    await f.completed();
    await until(async () => !await exists(join(f.root, "fence.json")), "fence cleanup");
    assert.deepEqual(JSON.parse(await readFile(join(f.root, "mixer.json"), "utf8")), { "1:solo": false });
    assert.equal(await readFile(join(f.root, "delivery/Intro 10.wav"), "utf8"), "complete-wave");
  } finally { client.kill("SIGKILL"); await f.cleanup(); }
});

test("a killed worker recovers its on-disk render and original mixer snapshot without a second render", async () => {
  const f = await fixture();
  try {
    const pid = await f.launch("crash");
    await until(() => exists(f.job.items[0].source), "rendered file");
    await until(async () => !processGroupAlive(pid), "worker exit");
    assert.equal((await loadExportJob(f.root, f.job.id)).items[0].phase, "rendering");
    assert.equal(JSON.parse(await readFile(join(f.root, "mixer.json"), "utf8"))["1:solo"], true);
    await f.launch("normal"); await f.completed();
    assert.equal(JSON.parse(await readFile(join(f.root, "mixer.json"), "utf8"))["1:solo"], false);
    assert.equal(await readFile(join(f.root, "render-started"), "utf8"), String(pid));
  } finally { await f.cleanup(); }
});

test("an orphan native child blocks recovery even when the worker itself is dead", async () => {
  const f = await fixture();
  let orphan: number | undefined;
  try {
    const pid = await f.launch("orphan");
    await until(() => exists(join(f.root, "native-pid")), "orphan child");
    orphan = Number(await readFile(join(f.root, "native-pid"), "utf8"));
    await until(async () => { try { process.kill(pid, 0); return false; } catch { return true; } }, "worker death");
    await f.launch("normal");
    await until(() => exists(join(f.root, "worker-failed")), "orphan refusal");
    assert.match(await readFile(join(f.root, "worker-failed"), "utf8"), /native child is still alive/);
    assert.equal(await readFile(join(f.root, "project-reads"), "utf8"), "read\n");
    assert.equal((await exportJobStatus(f.root, f.job.id, join(f.root, "fence.json"))).workerAlive, true);
    assert.equal((await loadExportJob(f.root, f.job.id)).items[0].phase, "rendering");
    process.kill(orphan, "SIGKILL"); orphan = undefined;
    await until(async () => !processGroupAlive(pid), "orphan exit");
    await f.launch("normal"); await f.completed();
  } finally { if (orphan) { try { process.kill(orphan, "SIGKILL"); } catch {} } await f.cleanup(); }
});

test("a completed job can clear a fence left by a crash before worker cleanup", async () => {
  const f = await fixture();
  try {
    const pid = await f.launch("completed-crash");
    await f.completed();
    await until(async () => !processGroupAlive(pid), "completed worker death");
    assert.equal(await exists(join(f.root, "fence.json")), true);
    await f.launch("normal");
    await until(async () => !await exists(join(f.root, "fence.json")), "completed fence recovery");
    assert.equal(await readFile(join(f.root, "render-started"), "utf8"), String(pid));
    assert.equal((await loadExportJob(f.root, f.job.id)).status, "completed");
  } finally { await f.cleanup(); }
});
