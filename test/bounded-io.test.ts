import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fetchBytes, readLimitedBody, readLocalBytes } from "../src/bounded-io.js";

test("streaming cap cancels unknown-length bodies before draining them", async () => {
  let reads = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(100)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readLimitedBody(new Response(body), 250), /limit/);
  assert.ok(reads <= 4);
  assert.equal(cancelled, true);
  assert.equal((await readLimitedBody(new Response("abc"), 3)).toString(), "abc");
  await assert.rejects(readLimitedBody(new Response("a", { headers: { "content-length": "1000" } }), 5), /limit/);
});

test("fetch timeout, failures and redirects cannot leak URL credentials", async () => {
  const fetcher: typeof fetch = async (_url, options) => {
    assert.equal(options?.redirect, "manual");
    return new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(Error("secret-token"))));
  };
  await assert.rejects(fetchBytes("https://example.test/?token=secret-token", 10, fetcher, 5), /timed out/);
  await assert.rejects(fetchBytes("http://example.test", 10), /https/);
  await assert.rejects(fetchBytes("https://user:secret@example.test", 10), /credentials/);
  await assert.rejects(fetchBytes("invalid secret-token", 10), error => {
    assert.doesNotMatch(String(error), /secret-token/);
    return true;
  });
  await assert.rejects(fetchBytes("https://example.test/?token=secret-token", 10, async () => new Response("secret-token", { status: 403 })), error => {
    assert.doesNotMatch(String(error), /secret-token/);
    return true;
  });
});

test("HTTPS redirects stay bounded and cannot downgrade or reset the timeout", async () => {
  const requests: string[] = [], signals: unknown[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    requests.push(String(url)); signals.push(options?.signal);
    return requests.length === 1 ? new Response(null, { status: 302, headers: { location: "/audio" } }) : new Response("audio");
  };
  assert.equal((await fetchBytes("https://example.test/start", 5, fetcher)).toString(), "audio");
  assert.deepEqual(requests, ["https://example.test/start", "https://example.test/audio"]);
  assert.equal(signals[0], signals[1]);
  for (const location of ["http://example.test/audio", "https://user:secret@example.test/audio"]) {
    let calls = 0;
    await assert.rejects(fetchBytes("https://example.test", 10, async () => {
      calls++; return new Response(null, { status: 302, headers: { location } });
    }), /https|credentials/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(fetchBytes("https://example.test", 10, async () => {
    calls++; return new Response(null, { status: 302, headers: { location: "/loop" } });
  }), /five-hop/);
  assert.equal(calls, 6);
});

test("local MIDI reads enforce absolute path and the same byte cap", async () => {
  await mkdir("test-build/fixtures", { recursive: true });
  const directory = await mkdtemp(resolve("test-build/fixtures/bounded-"));
  try {
    const path = join(directory, "input.mid");
    await writeFile(path, "12345");
    assert.equal((await readLocalBytes(path, 5)).toString(), "12345");
    await assert.rejects(readLocalBytes(path, 4), /limit/);
    await assert.rejects(readLocalBytes("relative", 10), /absolute/);
  } finally { await rm(directory, { recursive: true }); }
});
