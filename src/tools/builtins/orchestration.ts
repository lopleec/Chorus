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
      description: "Send a structured inbox message between main/sub agents, or between sub-agents.",
      paramsSchema: z.object({
        senderId: z.string().optional(),
        recipientId: z.string().optional(),
        recipientIds: z.array(z.string()).default([]),
        type: z.string().default("note"),
        body: z.string(),
        taskId: z.string().optional()
      }),
      async execute(params, context) {
        const input = params as { senderId?: string; recipientId?: string; recipientIds: string[]; type: string; body: string; taskId?: string };
        const senderId = input.senderId ?? context.subAgentId ?? context.actorId;
        const requestedRecipients = input.recipientId ? [input.recipientId, ...input.recipientIds] : input.recipientIds;
        const recipients = [...new Set(requestedRecipients.length ? requestedRecipients : ["main"])];
        const messages = recipients.map((recipientId) => subAgents.contact(senderId, recipientId, input.type, input.body, input.taskId ?? context.taskId));
        return { status: "ok", summary: `Sent ${messages.length} ${input.type} message(s).`, data: { messages } };
      }
    },
    {
      name: "read_inbox",
      description: "Read the main-agent or sub-agent inbox, optionally marking messages as read.",
      paramsSchema: z.object({
        recipientId: z.string().optional(),
        unreadOnly: z.boolean().default(false),
        markRead: z.boolean().default(false),
        messageIds: z.array(z.string()).optional()
      }),
      async execute(params, context) {
        const input = params as { recipientId?: string; unreadOnly: boolean; markRead: boolean; messageIds?: string[] };
        const recipientId = input.recipientId ?? context.subAgentId ?? context.actorId ?? "main";
        const messages = subAgents.inbox(recipientId, { unreadOnly: input.unreadOnly });
        const marked = input.markRead ? subAgents.markInboxRead(recipientId, input.messageIds) : 0;
        return { status: "ok", summary: `Read ${messages.length} inbox message(s) for ${recipientId}.`, data: { recipientId, messages, markedRead: marked } };
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
