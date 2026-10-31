import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { errorResult, GBError } from "./errors.js";
import { GuiQueue, acquireGuiLock, defaultGuiLockPath } from "./gui-queue.js";
import { canonicalProjectPath, verifyProject } from "./project-guard.js";
import { operationContext } from "./operation-context.js";
import { checkExportRecovery } from "./export-recovery.js";

const INDEPENDENT = new Set(["gb_import_midi", "gb_imported_events", "gb_search_freesound", "gb_download_sample", "gb_all_notes_off", "gb_export_start", "gb_export_status", "gb_export_resume", "gb_check_audio_joins", "gb_mix_recipe", "gb_mix_audio", "gb_vocal_process"]);
const DISCOVERY = new Set(["gb_check_permissions", "gb_ui_state", "gb_list_projects", "gb_screenshot", "gb_launch", "gb_new_project", "gb_open_project"]);
const projectPath = z.string().describe("Absolute path to the saved .band project. Checked after waiting in the GUI queue and before every native script. Use gb_list_projects to discover it.");
type Config = Omit<Parameters<McpServer["registerTool"]>[1], "inputSchema"> & { inputSchema?: ZodRawShape };

export function installGuiGuard(server: McpServer, options: {
  queue?: GuiQueue;
  canonicalize?: typeof canonicalProjectPath;
  verify?: typeof verifyProject;
} = {}): void {
  const queue = options.queue ?? new GuiQueue((signal) => acquireGuiLock(defaultGuiLockPath, signal));
  const canonicalize = options.canonicalize ?? canonicalProjectPath;
  const verify = options.verify ?? verifyProject;
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: Config, callback: ToolCallback<ZodRawShape>) => {
    if (INDEPENDENT.has(name)) return register(name, config, callback);
    const targeted = !DISCOVERY.has(name);
    if (config.inputSchema && Object.values(config.inputSchema).some((schema) => !schema || typeof schema !== "object" || !("parse" in schema))) {
      throw new Error("GUI tools must register an object input schema.");
    }
    return register(name, {
      ...config,
      inputSchema: { ...config.inputSchema, ...(targeted ? { projectPath } : {}) } as ZodRawShape,
    }, async (args, extra) => queue.run(async () => {
      await checkExportRecovery(name);
      if (!targeted) {
        const target = name === "gb_open_project" ? await canonicalize(String(args.path)) : null;
        const result = await callback(args, extra);
        if (target && !result.isError) await verify(target);
        return result;
      }
      const target = await canonicalize(String(args.projectPath));
      await verify(target);
      return operationContext.run({ projectPath: target, verify: () => verify(target) }, async () => {
        const result = await callback(args, extra);
        if (name !== "gb_close_project") await verify(target);
        if (extra.signal.aborted) throw new GBError("OPERATION_CANCELLED", "Operation was cancelled; inspect project state before retrying.");
        return result;
      });
    }, extra.signal).catch(errorResult));
  }) as McpServer["registerTool"];
}
