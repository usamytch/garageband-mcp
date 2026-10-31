import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
import { guarded, ok, GBError } from "../errors.js";
import { outputDirectory } from "../export-job.js";

const exec = promisify(execFile);

async function runOffline(script: string, inputFlag: string, input: string, output?: string) {
  if (!isAbsolute(input)) throw new GBError("INVALID_INPUT", "Use an absolute input JSON path.");
  const destination = output === undefined ? undefined : await outputDirectory(output);
  // Bundles live in dist/; source execution lives in src/tools/.
  const base = import.meta.url.endsWith("/offline-audio.ts") ? "../../scripts/audio_edit/" : "../scripts/audio_edit/";
  const path = fileURLToPath(new URL(base + script, import.meta.url));
  const args = [path, inputFlag, input, ...(destination ? ["--output", destination] : [])];
  const { stdout } = await exec(process.env.GARAGEBAND_MCP_PYTHON ?? "python3", args,
    { timeout: 300000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout);
}

export function registerOfflineAudioTools(server: McpServer): void {
  server.registerTool("gb_check_audio_joins", {
    title: "Review audio joins without modifying sources",
    description: "Read a versioned JSON request with SHA-256-identified candidate/reference WAVs, sample-based joins and protected phrase mappings. Produces per-channel diagnostics and bounded listening previews in a new directory outside project packages. Numerical findings are review candidates, not listening approval. Requires Python with NumPy and FFmpeg.",
    inputSchema: { requestPath: z.string(), outputDirectory: z.string() },
  }, ({ requestPath, outputDirectory }) => guarded(async () => ok(JSON.stringify(await runOffline("join_review.py", "--request", requestPath, outputDirectory)))));
  server.registerTool("gb_mix_recipe", {
    title: "Validate or render a reproducible stereo mix recipe",
    description: "Validate identified assets, project-zero timing, channel matrices and gains from recipe JSON. Render creates new 24-bit WAVs and a receipt; sources and DAW projects remain unchanged. Omit outputDirectory for validation only. Never overwrites existing outputs. Requires Python with NumPy and FFmpeg.",
    inputSchema: { recipePath: z.string(), outputDirectory: z.string().optional() },
  }, ({ recipePath, outputDirectory }) => guarded(async () => ok(JSON.stringify(await runOffline("mix_recipe.py", "--recipe", recipePath, outputDirectory)))));
}
