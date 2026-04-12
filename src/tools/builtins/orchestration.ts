import { z } from "zod";
import type { ToolDefinition, SubAgentBrief } from "../../core/types.js";
import type { SubAgentManager } from "../../scheduler/sub-agent-manager.js";
import type { TaskScheduler } from "../../scheduler/task-scheduler.js";

export function orchestrationTools(subAgents: SubAgentManager, scheduler: TaskScheduler): ToolDefinition[] {
  return [
    {
      name: "open_subagent",
      description: "Create a bounded temporary sub-agent.",
      paramsSchema: z.object({
        task_id: z.string().optional(),
        goal: z.string().min(1),
        success_criteria: z.array(z.string()).default([]),
        workspace: z.string().default("default"),
        important_constraints: z.array(z.string()).default([]),
        file_scope: z.array(z.string()).default([]),
        agent_assignments: z.record(z.string()).default({}),
        shared_decisions: z.record(z.string()).default({}),
        open_questions: z.array(z.string()).default([])
      }),
      async execute(params) {
        const input = params as Omit<SubAgentBrief, "task_id"> & { task_id?: string };
        const task = input.task_id ? scheduler.ensureTask(input.task_id, input.goal, input.workspace) : scheduler.createTask(input.goal, input.workspace);
        const agent = subAgents.openSubAgent({ ...input, task_id: task.id });
        return { status: "ok", summary: `Opened sub-agent ${agent.id}.`, data: { agent } };
      }
    },
    {
      name: "contact",
      description: "Send a structured inbox message to another worker.",
      paramsSchema: z.object({
        senderId: z.string().optional(),
        recipientId: z.string(),
        type: z.string().default("note"),
        body: z.string(),
        taskId: z.string().optional()
      }),
      async execute(params, context) {
        const input = params as { senderId?: string; recipientId: string; type: string; body: string; taskId?: string };
        const message = subAgents.contact(input.senderId ?? context.actorId, input.recipientId, input.type, input.body, input.taskId ?? context.taskId);
        return { status: "ok", summary: `Sent ${message.type} message to ${message.recipientId}.`, data: { message } };
      }
    },
    {
      name: "stop",
      description: "Stop one sub-agent, one task, or all running work.",
      paramsSchema: z.object({
        scope: z.enum(["global", "task", "agent"]).default("task"),
        id: z.string().optional(),
        reason: z.string().default("stopped by request")
      }),
      async execute(params) {
        const input = params as { scope: "global" | "task" | "agent"; id?: string; reason: string };
        const stopped = subAgents.stop(input.scope, input.id, input.reason);
        return { status: "ok", summary: `Stopped ${stopped} sub-agent(s).`, data: { stopped } };
      }
    },
    {
      name: "list_subagents",
      description: "List current sub-agents and states.",
      paramsSchema: z.object({}),
      async execute() {
        const agents = subAgents.list();
        return { status: "ok", summary: `Listed ${agents.length} sub-agent(s).`, data: { agents } };
      }
    }
  ];
}
