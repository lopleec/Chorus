import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatGatewayEvent } from "../../src/agent/chat-gateway.js";
import { GitAutoCommitter } from "../../src/agent/git-auto-commit.js";
import type { ProviderRequest, ProviderResponse, ProviderStreamChunk, TextProvider } from "../../src/core/types.js";
import { createTempRuntime } from "../helpers/temp-home.js";

class ScriptedToolProvider implements TextProvider {
  readonly id = "scripted";
  calls = 0;
  requests: ProviderRequest[] = [];

  async generateText(): Promise<ProviderResponse> {
    return { text: "" };
  }

  async *streamText(_request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    this.requests.push(_request);
    this.calls += 1;
    const text = this.calls === 1
      ? '<chorus_tool_call>{"tool":"read","params":{"path":"note.md"}}</chorus_tool_call>'
      : "Read it. The note says hello.";
    for (const chunk of text.match(/.{1,10}/gu) ?? [""]) {
      yield { text: chunk };
    }
  }
}

describe("ChatGateway", () => {
  it("streams text events around model-requested tool calls", async () => {
    const temp = createTempRuntime();
    try {
      writeFileSync(join(temp.home, "note.md"), "hello", "utf8");
      temp.runtime.memoryStore.add({
        scope: "global",
        kind: "summary",
        summary: "read notemd memory",
        tags: ["note"]
      });
      const provider = new ScriptedToolProvider();
      temp.runtime.providerRegistry.register(provider);
      temp.runtime.providerRegistry.setDefault(provider.id);

      const events: ChatGatewayEvent[] = [];
      for await (const event of temp.runtime.chatGateway.runTurn({
        prompt: "read note.md",
        context: { actorId: "test", actorRole: "main", cwd: temp.home },
        autoCommit: false
      })) {
        events.push(event);
      }

      expect(events.some((event) => event.type === "tool_call" && event.call.name === "read")).toBe(true);
      expect(events.some((event) => event.type === "tool_result" && event.result.status === "ok")).toBe(true);
      expect(events.filter((event) => event.type === "text_delta").map((event) => event.text).join("")).toBe("Read it. The note says hello.");
      expect(JSON.stringify(provider.requests[0]?.messages)).toContain("Relevant long-term memory");
    } finally {
      temp.cleanup();
    }
  });
});

describe("GitAutoCommitter", () => {
  it("commits files changed after the chat snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "chorus-git-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: root });
      execFileSync("git", ["config", "user.email", "chorus@example.test"], { cwd: root });
      execFileSync("git", ["config", "user.name", "Chorus Test"], { cwd: root });
      writeFileSync(join(root, "README.md"), "initial\n", "utf8");
      execFileSync("git", ["add", "README.md"], { cwd: root });
      execFileSync("git", ["commit", "-m", "initial"], { cwd: root });

      const committer = new GitAutoCommitter(root);
      const snapshot = await committer.snapshot();
      writeFileSync(join(root, "changed.md"), "changed\n", "utf8");
      const result = await committer.commitChanges(snapshot, "Chorus auto-commit test");

      expect(result.status).toBe("committed");
      expect(result.files).toEqual(["changed.md"]);
      expect(execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" })).toBe("");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
