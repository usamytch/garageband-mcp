import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// A real stdio handshake and schema check; never activates GarageBand or opens MIDI.
const client = new Client({ name: "fork-smoke", version: "1.0.0" });
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))], stderr: "pipe" });
const unbound = new Set(["gb_import_midi", "gb_imported_events", "gb_search_freesound", "gb_download_sample",
  "gb_all_notes_off", "gb_check_permissions", "gb_ui_state", "gb_list_projects", "gb_screenshot",
  "gb_launch", "gb_new_project", "gb_open_project", "gb_export_status", "gb_export_resume",
  "gb_check_audio_joins", "gb_mix_recipe"]);
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 68);
  for (const tool of tools) {
    assert.equal(Boolean(tool.inputSchema.required?.includes("projectPath")), !unbound.has(tool.name), tool.name);
  }
  for (const name of ["gb_set_track_volume_db", "gb_move_region", "gb_add_volume_automation", "gb_set_automation_view"]) {
    assert.ok(tools.some(tool => tool.name === name), name);
  }
  const rejected = await client.callTool({ name: "gb_set_track_volume_db", arguments: { trackIndex: 1, db: -6 } });
  assert.equal(rejected.isError, true);
  assert.match(JSON.stringify(rejected), /projectPath/);
  const catalog = "# Tool catalog\n\nGenerated from the built server by `node scripts/smoke.mjs --write-catalog`.\n\n" +
    "Project-bound tools require an absolute `projectPath` to an existing saved `.band` project. " +
    "`gb_open_project` takes `path` instead. Query MCP `tools/list` for complete argument schemas.\n\n" +
    "| Tool | Purpose | Requires projectPath |\n| --- | --- | --- |\n" +
    tools.map(tool => `| \`${tool.name}\` | ${(tool.title ?? "").replaceAll("|", "\\|")} | ${unbound.has(tool.name) ? "—" : "Yes"} |`).join("\n") + "\n";
  const path = new URL("../docs/tools.md", import.meta.url);
  if (process.argv.includes("--write-catalog")) await writeFile(path, catalog);
  else assert.equal(await readFile(path, "utf8"), catalog, "Refresh docs/tools.md after changing tool registrations.");
  console.log("PASS: stdio handshake, 68 tools, 52 explicit project targets, missing-target rejection, tool catalog.");
} finally {
  await client.close();
}
