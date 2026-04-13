import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getChorusPaths } from "../../src/config/paths.js";
import { defaultSettings, saveSettings } from "../../src/config/settings.js";
import { createRuntime } from "../../src/runtime/create-runtime.js";
import { createTempRuntime } from "../helpers/temp-home.js";

describe("extended tools", () => {
  it("runs OpenCode only through the dedicated opencode tool", async () => {
    const temp = createTempRuntime();
    const oldPath = process.env.PATH;
    try {
      const bin = join(temp.home, "bin");
      mkdirSync(bin, { recursive: true });
      const fake = join(bin, "opencode");
      writeFileSync(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n", "utf8");
      chmodSync(fake, 0o755);
      process.env.PATH = `${bin}:${oldPath ?? ""}`;

      const result = await temp.runtime.toolGateway.execute("opencode", {
        message: "hello world",
        cwd: temp.home
      }, { actorId: "test", actorRole: "main", cwd: temp.home });

      expect(result.status).toBe("ok");
      expect(JSON.stringify(result.data)).toContain("run");
      expect(JSON.stringify(result.data)).toContain("hello world");
      expect(JSON.stringify(result.data)).toContain("--format");
    } finally {
      process.env.PATH = oldPath;
      temp.cleanup();
    }
  });

  it("calls local HTTP APIs", async () => {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ method: request.method, ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const temp = createTempRuntime();
    try {
      const result = await temp.runtime.toolGateway.execute("http", {
        method: "GET",
        url: `http://127.0.0.1:${port}/ping`
      }, { actorId: "test", actorRole: "sub", cwd: temp.home });

      expect(result.status).toBe("ok");
      expect(JSON.stringify(result.data)).toContain("\"ok\":true");
    } finally {
      server.close();
      temp.cleanup();
    }
  });

  it("lists configured MCP servers and enforces addon review roles", async () => {
    const temp = createTempRuntime();
    temp.runtime.close();
    const paths = getChorusPaths(temp.home);
    saveSettings(paths, {
      ...defaultSettings(),
      mcp: { servers: [{ name: "local", command: "node", args: ["server.js"], enabled: true }] }
    });
    const runtime = createRuntime({ ...process.env, CHORUS_HOME: temp.home });
    try {
      const mcp = await runtime.toolGateway.execute("mcp", {}, { actorId: "test", actorRole: "main", cwd: temp.home });
      expect(mcp.status).toBe("ok");
      expect(JSON.stringify(mcp.data)).toContain("local");

      const review = await runtime.toolGateway.execute("install_addon", {
        source: join(process.cwd(), "package.json"),
        addonType: "plugin"
      }, { actorId: "main", actorRole: "main", cwd: temp.home });
      expect(review.status).toBe("ok");
      const reviewId = (review.data as { id: string }).id;

      const blocked = await runtime.toolGateway.execute("allow", {
        reviewId,
        cooldownMinutes: 0
      }, { actorId: "main", actorRole: "main", cwd: temp.home });
      expect(blocked.status).toBe("blocked");

      const allowed = await runtime.toolGateway.execute("allow", {
        reviewId,
        cooldownMinutes: 0
      }, { actorId: "security", actorRole: "security_review", cwd: temp.home });
      expect(allowed.status).toBe("ok");
    } finally {
      runtime.close();
      rmSync(temp.home, { recursive: true, force: true });
    }
  });

  it("discovers local skills and exposes browser session errors without launching a page", async () => {
    const temp = createTempRuntime();
    try {
      const skillDir = join(temp.runtime.paths.skillsDir, "browser-helper");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), "# browser-helper\nUse for browser automation.\n", "utf8");

      const skills = await temp.runtime.toolGateway.execute("skills", {
        action: "search",
        query: "browser"
      }, { actorId: "test", actorRole: "main", cwd: temp.home });
      expect(skills.status).toBe("ok");
      expect(JSON.stringify(skills.data)).toContain("browser-helper");

      const read = await temp.runtime.toolGateway.execute("skills", {
        action: "read",
        name: "browser-helper"
      }, { actorId: "test", actorRole: "main", cwd: temp.home });
      expect(read.status).toBe("ok");
      expect(JSON.stringify(read.data)).toContain("Use for browser automation");

      const browser = await temp.runtime.toolGateway.execute("browser", {
        action: "snapshot"
      }, { actorId: "test", actorRole: "main", cwd: temp.home });
      expect(browser.status).toBe("error");
      expect(browser.summary).toContain("No browser page is open");
    } finally {
      temp.cleanup();
    }
  });
});
