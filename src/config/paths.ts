import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface ChorusPaths {
  home: string;
  dbPath: string;
  configPath: string;
  tasksDir: string;
  logsDir: string;
  skillsDir: string;
  workspacesDir: string;
  operationsLogPath: string;
}

export function resolveChorusHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.CHORUS_HOME?.trim() || join(homedir(), ".chorus"));
}

export function getChorusPaths(home = resolveChorusHome()): ChorusPaths {
  return {
    home,
    dbPath: join(home, "chorus.sqlite"),
    configPath: join(home, "config.json"),
    tasksDir: join(home, "tasks"),
    logsDir: join(home, "logs"),
    skillsDir: join(home, "skills"),
    workspacesDir: join(home, "workspaces"),
    operationsLogPath: join(home, "logs", "operations.jsonl")
  };
}

export function ensureChorusDirs(paths: ChorusPaths): void {
  mkdirSync(paths.home, { recursive: true });
  mkdirSync(paths.tasksDir, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });
  mkdirSync(paths.skillsDir, { recursive: true });
  mkdirSync(paths.workspacesDir, { recursive: true });
}

export function safeWorkspaceName(name: string): string {
  const safe = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return safe || "default";
}
