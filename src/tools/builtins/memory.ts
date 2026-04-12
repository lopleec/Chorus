import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";
import type { MemoryStore } from "../../memory/memory-store.js";

export function memoryTool(memoryStore: MemoryStore): ToolDefinition {
  return {
    name: "memory",
    description: "Add, search, or prune structured long-term memory.",
    paramsSchema: z.object({
      action: z.enum(["add", "search", "prune"]),
      scope: z.enum(["global", "workspace"]).optional(),
      workspace: z.string().optional(),
      kind: z.enum(["world_fact", "belief", "experience", "summary"]).optional(),
      summary: z.string().optional(),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
      weight: z.number().optional(),
      confidence: z.number().optional(),
      ttl_expires_at: z.string().nullable().optional(),
      keyword: z.string().optional(),
      topK: z.number().int().positive().optional()
    }),
    async execute(params, context) {
      const input = params as {
        action: "add" | "search" | "prune";
        scope?: "global" | "workspace";
        workspace?: string;
        kind?: "world_fact" | "belief" | "experience" | "summary";
        summary?: string;
        body?: string;
        tags?: string[];
        weight?: number;
        confidence?: number;
        ttl_expires_at?: string | null;
        keyword?: string;
        topK?: number;
      };
      if (input.action === "add") {
        if (!input.summary || !input.kind) {
          return { status: "error", summary: "memory add requires summary and kind.", error: "Missing summary or kind." };
        }
        const entry = memoryStore.add({
          scope: input.scope ?? (input.workspace ? "workspace" : "global"),
          workspace: input.workspace ?? null,
          kind: input.kind,
          summary: input.summary,
          body: input.body,
          tags: input.tags,
          weight: input.weight,
          confidence: input.confidence,
          ttl_expires_at: input.ttl_expires_at,
          source_task_id: context.taskId
        });
        return { status: "ok", summary: `Stored memory ${entry.id}.`, data: { entry } };
      }
      if (input.action === "prune") {
        const result = memoryStore.prune();
        return { status: "ok", summary: `Pruned ${result.pruned} memory entrie(s).`, data: result };
      }
      const results = memoryStore.search({
        keyword: input.keyword,
        workspace: input.workspace,
        tags: input.tags,
        topK: input.topK
      }, { actorId: context.actorId, taskId: context.taskId });
      return { status: "ok", summary: `Recalled ${results.length} memory entrie(s).`, data: { results } };
    }
  };
}
