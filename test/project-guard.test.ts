import assert from "node:assert/strict";
import { test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { GuiQueue } from "../src/gui-queue.js";
import { installGuiGuard } from "../src/guarded-server.js";
import { verifyProject } from "../src/project-guard.js";
import { operationContext } from "../src/operation-context.js";
import { ok } from "../src/errors.js";

test("MCP enforces explicit targets, checks after queue wait, bypasses panic and recovers from mismatch", async () => {
  const server = new McpServer({ name: "test", version: "1" });
  let current = "/A.band";
  let touched = 0;
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((done) => { release = done; });
  const ready = new Promise<void>((done) => { entered = done; });
  installGuiGuard(server, {
    queue: new GuiQueue(async () => async () => {}), canonicalize: async (path) => path,
    verify: (expected) => verifyProject(expected, async () => current),
  });
  server.registerTool("edit", { inputSchema: { wait: z.boolean().optional() } }, async ({ wait }) => {
    touched++;
    if (wait) { entered(); await blocked; }
    return ok("edited");
  });
  server.registerTool("gb_all_notes_off", { inputSchema: {} }, async () => ok("panic"));
  server.registerTool("gb_list_projects", { inputSchema: {} }, async () => ok(current));
  server.registerTool("gb_close_project", { inputSchema: {} }, async () => { current = ""; return ok("closed"); });
  server.registerTool("gb_open_project", { inputSchema: { path: z.string() } }, async ({ path }) => { current = path; return ok("opened"); });
  server.registerTool("two_steps", { inputSchema: {} }, async () => {
    current = "/B.band";
    await operationContext.getStore()!.verify();
    touched++;
    return ok("should not run");
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await server.connect(a);
  await client.connect(b);
  const call = (name: string, args = {}) => client.callTool({ name, arguments: args });
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.find((t) => t.name === "edit")!.inputSchema.required?.includes("projectPath"));
    assert.equal((await call("edit")).isError, true);
    assert.equal(touched, 0);
    const first = call("edit", { projectPath: "/A.band", wait: true });
    await ready;
    const queued = call("edit", { projectPath: "/A.band" });
    assert.equal((await call("gb_all_notes_off")).isError, undefined, "panic must not wait for a performance");
    current = "/B.band";
    release();
    assert.equal((await first).isError, true, "detect a project switch during a command");
    assert.match(JSON.stringify(await queued), /WRONG_PROJECT/);
    assert.equal(touched, 1, "queued operation must not touch the wrong project");
    assert.equal((await call("edit", { projectPath: "/B.band" })).isError, undefined);
    assert.equal((await call("gb_close_project", { projectPath: "/B.band" })).isError, undefined);
    assert.equal((await call("gb_open_project", { path: "/A.band" })).isError, undefined);
    assert.match(JSON.stringify(await call("two_steps", { projectPath: "/A.band" })), /WRONG_PROJECT/);
    assert.equal(touched, 2, "the second native step must not run after a target switch");
  } finally {
    release();
    await client.close();
    await server.close();
  }
});
