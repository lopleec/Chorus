import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export function appendJsonl(path: string, record: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

export function readJsonl<T = unknown>(path: string): T[] {
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const records: T[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      records.push(JSON.parse(line) as T);
    } catch {
      // JSONL can be truncated after an interrupted write. Keep readable records.
    }
  }
  return records;
}
