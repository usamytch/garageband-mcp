import assert from "node:assert/strict";
import { test } from "node:test";
import { dataDirectory } from "../src/runtime-paths.js";

test("automation evidence uses user data or an explicit absolute directory", () => {
  assert.equal(dataDirectory({}, "/home/test"), "/home/test/Music/GarageBand MCP");
  assert.equal(dataDirectory({ GARAGEBAND_MCP_DATA_DIR: "/data/mix session" }), "/data/mix session");
  for (const path of ["", "relative", "~/Music", "../evidence"]) {
    assert.throws(() => dataDirectory({ GARAGEBAND_MCP_DATA_DIR: path }), { code: "INVALID_INPUT" });
  }
});
