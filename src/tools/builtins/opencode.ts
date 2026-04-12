import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";

export function opencodeTool(defaultCwd: string): ToolDefinition {
  return {
    name: "opencode",
    description: "Run OpenCode non-interactively via `opencode run [message]`.",
    paramsSchema: z.object({
      message: z.string().min(1),
      cwd: z.string().optional(),
      model: z.string().optional(),
      files: z.array(z.string()).default([]),
      format: z.enum(["default", "json"]).default("json"),
      timeoutMs: z.number().int().min(1000).max(60 * 60 * 1000).default(10 * 60 * 1000)
    }),
    async execute(params, context) {
      const input = params as { message: string; cwd?: string; model?: string; files: string[]; format: "default" | "json"; timeoutMs: number };
      const args = ["run", input.message, "--format", input.format, "--dir", input.cwd ?? context.cwd ?? defaultCwd];
      if (input.model) args.push("--model", input.model);
      for (const file of input.files) args.push("--file", file);
      const result = await run("opencode", args, input.cwd ?? context.cwd ?? defaultCwd, input.timeoutMs, context.signal);
      if (result.exitCode === 0) {
        return { status: "ok", summary: "OpenCode run completed.", data: result };
      }
      return { status: "error", summary: `OpenCode exited ${result.exitCode}.`, error: result.stderr || result.stdout, data: result };
    }
  };
}

function run(command: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<{ command: string; args: string[]; stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ command, args, stdout, stderr, exitCode, timedOut });
    });
  });
}
