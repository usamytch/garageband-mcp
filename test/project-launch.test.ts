import assert from "node:assert/strict";
import { test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerProjectTools } from "../src/tools/project.js";
import * as gb from "../src/applescript.js";
import * as ui from "../src/ui.js";
import { GBError } from "../src/errors.js";

test("launch reports unavailable GUI instead of success, and avoids document queries while the chooser is modal", async () => {
  const server = new McpServer({ name: "launch-test", version: "1" });
  let ready = false, chooser = false;
  const events: string[] = [];
  registerProjectTools(server, {
    gb: { ...gb,
      launchAndWait: async () => { events.push("launch"); },
      chooserOpen: async () => { events.push("chooser"); return chooser; },
      documentCount: async () => { events.push("documents"); return 1; },
    },
    ui: { ...ui, ensureReady: async () => {
      events.push("ready");
      if (!ready) throw new GBError("NOT_FRONTMOST", "Desktop unavailable");
    } },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await server.connect(a);
  await client.connect(b);
  const launch = () => client.callTool({ name: "gb_launch", arguments: {} });
  try {
    const blocked = await launch();
    assert.equal(blocked.isError, true);
    assert.match(JSON.stringify(blocked), /NOT_FRONTMOST/);
    assert.deepEqual(events, ["launch", "ready"]);
    ready = true;
    events.length = 0;
    const opened = await launch();
    assert.equal(opened.isError, undefined);
    assert.match(JSON.stringify(opened), /running and frontmost/);
    assert.deepEqual(events, ["launch", "ready", "chooser", "documents"]);
    chooser = true;
    events.length = 0;
    assert.match(JSON.stringify(await launch()), /project chooser/);
    assert.deepEqual(events, ["launch", "ready", "chooser"]);
  } finally {
    await client.close();
    await server.close();
  }
});
