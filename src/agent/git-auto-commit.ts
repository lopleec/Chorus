import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitSnapshot {
  root: string;
  dirtyPaths: Set<string>;
}

export interface GitAutoCommitResult {
  status: "committed" | "none" | "skipped" | "failed";
  summary: string;
  files?: string[];
  commit?: string;
  error?: string;
}

export class GitAutoCommitter {
  constructor(private readonly cwd: string) {}

  async snapshot(): Promise<GitSnapshot | null> {
    const root = await this.gitRoot();
    if (!root) return null;
    return {
      root,
      dirtyPaths: await this.statusPaths(root)
    };
  }

  async commitChanges(snapshot: GitSnapshot | null, message: string): Promise<GitAutoCommitResult> {
    if (!snapshot) {
      return { status: "skipped", summary: "auto-commit skipped: not inside a git repository." };
    }

    try {
      const after = await this.statusPaths(snapshot.root);
      const changed = [...after].filter((file) => !snapshot.dirtyPaths.has(file)).sort();
      if (changed.length === 0) {
        return { status: "none", summary: "auto-commit: no new file changes from this chat turn." };
      }

      await execFileAsync("git", ["add", "--", ...changed], { cwd: snapshot.root });
      const hasStaged = await this.hasStagedChanges(snapshot.root);
      if (!hasStaged) {
        return { status: "none", summary: "auto-commit: no staged changes after filtering pre-existing edits.", files: changed };
      }

      await execFileAsync("git", ["commit", "-m", message], { cwd: snapshot.root });
      const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: snapshot.root });
      const commit = stdout.trim();
      return {
        status: "committed",
        summary: `auto-commit: committed ${changed.length} file(s) as ${commit}.`,
        files: changed,
        commit
      };
    } catch (error) {
      return {
        status: "failed",
        summary: "auto-commit failed.",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async gitRoot(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: this.cwd });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async statusPaths(root: string): Promise<Set<string>> {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z"], { cwd: root, encoding: "buffer" });
    const chunks = Buffer.isBuffer(stdout) ? stdout.toString("utf8").split("\0").filter(Boolean) : String(stdout).split("\0").filter(Boolean);
    const paths = new Set<string>();
    for (const chunk of chunks) {
      const path = chunk.slice(3);
      if (path) paths.add(path);
    }
    return paths;
  }

  private async hasStagedChanges(root: string): Promise<boolean> {
    try {
      await execFileAsync("git", ["diff", "--cached", "--quiet"], { cwd: root });
      return false;
    } catch {
      return true;
    }
  }
}
