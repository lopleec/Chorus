import { describe, expect, it } from "vitest";
import { detectReadIntent, extractAbsolutePaths, extractModelToolCall, isKnownSlashCommandInput, wrapDisplay } from "../../src/tui/main-app.js";

describe("TUI command routing helpers", () => {
  it("detects Chinese file-content questions as read tool intents", () => {
    const text = "/Users/luccazh/Documents/Programing☕️/Chorus/Plan_总结.md 这个文件有什么内容";

    expect(detectReadIntent(text)).toEqual({
      kind: "read",
      paths: ["/Users/luccazh/Documents/Programing☕️/Chorus/Plan_总结.md"]
    });
  });

  it("does not treat absolute paths as slash commands", () => {
    const text = "/Users/luccazh/Documents/Programing☕️/Chorus/Plan_总结.md";

    expect(isKnownSlashCommandInput(text)).toBe(false);
    expect(detectReadIntent(text)).toEqual({
      kind: "read",
      paths: [text]
    });
    expect(isKnownSlashCommandInput("/read README.md")).toBe(true);
  });

  it("extracts and cleans absolute paths from chat text", () => {
    expect(extractAbsolutePaths("看看 /tmp/chorus.md，还有 /tmp/other.txt?")).toEqual([
      "/tmp/chorus.md",
      "/tmp/other.txt"
    ]);
  });

  it("parses model-requested tool calls", () => {
    expect(extractModelToolCall('<chorus_tool_call>{"tool":"read","params":{"path":"README.md"}}</chorus_tool_call>')).toEqual({
      name: "read",
      params: { path: "README.md" }
    });
  });

  it("wraps long display lines for the viewport", () => {
    const lines = wrapDisplay("这是一个很长的中文路径 /Users/luccazh/Documents/Programing/Chorus/Plan_总结.md", 18);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.length <= 18)).toBe(true);
  });
});
