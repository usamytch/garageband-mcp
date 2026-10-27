import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { GBError } from "./errors.js";

const LOCK_HELPER = `
import fcntl, sys, time
handle = open(sys.argv[1], 'a')
deadline = time.monotonic() + float(sys.argv[2])
while True:
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if time.monotonic() >= deadline:
            sys.exit(73)
        time.sleep(0.05)
print('LOCKED', flush=True)
sys.stdin.buffer.read()
`;

// All installations and clients for this macOS user share the same GUI owner.
export const defaultGuiLockPath = join(homedir(), "Library/Caches/garageband-mcp/gui.lock");

/** The kernel releases this lock even if a client/server crashes. Never unlink it. */
export async function acquireGuiLock(path: string, signal?: AbortSignal, timeoutMs = 120_000): Promise<() => Promise<void>> {
  signal?.throwIfAborted();
  await mkdir(dirname(path), { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-u", "-c", LOCK_HELPER, path, String(timeoutMs / 1000)], { stdio: ["pipe", "pipe", "pipe"] });
    let acquired = false;
    let output = "";
    let error = "";
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort, { once: true });
    const exited = new Promise<void>((done) => child.once("close", () => done()));
    child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString(); });
    child.stdin.on("error", () => {});
    child.once("error", (cause) => reject(new GBError("GUI_LOCK_FAILED", `Cannot start the GUI lock helper: ${cause.message}`)));
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (!acquired) reject(new GBError("GUI_LOCK_FAILED", signal?.aborted ? "Cancelled while waiting for the GUI lock." : `GUI lock failed (${code}): ${error.trim() || "another client is still using GarageBand"}`));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (!acquired && output.includes("LOCKED\n")) {
        acquired = true;
        // Cancellation must not release the lock while an action is still running.
        signal?.removeEventListener("abort", abort);
        resolve(async () => { child.stdin.end(); await exited; });
      }
    });
    if (signal?.aborted) abort();
  });
}

export class GuiQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly acquire: (signal?: AbortSignal) => Promise<() => Promise<void>>) {}

  run<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const result = this.tail.then(async () => {
      signal?.throwIfAborted();
      const release = await this.acquire(signal);
      try {
        signal?.throwIfAborted();
        return await action();
      } finally {
        await release();
      }
    });
    this.tail = result.catch(() => {});
    return result;
  }
}
