import { describe, expect, it } from "vitest";
import { detectReadIntent, extractAbsolutePaths } from "../../src/tui/main-app.js";

describe("TUI command routing helpers", () => {
  it("detects Chinese file-content questions as read tool intents", () => {
    const text = "/Users/luccazh/Documents/Programing☕️/Chorus/Plan_总结.md 这个文件有什么内容";

    expect(detectReadIntent(text)).toEqual({
      kind: "read",
      paths: ["/Users/luccazh/Documents/Programing☕️/Chorus/Plan_总结.md"]
    });
  });

  it("extracts and cleans absolute paths from chat text", () => {
    expect(extractAbsolutePaths("看看 /tmp/chorus.md，还有 /tmp/other.txt?")).toEqual([
      "/tmp/chorus.md",
      "/tmp/other.txt"
    ]);
  });
});
