import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { GBError } from "./errors.js";

/** Evidence belongs in user data, independently of where the server is installed. */
export function dataDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const configured = env.GARAGEBAND_MCP_DATA_DIR;
  if (configured !== undefined) {
    if (!isAbsolute(configured)) throw new GBError("INVALID_INPUT", "GARAGEBAND_MCP_DATA_DIR must be an absolute directory path.");
    return configured;
  }
  return join(home, "Music", "GarageBand MCP");
}
