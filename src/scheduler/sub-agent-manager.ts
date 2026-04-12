import type { ChorusDatabase } from "../data/sqlite.js";
import type { InboxMessage, SubAgentBrief, SubAgentRecord, TaskStatus } from "../core/types.js";
import { createId } from "../core/ids.js";
import { parseJsonObject } from "../core/json.js";
import { nowIso } from "../core/time.js";
import type { TaskScheduler } from "./task-scheduler.js";

interface SubAgentRow {
  id: string;
  task_id: string;
  role: "sub";
  status: TaskStatus;
  brief_json: string;
  current_action: string | null;
  created_at: string;
  updated_at: string;
}

interface InboxRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  task_id: string | null;
  type: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export class SubAgentManager {
  constructor(
    private readonly database: ChorusDatabase,
    private readonly scheduler: TaskScheduler
  ) {}

  openSubAgent(brief: SubAgentBrief): SubAgentRecord {
    this.scheduler.ensureTask(brief.task_id, brief.goal, brief.workspace);
    const id = createId("sub");
    const at = nowIso();
    this.database.db
      .prepare(
        `INSERT INTO sub_agents
          (id, task_id, role, status, brief_json, current_action, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, brief.task_id, "sub", "queued", JSON.stringify(brief), null, at, at);
    this.scheduler.appendTaskEvent(brief.task_id, { type: "subagent.opened", subAgentId: id, brief, at });
    return {
      id,
      taskId: brief.task_id,
      role: "sub",
      status: "queued",
      brief,
      currentAction: null,
      createdAt: at,
      updatedAt: at
    };
  }

  list(): SubAgentRecord[] {
    const rows = this.database.db.prepare("SELECT * FROM sub_agents ORDER BY created_at DESC").all() as unknown as SubAgentRow[];
    return rows.map(mapSubAgent);
  }

  get(id: string): SubAgentRecord | null {
    const row = this.database.db.prepare("SELECT * FROM sub_agents WHERE id = ?").get(id) as SubAgentRow | undefined;
    return row ? mapSubAgent(row) : null;
  }

  setStatus(id: string, status: TaskStatus, currentAction?: string | null): void {
    const agent = this.get(id);
    const at = nowIso();
    this.database.db
      .prepare("UPDATE sub_agents SET status = ?, current_action = COALESCE(?, current_action), updated_at = ? WHERE id = ?")
      .run(status, currentAction ?? null, at, id);
    if (agent) {
      this.scheduler.appendTaskEvent(agent.taskId, { type: "subagent.status", subAgentId: id, status, currentAction, at });
    }
  }

  contact(senderId: string, recipientId: string, type: string, body: string, taskId?: string): InboxMessage {
    const id = createId("inbox");
    const at = nowIso();
    this.database.db
      .prepare(
        "INSERT INTO subagent_inbox (id, sender_id, recipient_id, task_id, type, body, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(id, senderId, recipientId, taskId ?? null, type, body, at, null);
    if (taskId) {
      this.scheduler.appendTaskEvent(taskId, { type: "inbox.message", id, senderId, recipientId, messageType: type, at });
    }
    return { id, senderId, recipientId, taskId, type, body, createdAt: at, readAt: null };
  }

  inbox(recipientId: string): InboxMessage[] {
    const rows = this.database.db
      .prepare("SELECT * FROM subagent_inbox WHERE recipient_id = ? ORDER BY created_at ASC")
      .all(recipientId) as unknown as InboxRow[];
    return rows.map(mapInbox);
  }

  stop(scope: "global" | "task" | "agent", id?: string, reason = "stopped"): number {
    const at = nowIso();
    if (scope === "global") {
      const agents = this.list().filter((agent) => isActive(agent.status));
      this.database.db.prepare("UPDATE sub_agents SET status = ?, current_action = ?, updated_at = ? WHERE status IN ('queued', 'running', 'blocked')").run("stopped", reason, at);
      this.database.db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE status IN ('queued', 'running', 'blocked')").run("stopped", at);
      for (const agent of agents) {
        this.scheduler.appendTaskEvent(agent.taskId, { type: "subagent.stopped", subAgentId: agent.id, reason, at });
      }
      return agents.length;
    }
    if (!id) {
      return 0;
    }
    if (scope === "task") {
      const agents = this.list().filter((agent) => agent.taskId === id && isActive(agent.status));
      this.database.db
        .prepare("UPDATE sub_agents SET status = ?, current_action = ?, updated_at = ? WHERE task_id = ? AND status IN ('queued', 'running', 'blocked')")
        .run("stopped", reason, at, id);
      this.scheduler.setStatus(id, "stopped", reason);
      return agents.length;
    }

    const agent = this.get(id);
    if (!agent || !isActive(agent.status)) {
      return 0;
    }
    this.setStatus(id, "stopped", reason);
    return 1;
  }
}

function isActive(status: TaskStatus): boolean {
  return status === "queued" || status === "running" || status === "blocked";
}

function mapSubAgent(row: SubAgentRow): SubAgentRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    role: row.role,
    status: row.status,
    brief: parseJsonObject<SubAgentBrief>(row.brief_json, {
      task_id: row.task_id,
      goal: "",
      success_criteria: [],
      workspace: "",
      important_constraints: [],
      file_scope: [],
      agent_assignments: {},
      shared_decisions: {},
      open_questions: []
    }),
    currentAction: row.current_action,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapInbox(row: InboxRow): InboxMessage {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    taskId: row.task_id ?? undefined,
    type: row.type,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at
  };
}
