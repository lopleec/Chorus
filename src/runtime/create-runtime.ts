import { getChorusPaths, ensureChorusDirs, resolveChorusHome } from "../config/paths.js";
import { readProviderEnv } from "../config/env.js";
import { loadSettings, settingsToEnv, type ChorusSettings } from "../config/settings.js";
import { ChorusDatabase } from "../data/sqlite.js";
import { OperationLog } from "../data/operation-log.js";
import { MemoryStore } from "../memory/memory-store.js";
import { ProviderRegistry } from "../providers/provider-registry.js";
import { SubAgentManager } from "../scheduler/sub-agent-manager.js";
import { TaskScheduler } from "../scheduler/task-scheduler.js";
import { ToolGateway } from "../tools/gateway.js";
import { createBuiltInTools } from "../tools/builtins/index.js";

export interface ChorusRuntime {
  paths: ReturnType<typeof getChorusPaths>;
  settings: ChorusSettings;
  database: ChorusDatabase;
  operationLog: OperationLog;
  memoryStore: MemoryStore;
  providerRegistry: ProviderRegistry;
  scheduler: TaskScheduler;
  subAgentManager: SubAgentManager;
  toolGateway: ToolGateway;
  close(): void;
}

export function createRuntime(env: NodeJS.ProcessEnv = process.env): ChorusRuntime {
  const paths = getChorusPaths(resolveChorusHome(env));
  ensureChorusDirs(paths);
  const settings = loadSettings(paths);
  const database = new ChorusDatabase(paths);
  const operationLog = new OperationLog(paths.operationsLogPath);
  const memoryStore = new MemoryStore(database);
  const scheduler = new TaskScheduler(database, paths);
  const subAgentManager = new SubAgentManager(database, scheduler);
  const toolGateway = new ToolGateway(operationLog, scheduler);
  for (const tool of createBuiltInTools({ memoryStore, subAgentManager, scheduler, database, paths, settings })) {
    toolGateway.register(tool);
  }
  const providerRegistry = ProviderRegistry.fromEnv(readProviderEnv({
    ...settingsToEnv(settings),
    ...env
  }));

  return {
    paths,
    settings,
    database,
    operationLog,
    memoryStore,
    providerRegistry,
    scheduler,
    subAgentManager,
    toolGateway,
    close: () => database.close()
  };
}
