import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";

export function uiTool(): ToolDefinition {
  return {
    name: "ui",
    description: "Run basic macOS GUI automation through AppleScript.",
    paramsSchema: z.object({
      action: z.enum(["applescript", "type_text", "keystroke", "mouse_click"]),
      script: z.string().optional(),
      text: z.string().optional(),
      key: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      modifiers: z.array(z.enum(["command", "option", "control", "shift"])).default([]),
      timeoutMs: z.number().int().min(1000).max(60_000).default(15_000)
    }),
    async execute(params) {
      const input = params as { action: string; script?: string; text?: string; key?: string; x?: number; y?: number; modifiers: string[]; timeoutMs: number };
      const script = buildScript(input);
      if (!script) return { status: "error", summary: "Missing UI action input.", error: "Missing script/text/key." };
      const result = await runAppleScript(script, input.timeoutMs);
      if (result.exitCode === 0) return { status: "ok", summary: "UI action completed.", data: { stdout: result.stdout } };
      return { status: "error", summary: "UI action failed.", error: result.stderr };
    }
  };
}

function buildScript(input: { action: string; script?: string; text?: string; key?: string; x?: number; y?: number; modifiers: string[] }): string | null {
  if (input.action === "applescript") return input.script ?? null;
  if (input.action === "type_text" && input.text) {
    return `tell application "System Events" to keystroke ${JSON.stringify(input.text)}`;
  }
  if (input.action === "keystroke" && input.key) {
    const modifiers = input.modifiers.length ? ` using {${input.modifiers.map((m) => `${m} down`).join(", ")}}` : "";
    return `tell application "System Events" to keystroke ${JSON.stringify(input.key)}${modifiers}`;
  }
  if (input.action === "mouse_click" && input.x !== undefined && input.y !== undefined) {
    return `tell application "System Events" to click at {${Math.round(input.x)}, ${Math.round(input.y)}}`;
  }
  return null;
}

function runAppleScript(script: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode });
    });
  });
}
