import { z } from "zod";
import type { ChorusSettings } from "../../config/settings.js";
import type { ToolDefinition } from "../../core/types.js";

export function mcpTool(settings: ChorusSettings): ToolDefinition {
  return {
    name: "mcp",
    description: "Inspect manually configured trusted MCP servers.",
    paramsSchema: z.object({
      action: z.enum(["list"]).default("list")
    }),
    async execute() {
      return {
        status: "ok",
        summary: `Listed ${settings.mcp.servers.length} configured MCP server(s).`,
        data: { servers: settings.mcp.servers.filter((server) => server.enabled) }
      };
    }
  };
}
