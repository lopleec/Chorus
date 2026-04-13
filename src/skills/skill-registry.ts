import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import type { ChorusPaths } from "../config/paths.js";

export interface SkillRecord {
  name: string;
  description: string;
  path: string;
  root: string;
}

export interface SkillContent extends SkillRecord {
  body: string;
}

export class SkillRegistry {
  private readonly roots: string[];

  constructor(paths: ChorusPaths, env: NodeJS.ProcessEnv = process.env) {
    const configured = env.CHORUS_SKILL_PATHS?.split(delimiter).map((item) => item.trim()).filter(Boolean) ?? [];
    this.roots = uniquePaths([
      paths.skillsDir,
      ...configured,
      join(homedir(), ".codex", "skills")
    ]);
  }

  list(): SkillRecord[] {
    const records: SkillRecord[] = [];
    for (const root of this.roots) {
      if (!existsSync(root)) continue;
      for (const path of findSkillFiles(root)) {
        records.push(parseSkillFile(path, root));
      }
    }
    return records.sort((a, b) => a.name.localeCompare(b.name));
  }

  search(query: string): SkillRecord[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.list();
    return this.list().filter((skill) => {
      const body = safeRead(skill.path).toLowerCase();
      return `${skill.name} ${skill.description} ${body}`.toLowerCase().includes(needle);
    });
  }

  read(nameOrPath: string): SkillContent | null {
    const target = nameOrPath.trim();
    if (!target) return null;
    const directPath = target.endsWith("SKILL.md") ? resolve(target) : "";
    const skill = directPath && existsSync(directPath)
      ? parseSkillFile(directPath, findRootForPath(directPath, this.roots))
      : this.list().find((item) => item.name === target || item.path === target || item.path.endsWith(`/${target}/SKILL.md`));
    if (!skill) return null;
    return {
      ...skill,
      body: safeRead(skill.path)
    };
  }
}

function findSkillFiles(root: string, depth = 0): string[] {
  if (depth > 5) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isFile() && entry === "SKILL.md") {
      found.push(path);
      continue;
    }
    if (stat.isDirectory() && !entry.startsWith("node_modules")) {
      found.push(...findSkillFiles(path, depth + 1));
    }
  }
  return found;
}

function parseSkillFile(path: string, root: string): SkillRecord {
  const body = safeRead(path);
  const heading = /^#\s+(.+)$/mu.exec(body)?.[1]?.trim();
  const description = /^description:\s*(.+)$/imu.exec(body)?.[1]?.trim()
    ?? body.split("\n").map((line) => line.trim()).find((line) => line && !line.startsWith("#"))
    ?? "";
  return {
    name: heading || path.split("/").at(-2) || "skill",
    description,
    path,
    root
  };
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function findRootForPath(path: string, roots: string[]): string {
  return roots.find((root) => path.startsWith(root)) ?? roots[0] ?? "";
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}
