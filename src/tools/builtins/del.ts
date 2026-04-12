import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";
import { resolveToolPath } from "../path.js";

export function delTool(): ToolDefinition {
  return {
    name: "del",
    description: "Move a file or directory to the macOS Trash.",
    paramsSchema: z.object({ path: z.string(), timeoutMs: z.number().int().min(1000).max(60_000).default(15_000) }),
    async execute(params, context) {
      const input = params as { path: string; timeoutMs: number };
      const target = resolveToolPath(context.cwd, input.path, context.allowedRoots);
      const script = `tell application "Finder" to delete POSIX file ${JSON.stringify(target)}`;
      const result = await runAppleScript(script, input.timeoutMs);
      if (result.exitCode === 0) return { status: "ok", summary: `Moved ${target} to Trash.`, data: { originalPath: target } };
      return { status: "error", summary: "Trash delete failed.", error: result.stderr };
    }
  };
}

function runAppleScript(script: string, timeoutMs: number): Promise<{ stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("osascript", ["-e", script], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stderr, exitCode });
    });
  });
}
