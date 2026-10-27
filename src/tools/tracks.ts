import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, guarded, GBError } from "../errors.js";
import * as ui from "../ui.js";
import { sleep } from "../osa.js";
import { scanGroup, type AxHit } from "../ax.js";
import { addTrack, readTracks, selectTrack, setTrackToggle } from "../track-state.js";

/** Track headers in the Tracks area, sorted top-to-bottom. */
async function listTrackHeaders(): Promise<AxHit[]> {
  const hits = await scanGroup(
    "Tracks",
    `role === 'AXLayoutItem' && /^track \\d/i.test(desc) && /^Track header\\./.test(String(el.attributes.byName('AXHelp').value()))`,
  );
  if (hits === null) {
    throw new GBError(
      "ELEMENT_NOT_FOUND",
      "Could not find the Tracks area in the window.",
      "Is a project open? gb_ui_state / gb_screenshot can show the current state.",
    );
  }
  return hits
    .filter((h) => h.pos && h.size)
    .sort((a, b) => a.pos![1] - b.pos![1]);
}

/** Click a track header (left side, near the name — clear of mute/solo/volume). */
async function clickTrackHeader(h: AxHit): Promise<void> {
  const index = Number(/^Track (\d+) /.exec(h.text)?.[1]);
  if (!Number.isInteger(index)) throw new GBError("ELEMENT_NOT_FOUND", "Track number not found in header.");
  await selectTrack(index);
}

