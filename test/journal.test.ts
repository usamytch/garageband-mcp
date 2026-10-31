import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { writeJournal, recordFailure } from "../src/journal.js";
import { withCleanup } from "../src/cleanup.js";

test("journal replacement retains the previous record on serialization failure", async () => {
  await mkdir("test-build/fixtures", { recursive: true });
  const directory = await mkdtemp(resolve("test-build/fixtures/journal-"));
  try {
    const path = join(directory, "journal.json");
    await writeJournal(path, { phase: "snapshot" });
    await assert.rejects(writeJournal(path, { invalid: BigInt(1) }));
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { phase: "snapshot" });
    assert.deepEqual(await readdir(directory), ["journal.json"]);
    await writeJournal(path, { phase: "restored" });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { phase: "restored" });
  } finally { await rm(directory, { recursive: true }); }
});

test("reporting and cleanup failures retain the primary error and attempt every restore", async () => {
  assert.match(await recordFailure(Error("export failed"), async () => { throw Error("disk full"); }), /export failed.*disk full/);
  const calls: number[] = [];
  assert.throws(() => withCleanup(() => { throw Error("drag failed"); }, [
    () => { calls.push(1); throw Error("window closed"); }, () => { calls.push(2); },
  ]), /drag failed.*window closed/);
  assert.deepEqual(calls, [1, 2]);
  assert.throws(() => withCleanup(() => { throw { code: "VERIFICATION_FAILED", message: "native drag failed" }; }, [
    () => { throw { code: "WINDOW_CLOSED", message: "native cleanup failed" }; },
  ]), /native drag failed.*native cleanup failed/);
  assert.equal(withCleanup(() => 42, [() => { calls.push(3); }]), 42);
});
