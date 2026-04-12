import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";

export function webTool(): ToolDefinition {
  return {
    name: "web",
    description: "Open/read simple web pages, with optional Playwright browser read.",
    paramsSchema: z.object({
      action: z.enum(["read", "open", "browser_read", "browser_click", "browser_type", "search"]).default("read"),
      url: z.string().optional(),
      query: z.string().optional(),
      selector: z.string().optional(),
      text: z.string().optional(),
      timeoutMs: z.number().int().min(1000).max(120_000).default(30_000)
    }).refine((value) => Boolean(value.url || value.query), "Provide url or query."),
    async execute(params) {
      const input = params as {
        action: "read" | "open" | "browser_read" | "browser_click" | "browser_type" | "search";
        url?: string;
        query?: string;
        selector?: string;
        text?: string;
        timeoutMs: number;
      };
      const url = input.url ?? `https://duckduckgo.com/html/?q=${encodeURIComponent(input.query ?? "")}`;
      if (input.action === "browser_read" || input.action === "browser_click" || input.action === "browser_type") {
        if ((input.action === "browser_click" || input.action === "browser_type") && !input.selector) {
          return { status: "error", summary: `${input.action} requires selector.`, error: "Missing selector." };
        }
        if (input.action === "browser_type" && input.text === undefined) {
          return { status: "error", summary: "browser_type requires text.", error: "Missing text." };
        }
        try {
          const { chromium } = await import("playwright");
          const browser = await chromium.launch({ headless: true });
          const page = await browser.newPage();
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: input.timeoutMs });
          if (input.action === "browser_click" && input.selector) {
            await page.locator(input.selector).click({ timeout: input.timeoutMs });
          }
          if (input.action === "browser_type" && input.selector) {
            await page.locator(input.selector).fill(input.text ?? "", { timeout: input.timeoutMs });
          }
          const title = await page.title();
          const text = await page.locator("body").innerText({ timeout: input.timeoutMs }).catch(() => "");
          await browser.close();
          return { status: "ok", summary: `${input.action} ${url}.`, data: { url, title, text: text.slice(0, 20_000) } };
        } catch (error) {
          return { status: "error", summary: "Playwright browser read failed.", error: (error as Error).message };
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Chorus/0.1" } });
        const html = await response.text();
        const title = html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
        const text = stripHtml(html).slice(0, 20_000);
        return { status: response.ok ? "ok" : "error", summary: `Read ${url} -> ${response.status}.`, data: { url, status: response.status, title, text } };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
