import type { ChorusDatabase } from "../data/sqlite.js";
import type { MemoryEntry, MemoryKind, MemoryQuery, MemoryScope, MemorySearchResult } from "../core/types.js";
import { createId } from "../core/ids.js";
import { parseJsonObject } from "../core/json.js";
import { isExpired, nowIso } from "../core/time.js";

interface MemoryRow {
  id: string;
  scope: MemoryScope;
  workspace: string | null;
  kind: MemoryKind;
  summary: string;
  body: string | null;
  tags_json: string;
  weight: number;
  confidence: number | null;
  ttl_expires_at: string | null;
  source_task_id: string | null;
  recall_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AddMemoryInput {
  scope: MemoryScope;
  workspace?: string | null;
  kind: MemoryKind;
  summary: string;
  body?: string | null;
  tags?: string[];
  weight?: number;
  confidence?: number | null;
  ttl_expires_at?: string | null;
  source_task_id?: string | null;
}

export interface PruneOptions {
  now?: Date;
  maxWeight?: number;
  maxRecallCount?: number;
}

export interface PruneResult {
  pruned: number;
  ids: string[];
}

export class MemoryStore {
  constructor(private readonly database: ChorusDatabase) {}

  add(input: AddMemoryInput): MemoryEntry {
    const id = createId("mem");
    const at = nowIso();
    const tags = normalizeTags(input.tags ?? []);
    const entry: MemoryEntry = {
      id,
      scope: input.scope,
      workspace: input.workspace ?? null,
      kind: input.kind,
      summary: input.summary,
      body: input.body ?? null,
      tags,
      weight: input.weight ?? defaultWeight(input.kind),
      confidence: input.confidence ?? null,
      ttl_expires_at: input.ttl_expires_at ?? null,
      source_task_id: input.source_task_id ?? null,
      recall_count: 0,
      last_accessed_at: null,
      created_at: at,
      updated_at: at
    };

    this.database.db
      .prepare(
        `INSERT INTO memory_entries (
          id, scope, workspace, kind, summary, body, tags_json, weight, confidence,
          ttl_expires_at, source_task_id, recall_count, last_accessed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.scope,
        entry.workspace ?? null,
        entry.kind,
        entry.summary,
        entry.body ?? null,
        JSON.stringify(entry.tags),
        entry.weight,
        entry.confidence ?? null,
        entry.ttl_expires_at ?? null,
        entry.source_task_id ?? null,
        entry.recall_count,
        entry.last_accessed_at ?? null,
        entry.created_at,
        entry.updated_at
      );

    this.upsertFts(entry);
    return entry;
  }

  get(id: string): MemoryEntry | null {
    const row = this.database.db.prepare("SELECT * FROM memory_entries WHERE id = ?").get(id) as MemoryRow | undefined;
    return row ? mapMemoryRow(row) : null;
  }

  search(query: MemoryQuery, access?: { actorId?: string; taskId?: string }): MemorySearchResult[] {
    const topK = Math.max(1, Math.min(query.topK ?? 5, 50));
    const keyword = query.keyword?.trim();
    const ftsIds = keyword ? this.searchFts(keyword) : new Map<string, number>();

    const rows = this.database.db
      .prepare("SELECT * FROM memory_entries")
      .all() as unknown as MemoryRow[];

    const results = rows
      .map(mapMemoryRow)
      .filter((entry) => this.matchesQuery(entry, query, ftsIds))
      .map((entry) => this.score(entry, query, ftsIds))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    if (results.length > 0) {
      this.recordAccess(results.map((result) => result.entry.id), query, access);
      return results.map((result) => ({
        ...result,
        entry: {
          ...result.entry,
          recall_count: result.entry.recall_count + 1,
          last_accessed_at: nowIso()
        }
      }));
    }

    return results;
  }

  prune(options: PruneOptions = {}): PruneResult {
    const at = options.now ?? new Date();
    const maxWeight = options.maxWeight ?? 0.7;
    const maxRecallCount = options.maxRecallCount ?? 1;
    const rows = this.database.db
      .prepare(
        `SELECT * FROM memory_entries
         WHERE ttl_expires_at IS NOT NULL
           AND ttl_expires_at <= ?
           AND weight <= ?
           AND recall_count <= ?`
      )
      .all(at.toISOString(), maxWeight, maxRecallCount) as unknown as MemoryRow[];

    const ids = rows.map((row) => row.id);
    const deleteMemory = this.database.db.prepare("DELETE FROM memory_entries WHERE id = ?");
    const deleteFts = this.database.db.prepare("DELETE FROM memory_entries_fts WHERE id = ?");
    for (const id of ids) {
      deleteFts.run(id);
      deleteMemory.run(id);
    }

    return { pruned: ids.length, ids };
  }

  private upsertFts(entry: MemoryEntry): void {
    this.database.db.prepare("DELETE FROM memory_entries_fts WHERE id = ?").run(entry.id);
    this.database.db
      .prepare("INSERT INTO memory_entries_fts (id, summary, body, tags) VALUES (?, ?, ?, ?)")
      .run(entry.id, entry.summary, entry.body ?? "", entry.tags.join(" "));
  }

  private searchFts(keyword: string): Map<string, number> {
    const ftsQuery = buildFtsQuery(keyword);
    if (!ftsQuery) {
      return new Map();
    }
    try {
      const rows = this.database.db
        .prepare("SELECT id, rank FROM memory_entries_fts WHERE memory_entries_fts MATCH ?")
        .all(ftsQuery) as Array<{ id: string; rank: number }>;
      return new Map(rows.map((row) => [row.id, Math.abs(row.rank)]));
    } catch {
      const terms = tokenize(keyword);
      const rows = this.database.db
        .prepare("SELECT id, summary, body, tags FROM memory_entries_fts")
        .all() as unknown as Array<{ id: string; summary: string; body: string; tags: string }>;
      return new Map(
        rows
          .filter((row) => {
            const haystack = `${row.summary} ${row.body} ${row.tags}`.toLowerCase();
            return terms.every((term) => haystack.includes(term));
          })
          .map((row) => [row.id, 1])
      );
    }
  }

  private matchesQuery(entry: MemoryEntry, query: MemoryQuery, ftsIds: Map<string, number>): boolean {
    if (!query.includeExpired && isExpired(entry.ttl_expires_at)) {
      return false;
    }
    if (query.scope && entry.scope !== query.scope) {
      return false;
    }
    if (query.workspace && entry.scope === "workspace" && entry.workspace !== query.workspace) {
      return false;
    }
    if (query.tags?.length && !query.tags.some((tag) => entry.tags.includes(normalizeTag(tag)))) {
      return false;
    }
    if (query.keyword?.trim()) {
      const direct = `${entry.summary} ${entry.body ?? ""} ${entry.tags.join(" ")}`.toLowerCase();
      const terms = tokenize(query.keyword);
      return ftsIds.has(entry.id) || terms.every((term) => direct.includes(term));
    }
    return true;
  }

  private score(entry: MemoryEntry, query: MemoryQuery, ftsIds: Map<string, number>): MemorySearchResult {
    let score = 0;
    const reasons: string[] = [];

    if (query.workspace && entry.workspace === query.workspace) {
      score += 30;
      reasons.push("workspace");
    } else if (entry.scope === "global") {
      score += 6;
      reasons.push("global");
    }

    for (const tag of query.tags ?? []) {
      if (entry.tags.includes(normalizeTag(tag))) {
        score += 12;
        reasons.push(`tag:${normalizeTag(tag)}`);
      }
    }

    if (ftsIds.has(entry.id)) {
      score += 18;
      reasons.push("fts");
    }

    score += entry.weight * 10;
    if (entry.weight > 0) {
      reasons.push("weight");
    }

    score += Math.min(entry.recall_count, 10) * 1.5;
    if (entry.recall_count > 0) {
      reasons.push("recall");
    }

    if (entry.last_accessed_at) {
      const ageMs = Date.now() - new Date(entry.last_accessed_at).getTime();
      if (ageMs < 7 * 24 * 60 * 60 * 1000) {
        score += 4;
        reasons.push("recent");
      }
    }

    if (isExpired(entry.ttl_expires_at)) {
      score -= 100;
      reasons.push("expired");
    }

    return { entry, score, reasons };
  }

  private recordAccess(ids: string[], query: MemoryQuery, access?: { actorId?: string; taskId?: string }): void {
    const at = nowIso();
    const update = this.database.db.prepare(
      "UPDATE memory_entries SET recall_count = recall_count + 1, last_accessed_at = ?, updated_at = ? WHERE id = ?"
    );
    const insert = this.database.db.prepare(
      "INSERT INTO memory_access (id, memory_id, task_id, actor_id, accessed_at, query) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const id of ids) {
      update.run(at, at, id);
      insert.run(createId("access"), id, access?.taskId ?? null, access?.actorId ?? null, at, JSON.stringify(query));
    }
  }
}

function mapMemoryRow(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    scope: row.scope,
    workspace: row.workspace,
    kind: row.kind,
    summary: row.summary,
    body: row.body,
    tags: parseJsonObject<string[]>(row.tags_json, []),
    weight: row.weight,
    confidence: row.confidence,
    ttl_expires_at: row.ttl_expires_at,
    source_task_id: row.source_task_id,
    recall_count: row.recall_count,
    last_accessed_at: row.last_accessed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function defaultWeight(kind: MemoryKind): number {
  if (kind === "world_fact") return 1;
  if (kind === "summary") return 0.9;
  if (kind === "belief") return 0.6;
  return 0.5;
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))];
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}_-]+/gu, ""))
    .filter(Boolean);
}

function buildFtsQuery(keyword: string): string {
  return tokenize(keyword)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");
}
