import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { guarded, ok } from "../errors.js";
import * as ui from "../ui.js";
import { moveRegion, readRegions } from "../region-state.js";

export function registerRegionTools(server: McpServer): void {
  server.registerTool("gb_list_regions", {
    title: "List regions",
    description: "Read track/region names, type, whole-bar boundaries, selection, and current region IDs. Null boundaries mean unsupported timing; those regions cannot be moved. IDs must be refreshed after edits.",
    inputSchema: {},
  }, async () => guarded(async () => {
    await ui.ensureReady({ needsProject: true });
    return ok(JSON.stringify(await readRegions(), null, 2));
  }));

  server.registerTool("gb_move_region", {
    title: "Move region by bars or between tracks",
    description: "Move one audio/MIDI region to an absolute bar and optionally another compatible track. Requires a saved project, English UI, stopped transport, whole-bar region boundaries, and visible source/destination. Refuses overlaps and stale IDs; verifies all region positions and lengths with fresh reads. Drummer/looped/partial-bar regions are not supported. Call tools sequentially during a move.",
    inputSchema: {
      regionId: z.string().regex(/^[a-f0-9]{20}$/).describe("Current ID returned by gb_list_regions"),
      toBar: z.number().int().min(1).max(9999),
      targetTrackIndex: z.number().int().min(1).max(64).optional(),
    },
  }, async ({ regionId, toBar, targetTrackIndex }) => guarded(async () => {
    await ui.ensureReady({ needsProject: true });
    return ok(JSON.stringify(await moveRegion(regionId, toBar, targetTrackIndex), null, 2));
  }));
}
