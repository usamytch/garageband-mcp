import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { ok, guarded, GBError } from "../errors.js";
import * as ui from "../ui.js";
import { sleep } from "../osa.js";
import { runAX } from "../native-ax.js";
import { prepareExport, waitForFile } from "../export-file.js";
import { exportNormalization, withNormalization } from "../export-settings.js";
import { setPlayback, TRANSPORT_SCRIPT } from "../transport-state.js";
import { selectWholeSongExport } from "../export-range.js";
import type { SettingEvent } from "../settings-transaction.js";

export function registerExportTools(server: McpServer): void {
  server.registerTool(
    "gb_export_song",
    {
      title: "Export song to disk",
      description:
        "Export the whole song, wait for the export UI to finish and fully decode the resulting audio with FFmpeg. Checks finalized WAV chunks and stable file identity. Supports the English GarageBand export window. Existing files are rejected; choose a new filename.",
      inputSchema: {
        filename: z.string().min(1).describe("Filename without extension"),
        format: z.enum(["aac", "mp3", "aiff", "wav"]).describe("aac → .m4a, mp3 → .mp3, aiff → .aif, wav → .wav"),
        directory: z
          .string()
          .optional()
          .describe("Absolute destination directory (created if needed; default = ~/Music)"),
        waitTimeoutSec: z.number().int().min(10).max(1800).optional().describe("Default 300"),
        normalize: z.boolean().optional().describe("Auto Normalize for this export; original application setting is restored afterward. Omit to preserve it. False preserves mix headroom."),
      },
    },
    async args => guarded(async () => ok(JSON.stringify(await exportSong(args)))),
  );
}

export interface ExportOptions {
  filename: string; format: "aac" | "mp3" | "aiff" | "wav"; directory?: string; waitTimeoutSec?: number; normalize?: boolean;
  record?: (event: SettingEvent) => Promise<void>;
}

export async function exportComplete(): Promise<boolean> {
  return runAX(`
    if (scalar(window.element, 'AXTitle') === 'Export Song to Disk') return false;
    if (scan(window, el => scalar(el, 'AXRole') === 'AXSheet' || scalar(el, 'AXRole') === 'AXProgressIndicator').length) return false;
    group('Tracks');
    return true;
  `);
}

export async function exportSong({ filename, format, directory, waitTimeoutSec, normalize, record }: ExportOptions) {
  const destination = directory ?? join(homedir(), "Music");
  const target = await prepareExport(destination, filename, format);
  await ui.ensureReady({ needsProject: true });
  await runAX(`${TRANSPORT_SCRIPT} noSheet(); group('Tracks'); if (checked('Record')) fail('INVALID_INPUT', 'Stop recording before exporting.'); return true;`);
  await setPlayback(false);
  return withNormalization(normalize, exportNormalization, async (normalization) => {

    // menu item title uses a real ellipsis; fall back to three dots for safety
    try {
      await ui.clickMenu(["Share", "Export Song to Disk…"]);
    } catch (e) {
      if (e instanceof GBError && e.code === "MENU_NOT_FOUND") {
        await ui.clickMenu(["Share", "Export Song to Disk..."]);
      } else {
        throw e;
      }
    }

    await sleep(500);
    await runAX(`
      if (scalar(window.element, 'AXTitle') !== 'Export Song to Disk') fail('DIALOG_UNEXPECTED', 'The Export Song to Disk window did not appear.');
      const filenameField = one(scan(window, el => scalar(el, 'AXIdentifier') === 'saveAsNameTextField'), 'export filename');
      setText(filenameField, ${JSON.stringify(filename)});
      const format = one(scan(window, el => scalar(el, 'AXRole') === 'AXRadioButton' && scalar(el, 'AXTitle') === ${JSON.stringify(format === "wav" ? "WAVE" : format.toUpperCase())}), 'export format');
      if (Number(scalar(format.element, 'AXValue')) !== 1) press(format);
      if (Number(scalar(format.element, 'AXValue')) !== 1) fail('VERIFICATION_FAILED', 'Export format was not selected.');
      const range = one(scan(window, el => scalar(el, 'AXRole') === 'AXCheckBox' && /^Export cycle area/.test(scalar(el, 'AXTitle') || '')), 'export range checkbox');
      const selectWholeSongExport = ${selectWholeSongExport.toString()};
      selectWholeSongExport({
        read: () => ({ enabled: scalar(range.element, 'AXEnabled'), value: scalar(range.element, 'AXValue') }),
        click: () => press(range), wait: delay
      });
      key(5, $.kCGEventFlagMaskCommand | $.kCGEventFlagMaskShift);
      const location = one(scan(window, el => scalar(el, 'AXRole') === 'AXSheet'), 'Go to Folder sheet');
      const field = one(scan(location, el => scalar(el, 'AXRole') === 'AXTextField' || scalar(el, 'AXRole') === 'AXComboBox'), 'destination field');
      setText(field, ${JSON.stringify(destination)});
      key(36, 0);
      delay(0.5);
      if (scan(window, el => scalar(el, 'AXRole') === 'AXSheet').length) fail('DIALOG_UNEXPECTED', 'Destination navigation did not finish.');
      const where = one(scan(window, el => scalar(el, 'AXRole') === 'AXPopUpButton' && scalar(el, 'AXTitle') === 'Where:'), 'destination folder');
      if (scalar(where.element, 'AXValue') !== ${JSON.stringify(basename(destination))}) fail('VERIFICATION_FAILED', 'Export folder name does not match the destination.');
      if (scalar(filenameField.element, 'AXValue') !== ${JSON.stringify(filename)}) fail('VERIFICATION_FAILED', 'Export filename changed unexpectedly.');
      press(one(scan(window, el => scalar(el, 'AXRole') === 'AXButton' && scalar(el, 'AXTitle') === 'Export'), 'Export button'));
      return true;
    `);

    const audio = await waitForFile(target, (waitTimeoutSec ?? 300) * 1000, exportComplete);
    if (audio !== null) {
      return { path: target, audio, normalization };
    }
    throw new GBError(
      "EXPORT_TIMEOUT",
      `Export did not produce ${target} within ${waitTimeoutSec ?? 300}s.`,
      "Inspect the export window before retrying. No successful export has been confirmed.",
    );
  }, record);
}
