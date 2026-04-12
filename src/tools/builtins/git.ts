import { z } from "zod";
import { simpleGit } from "simple-git";
import type { ToolDefinition } from "../../core/types.js";

export function gitTool(): ToolDefinition {
  return {
    name: "git",
    description: "Run safe git status, diff, add, commit, log, and revert helper operations.",
    paramsSchema: z.object({
      action: z.enum(["status", "diff", "add", "commit", "log", "revert_file"]),
      files: z.array(z.string()).default([]),
      message: z.string().optional(),
      maxCount: z.number().int().min(1).max(50).default(10)
    }),
    async execute(params, context) {
      const input = params as { action: string; files: string[]; message?: string; maxCount: number };
      const git = simpleGit({ baseDir: context.cwd });
      if (input.action === "status") {
        return { status: "ok", summary: "Git status loaded.", data: await git.status() };
      }
      if (input.action === "diff") {
        return { status: "ok", summary: "Git diff loaded.", data: { diff: await git.diff(input.files) } };
      }
      if (input.action === "add") {
        await git.add(input.files.length ? input.files : ".");
        return { status: "ok", summary: `Staged ${input.files.length ? input.files.join(", ") : "."}.` };
      }
      if (input.action === "commit") {
        if (!input.message) return { status: "error", summary: "git commit requires message.", error: "Missing message." };
        const commit = await git.commit(input.message, input.files);
        return { status: "ok", summary: `Committed ${commit.commit}.`, data: commit };
      }
      if (input.action === "log") {
        return { status: "ok", summary: "Git log loaded.", data: await git.log({ maxCount: input.maxCount }) };
      }
      if (!input.files.length) {
        return { status: "error", summary: "revert_file requires files.", error: "Missing files." };
      }
      await git.checkout(input.files);
      return { status: "ok", summary: `Reverted ${input.files.join(", ")}.` };
    }
  };
}
