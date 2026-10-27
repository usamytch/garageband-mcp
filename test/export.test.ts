import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { prepareExport, fileSize, waitForFile } from "../src/export-file.js";

test("export rejects existing files, directories, invalid names and relative destinations", async () => {
  await mkdir("test-build/fixtures", { recursive: true });
  const root = await mkdtemp(resolve("test-build/fixtures/export-"));
  try {
    const target = await prepareExport(root, "new", "wav");
    assert.equal(target, join(root, "new.wav"));
    assert.equal(await fileSize(target), null);
    await writeFile(target, "audio");
    await assert.rejects(prepareExport(root, "new", "wav"), { code: "INVALID_INPUT" });
    await mkdir(join(root, "folder.wav"));
    await assert.rejects(prepareExport(root, "folder", "wav"), { code: "INVALID_INPUT" });
    await symlink("missing.wav", join(root, "dangling.wav"));
    await assert.rejects(prepareExport(root, "dangling", "wav"), { code: "INVALID_INPUT" });
    for (const name of ["", "../escape", "a\\b", "a:b", "\0", ".", ".."]) {
      await assert.rejects(prepareExport(root, name, "wav"), { code: "INVALID_INPUT" });
    }
    await assert.rejects(prepareExport("relative", "new", "wav"), { code: "INVALID_INPUT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("export waits for positive stable size, never accepts missing/empty/growing files", async () => {
  for (const [sizes, expected] of [
    [[null, 0, 12, 24, 24], 24], [[null], null], [[0], null], [[1, 2, 3, 4, 5], null],
  ] as Array<[Array<number | null>, number | null]>) {
    let time = 0, index = 0;
    assert.equal(await waitForFile("exact-path", 7000, {
      size: async (path) => { assert.equal(path, "exact-path"); return sizes[Math.min(index++, sizes.length - 1)]; },
      now: () => time, wait: async (ms) => { time += ms; },
    }), expected);
  }
});
