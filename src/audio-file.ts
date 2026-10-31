import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { GBError } from "./errors.js";

const exec = promisify(execFile);
export interface AudioInfo { duration: number; sampleRate: number; channels: number; codec: string; bytes: number }

/** Reject RIFF placeholders and truncated chunks, even if a decoder tolerates EOF. */
export async function verifyWaveContainer(path: string): Promise<{ formatSha256: string; pcmSha256: string; dataBytes: number }> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    const header = Buffer.alloc(12);
    if ((await file.read(header, 0, 12, 0)).bytesRead !== 12 || header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8) !== "WAVE") {
      throw new GBError("VERIFICATION_FAILED", "Expected a complete RIFF/WAVE file.");
    }
    const end = header.readUInt32LE(4) + 8;
    if (end !== size) throw new GBError("VERIFICATION_FAILED", "WAV length does not match its finalized RIFF header.");
    let offset = 12, data = false, format = false, dataBytes = 0;
    const formatHash = createHash("sha256"), pcmHash = createHash("sha256");
    const buffer = Buffer.alloc(65536);
    while (offset + 8 <= end) {
      const chunk = Buffer.alloc(8);
      if ((await file.read(chunk, 0, 8, offset)).bytesRead !== 8) throw new GBError("VERIFICATION_FAILED", "WAV changed during inspection.");
      const length = chunk.readUInt32LE(4);
      if (offset + 8 + length > end) throw new GBError("VERIFICATION_FAILED", "WAV contains a truncated chunk.");
      const name = chunk.toString("ascii", 0, 4);
      if (name === "fmt " || name === "data") {
        if (name === "fmt " ? format : data) throw new GBError("VERIFICATION_FAILED", "WAV contains ambiguous duplicate audio chunks.");
        const hash = name === "fmt " ? formatHash : pcmHash;
        for (let position = 0; position < length;) {
          const count = Math.min(buffer.length, length - position);
          if ((await file.read(buffer, 0, count, offset + 8 + position)).bytesRead !== count) throw new GBError("VERIFICATION_FAILED", "WAV changed during inspection.");
          hash.update(buffer.subarray(0, count)); position += count;
        }
        if (name === "fmt ") format = length >= 16;
        else { data = length > 0; dataBytes = length; }
      }
      offset += 8 + length + (length % 2);
    }
    if (offset !== end || !data || !format) throw new GBError("VERIFICATION_FAILED", "WAV has no complete audio payload.");
    return { formatSha256: formatHash.digest("hex"), pcmSha256: pcmHash.digest("hex"), dataBytes };
  } finally { await file.close(); }
}

export async function validateAudioFile(path: string, expectedDuration?: number): Promise<AudioInfo> {
  const before = await stat(path);
  if (!before.isFile() || before.size === 0) throw new GBError("VERIFICATION_FAILED", "Audio file is missing or empty.");
  if (/\.wav$/i.test(path)) await verifyWaveContainer(path);
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_streams", "-show_format", "-of", "json", path], { timeout: 15000, maxBuffer: 1024 * 1024 });
  const probe = JSON.parse(stdout);
  const stream = probe.streams?.[0];
  const duration = Number(stream?.duration ?? probe.format?.duration);
  const sampleRate = Number(stream?.sample_rate), channels = Number(stream?.channels);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels < 1) {
    throw new GBError("VERIFICATION_FAILED", "Audio duration, sample rate or channels could not be verified.");
  }
  if (expectedDuration !== undefined && (!Number.isFinite(expectedDuration) || expectedDuration <= 0 || Math.abs(duration - expectedDuration) > Math.max(2 / sampleRate, .01))) {
    throw new GBError("VERIFICATION_FAILED", `Expected ${expectedDuration}s, decoded metadata reports ${duration}s.`);
  }
  await exec("ffmpeg", ["-v", "error", "-xerror", "-i", path, "-map", "0:a:0", "-f", "null", "-"], { timeout: Math.min(300000, Math.max(30000, duration * 1000)), maxBuffer: 1024 * 1024 });
  const after = await stat(path);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new GBError("VERIFICATION_FAILED", "Audio changed while being verified.");
  return { duration, sampleRate, channels, codec: stream.codec_name, bytes: after.size };
}

export interface ExportRange { startSeconds: number; endSeconds: number; exportOriginSeconds: number; fadeOutSeconds?: number }

export function rangeFilter(range: ExportRange, duration: number): { filter: string; duration: number } {
  const start = range.startSeconds - range.exportOriginSeconds;
  const end = range.endSeconds - range.exportOriginSeconds;
  const fade = range.fadeOutSeconds ?? 0;
  if (![range.startSeconds, range.endSeconds, range.exportOriginSeconds, fade, duration].every(Number.isFinite) ||
      range.exportOriginSeconds < 0 || start < 0 || end <= start || end > duration || fade < 0 || fade > end - start) {
    throw new GBError("INVALID_INPUT", "Range must lie within the verified export timeline; fade must fit the range.");
  }
  return { filter: `atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS${fade ? `,afade=t=out:st=${end - start - fade}:d=${fade}` : ""}`, duration: end - start };
}

export async function renderExportRange(input: string, output: string, range: ExportRange): Promise<AudioInfo> {
  const info = await validateAudioFile(input);
  const trim = rangeFilter(range, info.duration);
  await exec("ffmpeg", ["-v", "error", "-n", "-i", input, "-map", "0:a:0", "-af", trim.filter, "-c:a", "pcm_s24le", output], { timeout: 120000, maxBuffer: 1024 * 1024 });
  return validateAudioFile(output, trim.duration);
}
