import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ChorusPaths } from "../config/paths.js";
import { safeWorkspaceName } from "../config/paths.js";

export function ensureWorkspaceSummary(paths: ChorusPaths, workspace: string): string {
  const summaryPath = join(paths.workspacesDir, safeWorkspaceName(workspace), "summary.md");
  mkdirSync(dirname(summaryPath), { recursive: true });
  if (!existsSync(summaryPath)) {
    writeFileSync(summaryPath, `# ${workspace}\n\nNo summary yet.\n`, "utf8");
  }
  return summaryPath;
}
