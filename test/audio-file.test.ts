import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { verifyWaveContainer, rangeFilter } from "../src/audio-file.js";

test("WAV completion rejects truncated or unfinished headers and chunks", async () => {
  await mkdir("test-build/fixtures", { recursive: true });
  const root = await mkdtemp(resolve("test-build/fixtures/wave-"));
  try {
    const path = join(root, "test.wav");
    const wav = Buffer.alloc(48);
    wav.write("RIFF"); wav.writeUInt32LE(40, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.write("data", 36); wav.writeUInt32LE(4, 40);
    await writeFile(path, wav);
    const identity = await verifyWaveContainer(path);
    const metadata = Buffer.alloc(12);
    metadata.write("JUNK"); metadata.writeUInt32LE(4, 4); metadata.write("meta", 8);
    const tagged = Buffer.concat([wav, metadata]); tagged.writeUInt32LE(tagged.length - 8, 4);
    await writeFile(path, tagged);
    assert.deepEqual(await verifyWaveContainer(path), identity, "GarageBand metadata must not alter audio identity");
    tagged[44] = 1;
    await writeFile(path, tagged);
    assert.notDeepEqual(await verifyWaveContainer(path), identity, "A single changed sample must be detected");
    await writeFile(path, wav.subarray(0, 47));
    await assert.rejects(verifyWaveContainer(path), /length/);
    wav.writeUInt32LE(20, 40);
    await writeFile(path, wav);
    await assert.rejects(verifyWaveContainer(path), /truncated/);
    wav.writeUInt32LE(0xffffffff, 4);
    await writeFile(path, wav);
    await assert.rejects(verifyWaveContainer(path), /length/);
  } finally { await rm(root, { recursive: true }); }
});

test("export ranges use an explicit verified origin and reject outside/fade errors", () => {
  const range = { startSeconds: 6.4, endSeconds: 20, exportOriginSeconds: 5.6, fadeOutSeconds: 1.2 };
  const result = rangeFilter(range, 30);
  assert.equal(result.duration, 13.6);
  assert.match(result.filter, /afade=t=out/);
  for (const update of [{ endSeconds: 50 }, { exportOriginSeconds: 8 }, { fadeOutSeconds: 20 }, { startSeconds: NaN }]) {
    assert.throws(() => rangeFilter({ ...range, ...update }, 30));
  }
});
