import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { ChorusPaths } from "../config/paths.js";

export class ChorusDatabase {
  readonly db: DatabaseSync;

  constructor(readonly paths: ChorusPaths) {
    mkdirSync(dirname(paths.dbPath), { recursive: true });
    this.db = new DatabaseSync(paths.dbPath, { timeout: 5_000 });
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        workspace TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sub_agents (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        brief_json TEXT NOT NULL,
        current_action TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS subagent_inbox (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        task_id TEXT,
        type TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        workspace TEXT,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT,
        tags_json TEXT NOT NULL,
        weight REAL NOT NULL,
        confidence REAL,
        ttl_expires_at TEXT,
        source_task_id TEXT,
        recall_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_access (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        task_id TEXT,
        actor_id TEXT,
        accessed_at TEXT NOT NULL,
        query TEXT,
        FOREIGN KEY(memory_id) REFERENCES memory_entries(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS addon_reviews (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        addon_type TEXT NOT NULL,
        status TEXT NOT NULL,
        risk_summary TEXT NOT NULL,
        findings_json TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        reviewed_at TEXT,
        cooldown_until TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_sub_agents_task ON sub_agents(task_id);
      CREATE INDEX IF NOT EXISTS idx_memory_scope_workspace ON memory_entries(scope, workspace);
      CREATE INDEX IF NOT EXISTS idx_memory_ttl ON memory_entries(ttl_expires_at);
      CREATE INDEX IF NOT EXISTS idx_addon_reviews_status ON addon_reviews(status);
    `);
    this.createMemorySearchTable();
  }

  private createMemorySearchTable(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
          id UNINDEXED,
          summary,
          body,
          tags
        );
      `);
    } catch {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memory_entries_fts (
          id TEXT PRIMARY KEY,
          summary TEXT NOT NULL,
          body TEXT NOT NULL,
          tags TEXT NOT NULL
        );
      `);
    }
  }

  close(): void {
    this.db.close();
  }
}
