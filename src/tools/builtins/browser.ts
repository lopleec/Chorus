import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Browser, Page } from "playwright";
import type { ChorusPaths } from "../../config/paths.js";
import type { ToolDefinition } from "../../core/types.js";

interface BrowserSession {
  browser: Browser;
  page: Page;
}

export function browserTool(paths: ChorusPaths): ToolDefinition {
  const sessions = new Map<string, BrowserSession>();

  async function ensureSession(sessionId: string): Promise<BrowserSession> {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const browser = await launchBrowser();
    const page = await browser.newPage();
    const session = { browser, page };
    sessions.set(sessionId, session);
    return session;
  }

  return {
    name: "browser",
    description: "Operate a persistent Playwright browser session: open, snapshot, click, type, press, screenshot, close.",
    paramsSchema: z.object({
      action: z.enum(["open", "snapshot", "click", "type", "press", "screenshot", "close"]).default("snapshot"),
      sessionId: z.string().default("default"),
      url: z.string().optional(),
      selector: z.string().optional(),
      text: z.string().optional(),
      key: z.string().optional(),
      timeoutMs: z.number().int().min(1000).max(120_000).default(30_000)
    }),
    async execute(params) {
      const input = params as {
        action: "open" | "snapshot" | "click" | "type" | "press" | "screenshot" | "close";
        sessionId: string;
        url?: string;
        selector?: string;
        text?: string;
        key?: string;
        timeoutMs: number;
      };

      try {
        if (input.action === "close") {
          const session = sessions.get(input.sessionId);
          if (!session) return { status: "ok", summary: `Browser session ${input.sessionId} was already closed.` };
          await session.browser.close();
          sessions.delete(input.sessionId);
          return { status: "ok", summary: `Closed browser session ${input.sessionId}.` };
        }

        if (input.action === "open" && !input.url) {
          return { status: "error", summary: "browser open requires url.", error: "Missing url." };
        }
        if ((input.action === "click" || input.action === "type") && !input.selector) {
          return { status: "error", summary: `${input.action} requires selector.`, error: "Missing selector." };
        }
        if (input.action === "type" && input.text === undefined) {
          return { status: "error", summary: "browser type requires text.", error: "Missing text." };
        }
        if (input.action === "press" && !input.key) {
          return { status: "error", summary: "browser press requires key.", error: "Missing key." };
        }
        if (!sessions.has(input.sessionId) && !input.url && input.action !== "open") {
          return { status: "error", summary: "No browser page is open. Call browser open with a url first.", error: "No open page." };
        }

        const session = await ensureSession(input.sessionId);
        if (input.url) {
          await session.page.goto(input.url, { waitUntil: "domcontentloaded", timeout: input.timeoutMs });
        }

        if (input.action === "click" && input.selector) {
          await session.page.locator(input.selector).click({ timeout: input.timeoutMs });
          await session.page.waitForLoadState("domcontentloaded", { timeout: input.timeoutMs }).catch(() => undefined);
        }
        if (input.action === "type" && input.selector) {
          await session.page.locator(input.selector).fill(input.text ?? "", { timeout: input.timeoutMs });
        }
        if (input.action === "press" && input.key) {
          await session.page.keyboard.press(input.key);
          await session.page.waitForLoadState("domcontentloaded", { timeout: input.timeoutMs }).catch(() => undefined);
        }
        if (input.action === "screenshot") {
          mkdirSync(paths.logsDir, { recursive: true });
          const path = join(paths.logsDir, `browser-${safeName(input.sessionId)}-${Date.now()}.png`);
          await session.page.screenshot({ path, fullPage: true });
          return { status: "ok", summary: `Saved browser screenshot to ${path}.`, data: { path, ...(await pageSnapshot(session.page, input.timeoutMs)) } };
        }

        const snapshot = await pageSnapshot(session.page, input.timeoutMs);
        return { status: "ok", summary: `${input.action} ${snapshot.url}.`, data: { sessionId: input.sessionId, ...snapshot } };
      } catch (error) {
        return { status: "error", summary: `Browser ${input.action} failed.`, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async dispose() {
      await Promise.all([...sessions.values()].map((session) => session.browser.close().catch(() => undefined)));
      sessions.clear();
    }
  };
}

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const executablePath = systemBrowserPath();
    if (!executablePath) throw error;
    return chromium.launch({ headless: true, executablePath });
  }
}

async function pageSnapshot(page: Page, timeoutMs: number) {
  const title = await page.title().catch(() => "");
  const text = await page.locator("body").innerText({ timeout: timeoutMs }).catch(() => "");
  const links = await page.locator("a").evaluateAll((items) => items.slice(0, 20).map((item) => ({
    text: item.textContent?.trim() ?? "",
    href: item.getAttribute("href") ?? ""
  }))).catch(() => []);
  return {
    url: page.url(),
    title,
    text: text.slice(0, 20_000),
    links
  };
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 64) || "default";
}

function systemBrowserPath(): string | undefined {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ];
  return candidates.find((candidate) => existsSync(candidate));
}
