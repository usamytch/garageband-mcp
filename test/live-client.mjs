import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const arrangement = (state) => state.tracks.map((track) => [track.index, track.name,
  track.regions.map((region) => [region.name, region.kind, region.startBar, region.endBar])]);

// Opt-in only. Both scenarios assert their exact fixture shape before editing.
export async function runFixture(project, scope, scenario) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(project, join(root, "fixtures/MCP-Mixer-Test.band"), "Pass the dedicated fixtures/MCP-Mixer-Test.band path.");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const evidence = join(root, "runtime", "live", `${scope}-${stamp}`);
  await mkdir(evidence, { recursive: true });
  const client = new Client({ name: "garageband-regression", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, "dist/index.js")], stderr: "pipe",
    env: { PATH: process.env.PATH, HOME: homedir(), TMPDIR: evidence, GARAGEBAND_MCP_DATA_DIR: evidence },
  });
  const results = [];
  async function call(name, args = {}, error = false) {
    args = { projectPath: project, ...args };
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
    results.push({ name, args, result });
    assert.equal(Boolean(result.isError), error, JSON.stringify(result));
    console.log(`${name}: ${error ? "rejected as expected" : "OK"}`);
    return result.content[0].text;
  }
  const json = async (name, args) => JSON.parse(await call(name, args));
  try {
    await client.connect(transport);
    assert.ok((await call("gb_list_projects")).includes(project));
    await scenario({ call, json, evidence, project });
    results.push({ passed: true });
    console.log(`PASS. Evidence and exports: ${evidence}`);
  } catch (error) {
    results.push({ failure: String(error) });
    throw error;
  } finally {
    await writeFile(join(evidence, "results.json"), JSON.stringify(results, null, 2));
    await client.close();
  }
}
