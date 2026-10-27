import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { GuiQueue, acquireGuiLock } from "../src/gui-queue.js";

const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((done) => { release = done; });
  return { promise, release };
};

test("GUI operations keep FIFO ownership through asynchronous steps and recover after failure", async () => {
  const first = gate();
  const entered = gate();
  const events: string[] = [];
  const queue = new GuiQueue(async () => {
    events.push("lock");
    return async () => { events.push("unlock"); };
  });
  const a = queue.run(async () => { events.push("a:start"); entered.release(); await first.promise; events.push("a:end"); throw new Error("failed"); });
  const failure = assert.rejects(a, /failed/);
  const b = queue.run(async () => { events.push("b"); return 42; });
  await entered.promise;
  assert.deepEqual(events, ["lock", "a:start"]);
  first.release();
  await failure;
  assert.equal(await b, 42);
  assert.deepEqual(events, ["lock", "a:start", "a:end", "unlock", "lock", "b", "unlock"]);
});

test("cancelled queued work never acquires the GUI or invokes its action", async () => {
  const first = gate();
  const queue = new GuiQueue(async () => async () => {});
  const a = queue.run(() => first.promise);
  const controller = new AbortController();
  const b = queue.run(async () => assert.fail("cancelled action ran"), controller.signal);
  const rejected = assert.rejects(b, /abort/i);
  controller.abort();
  first.release();
  await a;
  await rejected;
  assert.equal(await queue.run(async () => 3), 3);
});

test("independent processes cannot overlap, and a crashed owner releases the kernel lock", async () => {
  const dir = await mkdtemp(resolve("test-build/gui-lock-"));
  const path = resolve(dir, "gui.lock");
  const module = new URL("../src/gui-queue.js", import.meta.url).href;
  const owner = spawn(process.execPath, ["--input-type=module", "-e", `import { acquireGuiLock } from ${JSON.stringify(module)}; await acquireGuiLock(${JSON.stringify(path)}); console.log('ready'); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    await once(owner.stdout, "data");
    await assert.rejects(acquireGuiLock(path, undefined, 100), { code: "GUI_LOCK_FAILED" });
    const closed = once(owner, "close");
    owner.kill("SIGKILL");
    await closed;
    const release = await acquireGuiLock(path, undefined, 2000);
    await release();
    const again = await acquireGuiLock(path, undefined, 2000);
    await again();
  } finally {
    owner.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});
