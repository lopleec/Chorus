import { describe, expect, it } from "vitest";
import {
  detectReadIntent,
  extractAbsolutePaths,
  extractModelToolCall,
  toolCallActivityText
} from "../../src/agent/chat-gateway.js";
import {
  busyStateText,
  isKnownSlashCommandInput,
  markdownLines,
  mouseWheelDelta,
  spinnerGlyph,
  stripMouseReports,
  wrapDisplay
} from "../../src/tui/main-app.js";

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
    expect(isKnownSlashCommandInput("/read README.md")).toBe(false);
    expect(isKnownSlashCommandInput("/status")).toBe(true);
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

  it("parses terminal mouse wheel sequences", () => {
    expect(mouseWheelDelta("\u001b[<64;10;10M")).toBe(3);
    expect(mouseWheelDelta("[<65:10:10M")).toBe(-3);
    expect(stripMouseReports("hello[<64;21;11M world\u001b[<0;10;10m")).toBe("hello world");
  });

  it("renders basic markdown into terminal lines", () => {
    expect(markdownLines("# Title\n- **item**\n> quote\n```ts\nconst x = 1\n```")).toEqual([
      { text: "# Title", style: "heading" },
      { text: "- item", style: "list" },
      { text: "> quote", style: "quote" },
      { text: "```ts", style: "code" },
      { text: "const x = 1", style: "code" },
      { text: "```", style: "code" }
    ]);
  });

  it("formats thinking spinner and explicit agent tool events", () => {
    expect(spinnerGlyph(1)).toBe("/");
    expect(busyStateText(true, 2, "model thinking")).toBe("- model thinking");
    expect(busyStateText(false, 2, "model thinking")).toBe("ready");
    expect(toolCallActivityText({
      name: "read",
      params: { path: "README.md", apiKey: "secret" }
    })).toBe('agent tool call: read {"path":"README.md","apiKey":"[redacted]"}');
  });
});
