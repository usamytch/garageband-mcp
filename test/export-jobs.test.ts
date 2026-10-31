import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createExportJob, loadExportJob, requestedSettings, saveExportJob } from "../src/export-job.js";
import { executeExportJob, type ExportDriver } from "../src/export-runner.js";
import { checkExportRecovery, claimExportFence, clearExportFence } from "../src/export-recovery.js";

async function fixture() {
  const root = await mkdtemp(resolve("test-build/export-jobs-"));
  const state = new Map([["1:solo", false], ["Auto Normalize", true]]);
  const calls: string[] = [];
  const driver: ExportDriver = {
    prepare: async () => {},
    read: async setting => state.get(setting.key)!,
    write: async (setting, value) => { calls.push(`write:${setting.key}:${value}`); state.set(setting.key, value); },
    idle: async () => true,
    render: async path => { calls.push("render"); await writeFile(path, "complete-wave"); },
    finish: async (source, candidate) => { await copyFile(source, candidate); },
    verify: async path => {
      const bytes = await readFile(path);
      if (bytes.toString() !== "complete-wave") throw new Error("incomplete wave");
      return { audio: { duration: 1, sampleRate: 44100, channels: 2, codec: "pcm_s24le", bytes: bytes.length },
        sha256: createHash("sha256").update(bytes).digest("hex") };
    },
  };
  const request = { projectPath: join(root, "existing.band"), directory: join(root, "delivery"),
    jobs: [{ filename: "Intro 10", normalize: false, tracks: [{ index: 1, name: "acoustic", solo: true }] }] };
  const { job } = await createExportJob(root, request, "intro-10");
  return { root, state, calls, driver, request, job, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("durable batch restores original settings, publishes once and rejects reuse with another plan", async () => {
  const f = await fixture();
  try {
    const done = await executeExportJob(f.root, f.job.id, f.driver);
    assert.equal(done.status, "completed");
    assert.equal(f.state.get("1:solo"), false); assert.equal(f.state.get("Auto Normalize"), true);
    assert.equal((await createExportJob(f.root, f.request, "intro-10")).created, false);
    await executeExportJob(f.root, f.job.id, f.driver);
    assert.equal(f.calls.filter(x => x === "render").length, 1);
    await assert.rejects(createExportJob(f.root, { ...f.request, jobs: [{ filename: "other", tracks: [] }] }, "intro-10"), /different export plan/);
  } finally { await f.cleanup(); }
});

test("GUI preparation precedes snapshots and is skipped for completed file-only recovery", async () => {
  const f = await fixture();
  try {
    let preparations = 0;
    const read = f.driver.read;
    f.driver.prepare = async () => { preparations++; };
    f.driver.read = async setting => { assert.equal(preparations, 1); return read(setting); };
    assert.equal((await executeExportJob(f.root, f.job.id, f.driver)).status, "completed");
    assert.equal(preparations, 1);
    assert.equal((await executeExportJob(f.root, f.job.id, f.driver)).status, "completed");
    assert.equal(preparations, 1);
  } finally { await f.cleanup(); }
});

test("failed GUI preparation cannot read or change export settings", async () => {
  const f = await fixture();
  try {
    f.driver.prepare = async () => { throw new Error("could not focus GarageBand"); };
    f.driver.read = async () => { assert.fail("must prepare before reading settings"); };
    const stopped = await executeExportJob(f.root, f.job.id, f.driver);
    assert.match(stopped.error!, /could not focus/);
    assert.equal(stopped.items[0].phase, "pending");
    assert.deepEqual(stopped.items[0].settings, []);
    assert.deepEqual(f.calls, []);
  } finally { await f.cleanup(); }
});

test("recovery waits for a native render before preparing or restoring the GUI", async () => {
  const f = await fixture();
  try {
    f.driver.render = async path => { await writeFile(path, "complete-wave"); throw new Error("worker interrupted"); };
    f.driver.idle = async () => false;
    await executeExportJob(f.root, f.job.id, f.driver);
    let preparations = 0;
    const read = f.driver.read;
    f.driver.prepare = async () => { preparations++; };
    f.driver.read = async setting => { assert.equal(preparations, 1); return read(setting); };
    assert.equal((await executeExportJob(f.root, f.job.id, f.driver)).status, "needs_review");
    assert.equal(preparations, 0);
    f.driver.idle = async () => true;
    assert.equal((await executeExportJob(f.root, f.job.id, f.driver)).status, "completed");
    assert.equal(preparations, 1);
    assert.equal(f.state.get("1:solo"), false);
    assert.equal(f.state.get("Auto Normalize"), true);
  } finally { await f.cleanup(); }
});

test("restore-only cannot abandon an active render even when no settings changed", async () => {
  const f = await fixture();
  try {
    const { job } = await createExportJob(f.root, { ...f.request, jobs: [{ filename: "unchanged", tracks: [] }] }, "no-settings");
    f.driver.render = async path => { await writeFile(path, "complete-wave"); throw new Error("worker interrupted"); };
    f.driver.idle = async () => false;
    await executeExportJob(f.root, job.id, f.driver);
    f.driver.prepare = async () => { assert.fail("no settings to restore"); };
    const stopped = await executeExportJob(f.root, job.id, f.driver, true);
    assert.equal(stopped.status, "needs_review");
    assert.match(stopped.error!, /still busy/);
    f.driver.idle = async () => true;
    assert.equal((await executeExportJob(f.root, job.id, f.driver, true)).status, "abandoned");
    assert.equal(await readFile(job.items[0].source, "utf8"), "complete-wave");
  } finally { await f.cleanup(); }
});

test("late render completion is recovered without resubmitting or losing the original mixer snapshot", async () => {
  const f = await fixture();
  try {
    f.driver.render = async path => { f.calls.push("render"); await writeFile(path, "complete-wave"); throw new Error("client timeout"); };
    f.driver.idle = async () => false;
    const stopped = await executeExportJob(f.root, f.job.id, f.driver);
    assert.equal(stopped.status, "needs_review");
    assert.equal(stopped.items[0].phase, "rendering");
    assert.equal(f.state.get("1:solo"), true);
    f.driver.idle = async () => true;
    const recovered = await executeExportJob(f.root, f.job.id, f.driver);
    assert.equal(recovered.status, "completed");
    assert.equal(f.state.get("1:solo"), false); assert.equal(f.state.get("Auto Normalize"), true);
    assert.equal(f.calls.filter(x => x === "render").length, 1);
  } finally { await f.cleanup(); }
});

test("ambiguous submission without a WAV is never repeated; restore-only preserves files and releases settings", async () => {
  const f = await fixture();
  try {
    f.driver.render = async () => { f.calls.push("render"); throw new Error("lost reply"); };
    await executeExportJob(f.root, f.job.id, f.driver);
    assert.equal((await executeExportJob(f.root, f.job.id, f.driver)).status, "needs_review");
    assert.equal(f.calls.filter(x => x === "render").length, 1);
    assert.equal((await executeExportJob(f.root, f.job.id, f.driver, true)).status, "abandoned");
    assert.equal(f.state.get("1:solo"), false);
  } finally { await f.cleanup(); }
});

test("failed restoration cannot publish success; recovery retries restoration before publishing", async () => {
  const f = await fixture();
  try {
    const write = f.driver.write;
    f.driver.write = async (setting, value) => { if (setting.key === "1:solo" && !value) throw new Error("focus lost"); await write(setting, value); };
    const stopped = await executeExportJob(f.root, f.job.id, f.driver);
    assert.equal(stopped.status, "needs_review");
    await assert.rejects(readFile(stopped.items[0].target), { code: "ENOENT" });
    f.driver.write = write;
    assert.equal((await executeExportJob(f.root, f.job.id, f.driver)).status, "completed");
    assert.equal(f.calls.filter(x => x === "render").length, 1);
  } finally { await f.cleanup(); }
});

test("existing outputs and changed completed audio are preserved and reported", async () => {
  const f = await fixture();
  try {
    const done = await executeExportJob(f.root, f.job.id, f.driver);
    await writeFile(done.items[0].target, "user edit");
    assert.equal((await executeExportJob(f.root, f.job.id, f.driver)).status, "needs_review");
    assert.equal(await readFile(done.items[0].target, "utf8"), "user edit");
    assert.equal(f.calls.filter(x => x === "render").length, 1);
  } finally { await f.cleanup(); }
});

test("partial finalization does not get mistaken for a completed export", async () => {
  const f = await fixture();
  try {
    f.driver.finish = async (_, candidate) => { await writeFile(candidate, "partial"); throw new Error("disk full"); };
    await executeExportJob(f.root, f.job.id, f.driver);
    const retry = await executeExportJob(f.root, f.job.id, f.driver);
    assert.equal(retry.status, "needs_review");
    assert.equal(await readFile(retry.items[0].candidate, "utf8"), "partial");
    assert.equal(f.calls.filter(x => x === "render").length, 1);
  } finally { await f.cleanup(); }
});

test("prepared snapshots refuse changed track state, and journals cannot redirect output paths", async () => {
  const f = await fixture();
  try {
    const job = await loadExportJob(f.root, f.job.id);
    job.items[0].phase = "prepared";
    job.items[0].settings = requestedSettings(job.request.jobs[0]);
    job.items[0].settings[1].before = true;
    await saveExportJob(f.root, job);
    f.state.set("1:solo", true);
    assert.equal((await executeExportJob(f.root, job.id, f.driver)).status, "needs_review");
    assert.equal(f.calls.length, 0);
    job.items[0].target = join(f.root, "source.wav");
    await saveExportJob(f.root, job);
    await assert.rejects(loadExportJob(f.root, job.id), /journal paths/);
  } finally { await f.cleanup(); }
});

test("corrupt journal settings and phase cannot cause GUI writes", async () => {
  const f = await fixture();
  try {
    const job = await loadExportJob(f.root, f.job.id);
    job.items[0].phase = "prepared";
    job.items[0].settings = requestedSettings(job.request.jobs[0]);
    job.items[0].settings[0].index = 41;
    await saveExportJob(f.root, job);
    await assert.rejects(executeExportJob(f.root, job.id, f.driver), /journal settings/);
    job.items[0].settings = requestedSettings(job.request.jobs[0]);
    job.items[0].phase = "completed";
    await saveExportJob(f.root, job);
    await assert.rejects(executeExportJob(f.root, job.id, f.driver), /source identity/);
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});

test("retry after failed setup respects later manual mixer changes", async () => {
  const f = await fixture();
  try {
    const write = f.driver.write;
    f.driver.write = async (setting, value) => { await write(setting, value); if (setting.field === "normalize" && !value) throw new Error("lost setup reply"); };
    assert.equal((await executeExportJob(f.root, f.job.id, f.driver)).status, "needs_review");
    f.driver.write = write;
    f.state.set("1:solo", true);
    const count = f.calls.length;
    const resumed = await executeExportJob(f.root, f.job.id, f.driver);
    assert.match(resumed.error!, /Mixer changed/);
    assert.equal(f.calls.length, count);
    assert.equal(f.state.get("1:solo"), true);
  } finally { await f.cleanup(); }
});

test("concurrent identical requests create one durable job", async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([createExportJob(f.root, f.request, "parallel"), createExportJob(f.root, f.request, "parallel")]);
    assert.equal(results.filter(result => result.created).length, 1);
    assert.equal(results[0].job.id, results[1].job.id);
  } finally { await f.cleanup(); }
});

test("publication interrupted after linking recovers without replacing the delivered file", async () => {
  const f = await fixture();
  try {
    const done = await executeExportJob(f.root, f.job.id, f.driver);
    await link(done.items[0].target, done.items[0].staging);
    done.status = "running"; done.items[0].phase = "publishing";
    await saveExportJob(f.root, done);
    assert.equal((await executeExportJob(f.root, done.id, f.driver)).status, "completed");
    assert.equal(f.calls.filter(x => x === "render").length, 1);
    await assert.rejects(readFile(done.items[0].staging), { code: "ENOENT" });
  } finally { await f.cleanup(); }
});

test("replaced output directory is rejected before mixer changes", async () => {
  const f = await fixture();
  try {
    const redirected = join(f.root, "redirected");
    await mkdir(redirected);
    await symlink(redirected, f.request.directory);
    const result = await executeExportJob(f.root, f.job.id, f.driver);
    assert.match(result.error!, /directory changed/);
    assert.equal(f.calls.length, 0);
  } finally { await f.cleanup(); }
});

test("batch recovery keeps the first delivered variant and recovers a late second one", async () => {
  const f = await fixture();
  try {
    const { job } = await createExportJob(f.root, { ...f.request, jobs: [...f.request.jobs, { ...f.request.jobs[0], filename: "Intro 11" }] }, "two-variants");
    const render = f.driver.render;
    let count = 0;
    f.driver.render = async path => { await render(path); if (++count === 2) throw new Error("late second render"); };
    const stopped = await executeExportJob(f.root, job.id, f.driver);
    assert.equal(stopped.items[0].phase, "completed");
    assert.equal(stopped.items[1].phase, "rendering");
    const first = await readFile(stopped.items[0].target);
    const resumed = await executeExportJob(f.root, job.id, f.driver);
    assert.equal(resumed.status, "completed");
    assert.equal(count, 2);
    assert.deepEqual(await readFile(stopped.items[0].target), first);
  } finally { await f.cleanup(); }
});

test("a decodable but unrelated untrimmed candidate cannot be published", async () => {
  const f = await fixture();
  try {
    f.driver.finish = async (_, candidate) => { await writeFile(candidate, "other-valid-wave"); };
    f.driver.verify = async path => {
      const bytes = await readFile(path);
      return { audio: { duration: 1, sampleRate: 44100, channels: 2, codec: "test", bytes: bytes.length },
        sha256: createHash("sha256").update(bytes).digest("hex") };
    };
    const result = await executeExportJob(f.root, f.job.id, f.driver);
    assert.match(result.error!, /differs from the rendered source/);
    await assert.rejects(readFile(result.items[0].target), { code: "ENOENT" });
    assert.equal(f.state.get("1:solo"), false);
  } finally { await f.cleanup(); }
});

test("reserved publication names and journal roots inside DAW projects are refused", async () => {
  const f = await fixture();
  try {
    await assert.rejects(createExportJob(f.root, { ...f.request, jobs: [{ filename: ".gb-reserved", tracks: [] }] }, "reserved"), /reserved/);
    await assert.rejects(createExportJob(join(f.root, "Untouched.band/jobs"), f.request, "inside"), /project packages/);
    await assert.rejects(readFile(join(f.root, "Untouched.band")), { code: "ENOENT" });
  } finally { await f.cleanup(); }
});

test("recovery fence blocks ordinary GUI work and a second job until restoration", async () => {
  const f = await fixture();
  const path = join(f.root, "recovery.json");
  try {
    await claimExportFence({ id: f.job.id, root: f.root, pid: process.pid }, path);
    await assert.rejects(checkExportRecovery("gb_set_track_solo", path), /must finish or be restored/);
    await checkExportRecovery("gb_ui_state", path);
    await assert.rejects(claimExportFence({ id: "a".repeat(64), root: f.root, pid: process.pid }, path), /requires recovery/);
    await clearExportFence(f.job.id, path);
    await checkExportRecovery("gb_set_track_solo", path);
  } finally { await f.cleanup(); }
});
