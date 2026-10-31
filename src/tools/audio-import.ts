import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { guarded, ok } from "../errors.js";
import { importAudio } from "../audio-import.js";

export function registerAudioImportTools(server: McpServer): void {
  server.registerTool("gb_import_audio", {
    title: "Import verified WAV at bar 1",
    description: "Import a SHA-256-identified WAV into a named existing empty audio track at bar 1. Verifies one region, unchanged neighbors and identical WAV format/audio samples in project media. Uses a visible Finder drag with button/window cleanup. Requires stopped transport and room for Finder. Never saves or creates a project. On partial failure inspect the journal before retrying.",
    inputSchema: { path: z.string(), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/), trackIndex: z.number().int().min(1), trackName: z.string().min(1) },
  }, async ({ path, expectedSha256, trackIndex, trackName }) => guarded(async () => ok(JSON.stringify(await importAudio(path, expectedSha256, trackIndex, trackName)))));
}
