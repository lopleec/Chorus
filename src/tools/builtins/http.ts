import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";

export function httpTool(): ToolDefinition {
  return {
    name: "http",
    description: "Call HTTP APIs with timeout, headers, and optional JSON body.",
    paramsSchema: z.object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
      url: z.string().url(),
      headers: z.record(z.string()).default({}),
      json: z.unknown().optional(),
      timeoutMs: z.number().int().min(100).max(120_000).default(30_000)
    }),
    async execute(params) {
      const input = params as { method: string; url: string; headers: Record<string, string>; json?: unknown; timeoutMs: number };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
      try {
        const response = await fetch(input.url, {
          method: input.method,
          headers: input.json === undefined ? input.headers : { "content-type": "application/json", ...input.headers },
          body: input.json === undefined ? undefined : JSON.stringify(input.json),
          signal: controller.signal
        });
        const contentType = response.headers.get("content-type") ?? "";
        const text = await response.text();
        const data = contentType.includes("application/json") ? safeJson(text) : text;
        return {
          status: response.ok ? "ok" : "error",
          summary: `${input.method} ${input.url} -> ${response.status}`,
          error: response.ok ? undefined : text.slice(0, 500),
          data: { status: response.status, headers: Object.fromEntries(response.headers), body: data }
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
