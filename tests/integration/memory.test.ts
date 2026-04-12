import { describe, expect, it } from "vitest";
import { isoFromNow } from "../../src/core/time.js";
import { createTempRuntime } from "../helpers/temp-home.js";

describe("memory store", () => {
  it("adds, ranks, recalls, and updates access metadata", () => {
    const temp = createTempRuntime();
    try {
      const low = temp.runtime.memoryStore.add({
        scope: "workspace",
        workspace: "chorus",
        kind: "experience",
        summary: "Tried unrelated browser automation",
        tags: ["browser"],
        weight: 0.2
      });
      const high = temp.runtime.memoryStore.add({
        scope: "workspace",
        workspace: "chorus",
        kind: "world_fact",
        summary: "Chorus memory uses SQLite FTS and JSONL operation logs",
        body: "Prefer mechanical ranking by workspace, tag, weight, recall and recency.",
        tags: ["memory", "sqlite"],
        weight: 1
      });

      const results = temp.runtime.memoryStore.search({
        keyword: "SQLite memory",
        workspace: "chorus",
        tags: ["memory"],
        topK: 2
      }, { actorId: "test" });

      expect(results[0]?.entry.id).toBe(high.id);
      expect(results.some((result) => result.entry.id === low.id)).toBe(false);
      expect(temp.runtime.memoryStore.get(high.id)?.recall_count).toBe(1);
    } finally {
      temp.cleanup();
    }
  });

  it("prunes expired low-value entries without deleting high-value memory", () => {
    const temp = createTempRuntime();
    try {
      const low = temp.runtime.memoryStore.add({
        scope: "global",
        kind: "experience",
        summary: "temporary noise",
        weight: 0.1,
        ttl_expires_at: isoFromNow(-1)
      });
      const high = temp.runtime.memoryStore.add({
        scope: "global",
        kind: "world_fact",
        summary: "important expired but high value",
        weight: 1,
        ttl_expires_at: isoFromNow(-1)
      });

      const pruned = temp.runtime.memoryStore.prune();

      expect(pruned.ids).toContain(low.id);
      expect(pruned.ids).not.toContain(high.id);
      expect(temp.runtime.memoryStore.get(low.id)).toBeNull();
      expect(temp.runtime.memoryStore.get(high.id)).not.toBeNull();
    } finally {
      temp.cleanup();
    }
  });
});
