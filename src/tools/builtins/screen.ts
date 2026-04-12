import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ChorusPaths } from "../../config/paths.js";
import type { ToolDefinition } from "../../core/types.js";
import { createId } from "../../core/ids.js";

export function screenTool(paths: ChorusPaths): ToolDefinition {
  return {
    name: "screen",
    description: "Take a macOS screenshot for read-only GUI inspection.",
    paramsSchema: z.object({ path: z.string().optional(), timeoutMs: z.number().int().min(1000).max(60_000).default(15_000) }),
    async execute(params) {
      const input = params as { path?: string; timeoutMs: number };
      const output = input.path ?? join(paths.home, "artifacts", `${createId("screen")}.png`);
      mkdirSync(join(paths.home, "artifacts"), { recursive: true });
      const result = await run("screencapture", ["-x", output], input.timeoutMs);
      if (result.exitCode === 0) return { status: "ok", summary: `Saved screenshot to ${output}.`, data: { path: output } };
      return { status: "error", summary: "Screenshot failed.", error: result.stderr };
    }
  };
}

function run(command: string, args: string[], timeoutMs: number): Promise<{ stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
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
