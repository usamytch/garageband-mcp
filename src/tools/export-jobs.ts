import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { join } from "node:path";
import { createExportJob, exportVariantSchema } from "../export-job.js";
import { exportJobStatus, launchExportWorker } from "../export-launch.js";
import { canonicalProjectPath } from "../project-guard.js";
import { dataDirectory } from "../runtime-paths.js";
import { guarded, ok } from "../errors.js";

export function registerExportJobTools(server: McpServer): void {
  const root = () => join(dataDirectory(), "exports", "jobs");
  server.registerTool("gb_export_start", {
    title: "Start a durable export batch",
    description: "Start a detached export worker. Its journal and shared GUI lock survive an MCP client disconnect. Reuse the same idempotencyKey for the same plan. Never overwrites outputs, saves a project or creates tracks. Use gb_export_status to observe completion.",
    inputSchema: { projectPath: z.string(), directory: z.string(), idempotencyKey: z.string(), jobs: z.array(exportVariantSchema).min(1).max(16) },
  }, args => guarded(async () => {
    const projectPath = await canonicalProjectPath(args.projectPath);
    const { job, created } = await createExportJob(root(), { projectPath, directory: args.directory, jobs: args.jobs }, args.idempotencyKey);
    return ok(JSON.stringify(created ? await launchExportWorker(root(), job.id) : await exportJobStatus(root(), job.id)));
  }));
  server.registerTool("gb_export_status", {
    title: "Read a durable export job",
    description: "Read persisted export progress without touching GarageBand. Reports worker/process-group liveness, incomplete restoration and retained completed files. A timeout or interrupted job is not proof that no render happened.",
    annotations: { readOnlyHint: true }, inputSchema: { jobId: z.string() },
  }, ({ jobId }) => guarded(async () => ok(JSON.stringify(await exportJobStatus(root(), jobId)))));
  server.registerTool("gb_export_resume", {
    title: "Resume or restore an interrupted export",
    description: "Continue the recorded job without re-rendering completed outputs or blindly resubmitting an ambiguous render. The original saved project must be open. An active native child blocks recovery. action=restore only restores recorded settings and abandons remaining work, preserving files. Uncertain or partial files remain for inspection.",
    inputSchema: { jobId: z.string(), action: z.enum(["continue", "restore"]).default("continue") },
  }, ({ jobId, action }) => guarded(async () => ok(JSON.stringify(await launchExportWorker(root(), jobId, action)))));
}
