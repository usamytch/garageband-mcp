import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, guarded } from "../errors.js";
import * as ui from "../ui.js";
import { setMasterVolume, setTrackSlider, setTrackDecibels } from "../track-state.js";
import { setControlToggle } from "../transport-state.js";
import { readSmartControls, setSmartControl } from "../smart-state.js";

export function registerMixTools(server: McpServer): void {
  server.registerTool(
    "gb_set_track_volume",
    {
      title: "Set track volume",
      description:
        "Set a track's volume as a percentage of its actual accessibility range, rounded to a supported step. This is fader position, not dB. Returns the verified raw value and range.",
      inputSchema: {
        trackIndex: z.number().int().min(1).max(64).describe("Track number from the top"),
        level: z.number().min(0).max(100).describe("0 = minimum, 100 = maximum; percentage of the fader range, not dB"),
      },
    },
    async ({ trackIndex, level }) =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        return ok(JSON.stringify(await setTrackSlider(trackIndex, "volume", level), null, 2));
      }),
  );

  server.registerTool(
    "gb_set_track_pan",
    {
      title: "Set track pan",
      description: "Set a track's pan knob via accessibility: -100 = hard left, 0 = center, 100 = hard right.",
      inputSchema: {
        trackIndex: z.number().int().min(1).max(64),
        pan: z.number().min(-100).max(100),
      },
    },
    async ({ trackIndex, pan }) =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        return ok(JSON.stringify(await setTrackSlider(trackIndex, "pan", pan), null, 2));
      }),
  );

  server.registerTool(
    "gb_set_master_volume",
    {
      title: "Set master volume",
      description: "Set master output volume to 0-100 percent of its actual slider range and return the settled value (GarageBand quantizes it to 127 steps). This is fader position, not dB.",
      inputSchema: {
        level: z.number().min(0).max(100),
      },
    },
    async ({ level }) =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        return ok(JSON.stringify(await setMasterVolume(level), null, 2));
      }),
  );

  server.registerTool(
    "gb_toggle_smart_controls",
    {
      title: "Toggle Smart Controls",
      description:
        "Show/hide the Smart Controls pane (B) — the knobs that shape the selected track's sound: filter cutoff/resonance, envelope attack/release, effects sends. Open it, then gb_list_smart_controls to see what this patch exposes.",
      inputSchema: {},
    },
    async () =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        return ok(`Smart Controls open: ${await setControlToggle("Smart Controls")} (verified).`);
      }),
  );

  server.registerTool("gb_list_smart_controls", {
    title: "List Smart Controls",
    description: "Open track Smart Controls and return effect knobs/toggles, ranges, displayed values and selected track. Automatically selects Track/Controls tabs; never edits master effects.",
    inputSchema: { trackIndex: z.number().int().min(1).max(64).optional() },
  }, async ({ trackIndex }) => guarded(async () => {
    await ui.ensureReady({ needsProject: true });
    return ok(JSON.stringify(await readSmartControls(trackIndex), null, 2));
  }));

  server.registerTool("gb_set_smart_control", {
    title: "Set Smart Control",
    description: "Set a normalized effect knob on a specified track and verify readback. Exact name takes priority; ambiguous substrings are rejected. Discover names/ranges with gb_list_smart_controls.",
    inputSchema: { trackIndex: z.number().int().min(1).max(64).optional(), control: z.string().min(2), value: z.number().min(0).max(1) },
  }, async ({ trackIndex, control, value }) => guarded(async () => {
    await ui.ensureReady({ needsProject: true });
    return ok(JSON.stringify(await setSmartControl(control, value, trackIndex), null, 2));
  }));

  server.registerTool("gb_set_smart_switch", {
    title: "Set Smart Controls switch",
    description: "Set an effect checkbox by exact/unique name on a specified track and verify. enabled means checked. GarageBand's misleading 'Bypass Compressor' label has checked=true when the compressor is ACTIVE in the tested audio patch. Do not infer effect state from the word Bypass alone.",
    inputSchema: { trackIndex: z.number().int().min(1).max(64), control: z.string().min(2), enabled: z.boolean() },
  }, async ({ trackIndex, control, enabled }) => guarded(async () => {
    await ui.ensureReady({ needsProject: true });
    return ok(JSON.stringify(await setSmartControl(control, enabled, trackIndex), null, 2));
  }));

  server.registerTool("gb_set_track_volume_db", {
    title: "Set track volume in dB",
    description: "Set a track fader using the application's actual dB readback, within 0.3 dB. Does not assume a raw fader curve. Supports decimal comma or decimal point.",
    inputSchema: { trackIndex: z.number().int().min(1).max(64), db: z.number().min(-60).max(6) },
  }, async ({ trackIndex, db }) => guarded(async () => {
    await ui.ensureReady({ needsProject: true });
    return ok(JSON.stringify(await setTrackDecibels(trackIndex, db), null, 2));
  }));
}
