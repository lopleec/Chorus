import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";
import type { SkillRegistry } from "../../skills/skill-registry.js";

export function skillsTool(registry: SkillRegistry): ToolDefinition {
  return {
    name: "skills",
    description: "List, search, or read local SKILL.md instructions for the agent.",
    paramsSchema: z.object({
      action: z.enum(["list", "search", "read"]).default("list"),
      name: z.string().optional(),
      path: z.string().optional(),
      query: z.string().optional(),
      maxResults: z.number().int().min(1).max(50).default(10)
    }),
    async execute(params) {
      const input = params as { action: "list" | "search" | "read"; name?: string; path?: string; query?: string; maxResults: number };
      if (input.action === "read") {
        const skill = registry.read(input.path ?? input.name ?? "");
        if (!skill) {
          return { status: "error", summary: "Skill not found.", error: "Provide a skill name or SKILL.md path." };
        }
        return { status: "ok", summary: `Read skill ${skill.name}.`, data: { skill } };
      }

      if (input.action === "search") {
        const skills = registry.search(input.query ?? "").slice(0, input.maxResults);
        return { status: "ok", summary: `Found ${skills.length} skill(s).`, data: { skills } };
      }

      const skills = registry.list().slice(0, input.maxResults);
      return { status: "ok", summary: `Listed ${skills.length} skill(s).`, data: { skills } };
    }
  };
}
