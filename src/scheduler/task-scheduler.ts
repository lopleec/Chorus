import type { ChorusDatabase } from "../data/sqlite.js";
import type { TaskStatus, ToolExecutionStatus, ToolContext } from "../core/types.js";
import { createId } from "../core/ids.js";
import { nowIso } from "../core/time.js";
import { appendJsonl } from "../data/jsonl.js";
import { LoopDetector } from "./loop-detector.js";
import type { ChorusPaths } from "../config/paths.js";
import { join } from "node:path";

export interface TaskRecord {
  id: string;
  goal: string;
  status: TaskStatus;
  workspace?: string | null;
  createdAt: string;
  updatedAt: string;
}

export class TaskScheduler {
  private readonly loopDetector = new LoopDetector();

  constructor(
    private readonly database: ChorusDatabase,
    private readonly paths: ChorusPaths
  ) {}

  createTask(goal: string, workspace?: string | null): TaskRecord {
    const id = createId("task");
    const at = nowIso();
    this.database.db
      .prepare("INSERT INTO tasks (id, goal, status, workspace, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, goal, "queued", workspace ?? null, at, at);
    this.appendTaskEvent(id, { type: "task.created", goal, workspace: workspace ?? null, at });
    return { id, goal, status: "queued", workspace: workspace ?? null, createdAt: at, updatedAt: at };
  }

  ensureTask(id: string, goal: string, workspace?: string | null): TaskRecord {
    const existing = this.getTask(id);
    if (existing) {
      return existing;
    }
    const at = nowIso();
    this.database.db
      .prepare("INSERT INTO tasks (id, goal, status, workspace, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, goal, "queued", workspace ?? null, at, at);
    this.appendTaskEvent(id, { type: "task.created", goal, workspace: workspace ?? null, at });
    return { id, goal, status: "queued", workspace: workspace ?? null, createdAt: at, updatedAt: at };
  }

  getTask(id: string): TaskRecord | null {
    const row = this.database.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | { id: string; goal: string; status: TaskStatus; workspace: string | null; created_at: string; updated_at: string }
      | undefined;
    return row
      ? { id: row.id, goal: row.goal, status: row.status, workspace: row.workspace, createdAt: row.created_at, updatedAt: row.updated_at }
      : null;
  }

  listTasks(): TaskRecord[] {
    const rows = this.database.db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all() as Array<{
      id: string;
      goal: string;
      status: TaskStatus;
      workspace: string | null;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      goal: row.goal,
      status: row.status,
      workspace: row.workspace,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  setStatus(id: string, status: TaskStatus, detail?: string): void {
    const at = nowIso();
    this.database.db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(status, at, id);
    this.appendTaskEvent(id, { type: "task.status", status, detail, at });
  }

  recordToolActivity(context: ToolContext, toolName: string, params: unknown, status: ToolExecutionStatus): boolean {
    const signature = `${toolName}:${JSON.stringify(params)}`;
    const looped = this.loopDetector.record({
      actorId: context.subAgentId ?? context.actorId,
      signature,
      status
    });
    if (looped && context.taskId) {
      this.setStatus(context.taskId, "loop_detected", `Repeated ${signature}`);
      if (context.subAgentId) {
        this.database.db
          .prepare("UPDATE sub_agents SET status = ?, current_action = ?, updated_at = ? WHERE id = ?")
          .run("loop_detected", `loop_detected:${signature}`, nowIso(), context.subAgentId);
      }
    }
    return looped;
  }

  appendTaskEvent(taskId: string, event: unknown): void {
    appendJsonl(join(this.paths.tasksDir, `${taskId}.jsonl`), event);
  }
}