export function registerTrackTools(server: McpServer): void {
  server.registerTool(
    "gb_add_software_instrument_track",
    {
      title: "Add software instrument track",
      description:
        "Add a new software-instrument track (the kind that receives MIDI from this server). Explicitly selects Software Instrument in the New Track dialog and verifies the new track count and selection.",
      inputSchema: {},
    },
    async () =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        const track = await addTrack("software");
        return ok(`Software-instrument track added and selected: ${JSON.stringify(track)}`);
      }),
  );

  server.registerTool(
    "gb_add_track",
    {
      title: "Add track (typed)",
      description:
        "Add a track of a specific type via the New Track dialog: 'software' (MIDI instrument — what this server records onto), 'drummer' (GarageBand's AI session drummer that plays by itself), or 'audio' (for recording audio input). The selected type, resulting track count, and selection are verified.",
      inputSchema: {
        type: z.enum(["software", "drummer", "audio"]),
      },
    },
    async ({ type }) =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        const track = await addTrack(type);
        return ok(`Added ${type} track: ${JSON.stringify(track)}`);
      }),
  );

  server.registerTool(
    "gb_delete_selected_track",
    {
      title: "Delete selected track",
      description: "Delete the currently selected track through the Track menu and verify the track count. Requires confirm: true.",
      inputSchema: {
        confirm: z.boolean().describe("Must be true to delete"),
      },
    },
    async ({ confirm }) =>
      guarded(async () => {
        if (!confirm) {
          throw new GBError("INVALID_INPUT", "Pass confirm: true to delete the selected track.");
        }
        await ui.ensureReady({ needsProject: true });
        const before = await readTracks();
        const selected = before.filter(track => track.selected);
        if (selected.length !== 1) throw new GBError("INVALID_INPUT", "Select exactly one track to delete.");
        await ui.clickMenu(["Track", "Delete Track"]);
        await sleep(400);
        const after = await readTracks();
        if (after.length !== before.length - 1) throw new GBError("VERIFICATION_FAILED", "Track deletion was not confirmed.");
        return ok(`Deleted track ${selected[0].index}: ${selected[0].name}. Remaining tracks: ${after.length}.`);
      }),
  );

  server.registerTool(
    "gb_list_tracks",
    {
      title: "List tracks",
      description:
        "List the project's tracks top-to-bottom by reading the Tracks area's accessibility tree. Use the indices with gb_select_track.",
      inputSchema: {},
    },
    async () =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        return ok(JSON.stringify(await readTracks(), null, 2));
      }),
  );

  server.registerTool(
    "gb_select_track",
    {
      title: "Select track",
      description:
        "Select a track. Use `index` (1 = top), or move relative to the currently selected track with `direction` and `count`. Selection is verified through accessibility.",
      inputSchema: {
        index: z.number().int().min(1).max(64).optional().describe("Track number from the top (preferred)"),
        direction: z.enum(["up", "down"]).optional().describe("Direction relative to the selected track"),
        count: z.number().int().min(1).max(32).optional().describe("Steps for direction mode (default 1)"),
      },
    },
    async ({ index, direction, count }) =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        let target = index;
        if (target === undefined) {
          if (!direction) throw new GBError("INVALID_INPUT", "Pass index or direction.");
          const tracks = await readTracks();
          const selected = tracks.filter(track => track.selected);
          if (selected.length !== 1) throw new GBError("INVALID_INPUT", "Direction mode requires exactly one selected track.");
          target = selected[0].index + (direction === "up" ? -1 : 1) * (count ?? 1);
        }
        return ok(JSON.stringify(await selectTrack(target), null, 2));
      }),
  );

  server.registerTool(
    "gb_set_track_instrument",
    {
      title: "Set track instrument",
      description:
        "Give the selected track an instrument by driving the Library: shows the Library, searches for the patch (e.g. \"Drum Kit\", \"Fingerstyle Bass\", \"Cinematic Strings\", \"Brass Section\"), clicks the best-matching result, then clears the search and clicks the track header to move focus back to the Tracks area. Pass trackIndex to select the track first. Do this BEFORE recording onto the track.",
      inputSchema: {
        instrument: z.string().min(2).describe("Patch name to search for in the Library"),
        trackIndex: z.number().int().min(1).max(64).optional().describe("Select this track first (1 = top)"),
      },
    },
    async ({ instrument, trackIndex }) =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        let header: AxHit | null = null;
        if (trackIndex !== undefined) {
          const headers = await listTrackHeaders();
          if (trackIndex > headers.length) {
            throw new GBError("INVALID_INPUT", `Track ${trackIndex} does not exist — found ${headers.length} tracks.`);
          }
          header = headers[trackIndex - 1];
          await clickTrackHeader(header);
        }

        // make sure the Library panel is visible ("Show Library" only exists while hidden)
        try {
          await ui.clickMenu(["View", "Show Library"]);
          await sleep(600);
        } catch (e) {
          if (!(e instanceof GBError && e.code === "MENU_NOT_FOUND")) throw e;
        }

        const fields = await scanGroup("Library", `role === 'AXTextField'`, 3);
        if (fields === null) {
          throw new GBError(
            "ELEMENT_NOT_FOUND",
            "Library panel not found in the window even after View ▸ Show Library.",
          );
        }
        const field = fields.find((f) => f.pos && f.size);
        if (!field) {
          throw new GBError(
            "ELEMENT_NOT_FOUND",
            "No search field found in the Library panel.",
            "gb_screenshot shows what the Library looks like on this version.",
          );
        }
        const fieldCenter: [number, number] = [
          field.pos![0] + field.size![0] / 2,
          field.pos![1] + field.size![1] / 2,
        ];
        await ui.clickAt(...fieldCenter);
        await sleep(250);
        await ui.keystroke("a", ["command"]);
        await ui.keystroke(instrument);
        await ui.keyCode(ui.KEY.RETURN);
        await sleep(1000);

        const rows = await scanGroup(
          "Library",
          `role === 'AXStaticText' && value.length > 1`,
          60,
        );
        const q = instrument.toLowerCase();
        const candidates = (rows ?? []).filter((r) => r.pos && r.size);
        const match =
          candidates.find((r) => r.text.toLowerCase() === q) ??
          candidates.find((r) => r.text.toLowerCase().includes(q)) ??
          candidates.find((r) => q.split(/\s+/).every((w) => r.text.toLowerCase().includes(w)));
        if (!match) {
          throw new GBError(
            "ELEMENT_NOT_FOUND",
            `No Library result matching "${instrument}". Texts visible: ${candidates
              .slice(0, 20)
              .map((r) => r.text)
              .join(" | ")}`,
            "Try a different search term (patch names vary by GarageBand sound library).",
          );
        }
        await ui.clickAt(match.pos![0] + match.size![0] / 2, match.pos![1] + match.size![1] / 2);
        await sleep(800);

        // clear the search and hand keyboard focus back to the Tracks area
        await ui.clickAt(...fieldCenter);
        await sleep(200);
        await ui.keystroke("a", ["command"]);
        await ui.keyCode(ui.KEY.DELETE);
        await ui.keyCode(ui.KEY.ESCAPE);
        await sleep(200);
        if (!header) {
          const headers = await listTrackHeaders().catch(() => []);
          header = headers.find((h) => h.pos && h.size) ?? null;
        }
        if (header) await clickTrackHeader(header);

        return ok(
          `Clicked Library patch "${match.text}"${trackIndex ? ` for track ${trackIndex}` : ""}. Search cleared and focus returned to the Tracks area. Verify the sound with gb_play_note.`,
        );
      }),
  );

  server.registerTool(
    "gb_mute_selected_track",
    {
      title: "Mute selected track",
      description: "Toggle mute on the selected track and verify the resulting checkbox state.",
      inputSchema: {},
    },
    async () =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        return ok(JSON.stringify(await setTrackToggle(undefined, "Mute"), null, 2));
      }),
  );

  server.registerTool(
    "gb_solo_selected_track",
    {
      title: "Solo selected track",
      description: "Toggle solo on the selected track and verify the resulting checkbox state.",
      inputSchema: {},
    },
    async () =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        return ok(JSON.stringify(await setTrackToggle(undefined, "Solo"), null, 2));
      }),
  );

  for (const control of ["Mute", "Solo"] as const) {
    server.registerTool(
      `gb_set_track_${control.toLowerCase()}`,
      {
        title: `Set track ${control.toLowerCase()}`,
        description: `Set ${control.toLowerCase()} to an explicit state on a track. Repeating the same request is safe; the resulting state is verified.`,
        inputSchema: {
          trackIndex: z.number().int().min(1).max(64),
          enabled: z.boolean(),
        },
      },
      async ({ trackIndex, enabled }) =>
        guarded(async () => {
          await ui.ensureReady({ needsProject: true });
          return ok(JSON.stringify(await setTrackToggle(trackIndex, control, enabled), null, 2));
        }),
    );
  }
}
