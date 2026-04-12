import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getChorusPaths } from "../../src/config/paths.js";
import { ChorusDatabase } from "../../src/data/sqlite.js";
import { appendJsonl, readJsonl } from "../../src/data/jsonl.js";
import { ensureWorkspaceSummary } from "../../src/data/workspace-summary.js";
import { createTempRuntime } from "../helpers/temp-home.js";

describe("storage", () => {
  it("initializes SQLite idempotently", () => {
    const temp = createTempRuntime();
    try {
      const db2 = new ChorusDatabase(getChorusPaths(temp.home));
      db2.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run("k", "v", new Date().toISOString());
      const row = db2.db.prepare("SELECT value FROM settings WHERE key = ?").get("k") as { value: string };
      expect(row.value).toBe("v");
      db2.close();
    } finally {
      temp.cleanup();
    }
  });

  it("appends readable JSONL and ignores broken tail lines", () => {
    const temp = createTempRuntime();
    try {
      const path = join(temp.home, "logs", "test.jsonl");
      appendJsonl(path, { n: 1 });
      appendJsonl(path, { n: 2 });
      const records = readJsonl<{ n: number }>(path);
      expect(records.map((record) => record.n)).toEqual([1, 2]);
    } finally {
      temp.cleanup();
    }
  });

  it("creates safe workspace markdown summaries", () => {
    const temp = createTempRuntime();
    try {
      const path = ensureWorkspaceSummary(getChorusPaths(temp.home), "../unsafe workspace");
      expect(path.startsWith(join(temp.home, "workspaces"))).toBe(true);
      expect(existsSync(path)).toBe(true);
    } finally {
      temp.cleanup();
    }
  });
});
