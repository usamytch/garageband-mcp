import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, guarded } from "../errors.js";
import * as ui from "../ui.js";
import { readTransport, setPlayback, setControlToggle, seekBar } from "../transport-state.js";

/**
 * Move to bar 1 beat 1 using the transport control and verify the LCD.
 * Cycle state is preserved. Playback must already be stopped.
 */
export async function rewindVerified(): Promise<number> {
  return seekBar(1);
}

export function registerTransportTools(server: McpServer): void {
  server.registerTool("gb_transport_state", {
    title: "Read transport", description: "Read verified playback, recording, cycle, metronome, count-in, playhead bar/beat and master fader.", inputSchema: {},
  }, async () => guarded(async () => {
    await ui.ensureReady({ needsProject: true });
    return ok(JSON.stringify(await readTransport(), null, 2));
  }));

  const simple: Array<{ name: string; title: string; description: string; act: () => Promise<unknown>; done: string }> = [
    {
      name: "gb_play",
      title: "Play",
      description: "Start playback and verify it. Repeating the call keeps playback running.",
      act: () => setPlayback(true),
      done: "Playback started (verified).",
    },
    {
      name: "gb_stop",
      title: "Stop",
      description: "Stop playback or recording and verify both are off. Repeating the call is safe.",
      act: () => setPlayback(false),
      done: "Transport stopped (verified).",
    },
    {
      name: "gb_record",
      title: "Record",
      description:
        "Start/stop recording on the selected track (R). For composing, prefer gb_record_sequence which handles timing end-to-end.",
      act: () => ui.keystroke("r"),
      done: "Record toggled.",
    },
    {
      name: "gb_toggle_cycle",
      title: "Toggle cycle",
      description: "Toggle the cycle/loop region (C).",
      act: () => setControlToggle("Cycle"),
      done: "Cycle region toggled.",
    },
    {
      name: "gb_toggle_metronome",
      title: "Toggle metronome",
      description: "Toggle the metronome click (K).",
      act: () => setControlToggle("Metronome Click"),
      done: "Metronome toggled.",
    },
    {
      name: "gb_toggle_count_in",
      title: "Toggle count-in",
      description: "Toggle the 1-bar count-in before recording (Shift+K).",
      act: () => setControlToggle("Count In"),
      done: "Count-in toggled.",
    },
    {
      name: "gb_undo",
      title: "Undo",
      description: "Undo the last GarageBand action (Cmd+Z) — a bad take, a wrong loop drop, a deleted track.",
      act: () => ui.keystroke("z", ["command"]),
      done: "Undo sent.",
    },
    {
      name: "gb_redo",
      title: "Redo",
      description: "Redo the last undone GarageBand action (Cmd+Shift+Z).",
      act: () => ui.keystroke("z", ["command", "shift"]),
      done: "Redo sent.",
    },
  ];

  for (const t of simple) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: {} },
      async () =>
        guarded(async () => {
          await ui.ensureReady({ needsProject: true });
          await t.act();
          return ok(t.done);
        }),
    );
  }

  server.registerTool(
    "gb_go_to_beginning",
    {
      title: "Go to beginning",
      description:
        "Move to bar 1 beat 1 and verify both LCD fields. Requires stopped transport; preserves cycle state.",
      inputSchema: {},
    },
    async () =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        await rewindVerified();
        return ok("Playhead at the beginning (verified).");
      }),
  );

  server.registerTool(
    "gb_set_playhead",
    {
      title: "Set playhead position",
      description:
        "Move the playhead to a bar by writing the LCD position slider — e.g. to record a layer starting at a later section. Verified by reading back.",
      inputSchema: {
        bar: z.number().int().min(1).max(9999).describe("Bar number (1 = project start)"),
      },
    },
    async ({ bar }) =>
      guarded(async () => {
        await ui.ensureReady({ needsProject: true });
        const pos = await seekBar(bar);
        return ok(`Playhead at bar ${pos}, beat 1 (verified).`);
      }),
  );
}
