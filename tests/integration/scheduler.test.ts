import { describe, expect, it } from "vitest";
import { createTempRuntime } from "../helpers/temp-home.js";

describe("scheduler and sub-agent manager", () => {
  it("opens, contacts, lists, and stops sub-agents", async () => {
    const temp = createTempRuntime();
    try {
      const opened = await temp.runtime.toolGateway.execute("open_subagent", {
        goal: "Read project files",
        success_criteria: ["Report status"],
        workspace: "chorus",
        file_scope: ["src"]
      }, { actorId: "main", actorRole: "main", cwd: temp.home });
      expect(opened.status).toBe("ok");
      const agentId = (opened.data as { agent: { id: string } }).agent.id;

      const contact = await temp.runtime.toolGateway.execute("contact", {
        recipientId: agentId,
        type: "coordination",
        body: "Use the src scope."
      }, { actorId: "main", actorRole: "main", cwd: temp.home });
      expect(contact.status).toBe("ok");
      expect(temp.runtime.subAgentManager.inbox(agentId)).toHaveLength(1);

      const stopped = await temp.runtime.toolGateway.execute("stop", {
        scope: "agent",
        id: agentId,
        reason: "test stop"
      }, { actorId: "main", actorRole: "main", cwd: temp.home });
      expect(stopped.status).toBe("ok");
      expect(temp.runtime.subAgentManager.get(agentId)?.status).toBe("stopped");
    } finally {
      temp.cleanup();
    }
  });

  it("marks repeated tool activity as loop_detected", () => {
    const temp = createTempRuntime();
    try {
      const task = temp.runtime.scheduler.createTask("Loop test", "chorus");
      const agent = temp.runtime.subAgentManager.openSubAgent({
        task_id: task.id,
        goal: "Loop test",
        success_criteria: [],
        workspace: "chorus",
        important_constraints: [],
        file_scope: [],
        agent_assignments: {},
        shared_decisions: {},
        open_questions: []
      });

      const context = { actorId: agent.id, actorRole: "sub" as const, cwd: temp.home, taskId: task.id, subAgentId: agent.id };
      expect(temp.runtime.scheduler.recordToolActivity(context, "read", { path: "a" }, "ok")).toBe(false);
      expect(temp.runtime.scheduler.recordToolActivity(context, "read", { path: "a" }, "ok")).toBe(false);
      expect(temp.runtime.scheduler.recordToolActivity(context, "read", { path: "a" }, "ok")).toBe(true);

      expect(temp.runtime.scheduler.getTask(task.id)?.status).toBe("loop_detected");
      expect(temp.runtime.subAgentManager.get(agent.id)?.status).toBe("loop_detected");
    } finally {
      temp.cleanup();
    }
  });
});
