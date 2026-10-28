import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { guarded, ok } from "../errors.js";
import { writeVolumeAutomation } from "../automation-state.js";
import { setAutomationView } from "../automation-view.js";
import * as ui from "../ui.js";

export function registerAutomationTools(server: McpServer): void {
  server.registerTool("gb_set_automation_view", {
    title: "Show or hide track automation",
    description: "Set automation visibility explicitly and verify the resulting view. Repeated requests are idempotent. Hides automation before region inspection when visible lanes have unreliable labels. Does not enable, disable, or edit automation curves. Requires at least one track and English UI.",
    inputSchema: { visible: z.boolean() },
  }, async ({ visible }) => guarded(async () => {
    await ui.ensureReady({ needsProject: true });
    return ok(JSON.stringify(await setAutomationView(visible), null, 2));
  }));

  server.registerTool("gb_add_volume_automation", {
    title: "Draw volume automation on a fresh copy",
    description: "Experimental: draw a modest volume curve in an EMPTY visible Volume lane of a stopped 4/4 project. Uses screen capture plus native Accessibility geometry and fader readback. Never deletes existing curves. Requires a fresh project copy and subsequent WAV verification; points themselves are not exposed by GarageBand Accessibility. Times are zero-based quarter-note beats, quantized to visible pixels, not sample accurate.",
    inputSchema: {
      trackIndex: z.number().int().min(1).max(64), expectedTrackName: z.string().min(1),
      confirmEmptyVolumeLaneOnCopy: z.literal(true).describe("Confirm this is a disposable copy and the target has no existing volume automation."),
      points: z.array(z.object({ beat: z.number().finite().min(0), db: z.number().finite().min(-20).max(0) })).min(2).max(64),
    },
  }, async ({ trackIndex, expectedTrackName, points }) => guarded(async () => ok(JSON.stringify(await writeVolumeAutomation(trackIndex, expectedTrackName, points), null, 2))));
}
