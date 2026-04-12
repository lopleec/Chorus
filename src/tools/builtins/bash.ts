import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";
import { inspectShellCommand } from "../security.js";

export function bashTool(): ToolDefinition {
  return {
    name: "bash",
    description: "Run a shell command with high-risk command blocking.",
    paramsSchema: z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeoutMs: z.number().int().min(100).max(10 * 60 * 1000).default(30_000)
    }),
    async execute(params, context) {
      const input = params as { command: string; cwd?: string; timeoutMs: number };
      const blocked = inspectShellCommand(input.command);
      if (blocked) {
        return {
          status: "blocked",
          summary: `Blocked shell command: ${blocked.risk}`,
          risk: blocked.risk
        };
      }
      const result = await runBash(input.command, input.cwd ?? context.cwd, input.timeoutMs, context.signal);
      if (result.exitCode === 0) {
        return { status: "ok", summary: `Command exited 0.`, data: result };
      }
      return { status: "error", summary: `Command exited ${result.exitCode}.`, error: result.stderr || result.stdout, data: result };
    }
  };
}

function runBash(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
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
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
  });
}
