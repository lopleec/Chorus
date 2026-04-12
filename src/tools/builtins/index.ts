import type { ToolDefinition } from "../../core/types.js";
import type { ChorusDatabase } from "../../data/sqlite.js";
import type { ChorusPaths } from "../../config/paths.js";
import type { ChorusSettings } from "../../config/settings.js";
import type { MemoryStore } from "../../memory/memory-store.js";
import type { SubAgentManager } from "../../scheduler/sub-agent-manager.js";
import type { TaskScheduler } from "../../scheduler/task-scheduler.js";
import { addonReviewTools } from "./addon-review.js";
import { bashTool } from "./bash.js";
import { delTool } from "./del.js";
import { fileTools } from "./files.js";
import { gitTool } from "./git.js";
import { httpTool } from "./http.js";
import { memoryTool } from "./memory.js";
import { mcpTool } from "./mcp.js";
import { opencodeTool } from "./opencode.js";
import { orchestrationTools } from "./orchestration.js";
import { screenTool } from "./screen.js";
import { uiTool } from "./ui.js";
import { webTool } from "./web.js";

export interface BuiltInToolServices {
  memoryStore: MemoryStore;
  subAgentManager: SubAgentManager;
  scheduler: TaskScheduler;
  database: ChorusDatabase;
  paths: ChorusPaths;
  settings: ChorusSettings;
}

export function createBuiltInTools(services: BuiltInToolServices): ToolDefinition[] {
  return [
    bashTool(),
    ...fileTools(),
    delTool(),
    memoryTool(services.memoryStore),
    httpTool(),
    webTool(),
    gitTool(),
    screenTool(services.paths),
    uiTool(),
    opencodeTool(services.paths.home),
    mcpTool(services.settings),
    ...orchestrationTools(services.subAgentManager, services.scheduler),
    ...addonReviewTools(services.database)
  ];
}
