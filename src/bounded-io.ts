import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { GBError } from "./errors.js";

function limitError(maxBytes: number): GBError {
  return new GBError("INVALID_INPUT", `File exceeds the ${maxBytes} byte limit; reading stopped.`);
}

export async function readLimitedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    await response.body?.cancel();
    throw limitError(maxBytes);
  }
  if (!response.body) throw new GBError("INVALID_INPUT", "Download has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return Buffer.concat(chunks, size);
      size += next.value.byteLength;
      if (size > maxBytes) throw limitError(maxBytes);
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export async function fetchBytes(url: string, maxBytes: number, fetcher = fetch, timeoutMs = 30_000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = new URL(url);
    for (let redirects = 0; ; redirects++) {
      if (current.protocol !== "https:" || current.username || current.password) {
        throw new GBError("INVALID_INPUT", "Only https:// URLs without embedded credentials are allowed.");
      }
      const response = await fetcher(current.href, { signal: controller.signal, redirect: "manual" });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || redirects >= 5) throw new GBError("INVALID_INPUT", "Download redirect is missing or exceeds the five-hop limit.");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new GBError("INVALID_INPUT", `Download failed: HTTP ${response.status}.`);
      }
      return await readLimitedBody(response, maxBytes);
    }
  } catch (error) {
    if (error instanceof GBError) throw error;
    // Fetch errors can contain a URL with a query token. Never echo it.
    throw new GBError("INVALID_INPUT", controller.signal.aborted ? "Download timed out." : "Download failed; check the HTTPS address and connection.");
  } finally { clearTimeout(timer); }
}

export async function readLocalBytes(path: string, maxBytes: number): Promise<Buffer> {
  if (!isAbsolute(path)) throw new GBError("INVALID_INPUT", "Local file path must be absolute.");
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw limitError(maxBytes);
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size <= maxBytes) {
      const read = await file.read(bytes, size, Math.min(65536, bytes.length - size));
      if (!read.bytesRead) return bytes.subarray(0, size);
      size += read.bytesRead;
      if (size > maxBytes) throw limitError(maxBytes);
    }
    throw limitError(maxBytes);
  } finally { await file.close(); }
}
