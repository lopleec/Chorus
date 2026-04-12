import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonl } from "../../src/data/jsonl.js";
import type { OperationRecord } from "../../src/core/types.js";
import { createTempRuntime } from "../helpers/temp-home.js";

describe("tool gateway and builtins", () => {
  it("blocks high-risk bash commands before execution and logs the block", async () => {
    const temp = createTempRuntime();
    try {
      const marker = join(temp.home, "should-not-exist");
      const result = await temp.runtime.toolGateway.execute("bash", {
        command: `sudo touch ${marker}`
      }, { actorId: "test", actorRole: "sub", cwd: temp.home });

      expect(result.status).toBe("blocked");
      expect(existsSync(marker)).toBe(false);
      const operations = readJsonl<OperationRecord>(temp.runtime.paths.operationsLogPath);
      expect(operations.at(-1)?.status).toBe("blocked");
      expect(operations.at(-1)?.toolName).toBe("bash");
    } finally {
      temp.cleanup();
    }
  });

  it("blocks recursive force deletion and opencode through bash", async () => {
    const temp = createTempRuntime();
    try {
      const rm = await temp.runtime.toolGateway.execute("bash", { command: "rm -rf ./x" }, { actorId: "test", actorRole: "sub", cwd: temp.home });
      const opencode = await temp.runtime.toolGateway.execute("bash", { command: "opencode run test" }, { actorId: "test", actorRole: "sub", cwd: temp.home });
      expect(rm.status).toBe("blocked");
      expect(opencode.status).toBe("blocked");
    } finally {
      temp.cleanup();
    }
  });

  it("executes file tools through the gateway", async () => {
    const temp = createTempRuntime();
    try {
      const written = await temp.runtime.toolGateway.execute("write", { path: "note.txt", content: "hello chorus" }, { actorId: "test", actorRole: "sub", cwd: temp.home });
      const searched = await temp.runtime.toolGateway.execute("search", { path: ".", query: "chorus" }, { actorId: "test", actorRole: "sub", cwd: temp.home });
      expect(written.status).toBe("ok");
      expect(searched.status).toBe("ok");
      expect(JSON.stringify(searched.data)).toContain("note.txt");
    } finally {
      temp.cleanup();
    }
  });
});
