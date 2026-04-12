import { ZodError } from "zod";
import type { OperationLog } from "../data/operation-log.js";
import type { OperationRecord, ToolContext, ToolDefinition, ToolResult } from "../core/types.js";
import { createId } from "../core/ids.js";
import { summarizeForLog } from "../core/json.js";
import { nowIso } from "../core/time.js";
import type { TaskScheduler } from "../scheduler/task-scheduler.js";

export class ToolGateway {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();

  constructor(
    private readonly operationLog: OperationLog,
    private readonly scheduler?: TaskScheduler
  ) {}

  register(tool: ToolDefinition<unknown, unknown>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  list(): Array<{ name: string; description: string }> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description
    }));
  }

  async execute(name: string, params: unknown, context: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const tool = this.tools.get(name);
    if (!tool) {
      return this.finish(name, params, context, started, {
        status: "error",
        summary: `Unknown tool: ${name}`,
        error: `Unknown tool: ${name}`
      });
    }

    try {
      const parsed = tool.paramsSchema.parse(params);
      const result = await tool.execute(parsed, context);
      this.scheduler?.recordToolActivity(context, name, parsed, result.status);
      return this.finish(name, parsed, context, started, result);
    } catch (error) {
      const message = error instanceof ZodError ? error.issues.map((issue) => issue.message).join("; ") : (error as Error).message;
      return this.finish(name, params, context, started, {
        status: "error",
        summary: `Tool ${name} failed before completion.`,
        error: message
      });
    }
  }

  private finish(name: string, params: unknown, context: ToolContext, started: number, result: ToolResult): ToolResult {
    const record: OperationRecord = {
      id: createId("op"),
      at: nowIso(),
      actorId: context.actorId,
      actorRole: context.actorRole,
      taskId: context.taskId,
      subAgentId: context.subAgentId,
      toolName: name,
      inputSummary: summarizeForLog(params),
      status: result.status,
      summary: result.summary,
      durationMs: Date.now() - started,
      risk: result.risk,
      error: result.error
    };
    this.operationLog.append(record);
    return result;
  }
}
