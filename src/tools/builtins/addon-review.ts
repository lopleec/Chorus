import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ChorusDatabase } from "../../data/sqlite.js";
import type { ToolDefinition } from "../../core/types.js";
import { createId } from "../../core/ids.js";
import { nowIso } from "../../core/time.js";

export function addonReviewTools(database: ChorusDatabase): ToolDefinition[] {
  return [
    {
      name: "install_addon",
      description: "Request local plugin/skill/MCP addon installation review.",
      paramsSchema: z.object({
        source: z.string(),
        addonType: z.enum(["plugin", "skill", "mcp"]),
        cooldownMinutes: z.number().int().min(0).max(24 * 60).default(10)
      }),
      async execute(params) {
        const input = params as { source: string; addonType: string; cooldownMinutes: number };
        const review = reviewLocalAddon(input.source);
        const id = createId("addon");
        const at = nowIso();
        database.db.prepare(
          `INSERT INTO addon_reviews
            (id, source, addon_type, status, risk_summary, findings_json, requested_at, reviewed_at, cooldown_until)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, input.source, input.addonType, "reviewed", review.riskSummary, JSON.stringify(review.findings), at, at, null);
        return { status: "ok", summary: `Created addon review ${id}: ${review.riskSummary}`, data: { id, ...review } };
      }
    },
    {
      name: "allow",
      description: "Allow a reviewed addon after security review.",
      paramsSchema: z.object({ reviewId: z.string(), cooldownMinutes: z.number().int().min(0).max(24 * 60).default(10) }),
      async execute(params, context) {
        if (context.actorRole !== "security_review") {
          return { status: "blocked", summary: "Only the security review agent can allow addons.", risk: "addon approval role boundary" };
        }
        const input = params as { reviewId: string; cooldownMinutes: number };
        const cooldownUntil = new Date(Date.now() + input.cooldownMinutes * 60_000).toISOString();
        database.db.prepare("UPDATE addon_reviews SET status = ?, reviewed_at = ?, cooldown_until = ? WHERE id = ?").run("allowed", nowIso(), cooldownUntil, input.reviewId);
        return { status: "ok", summary: `Allowed addon ${input.reviewId}; cooldown until ${cooldownUntil}.`, data: { reviewId: input.reviewId, cooldownUntil } };
      }
    },
    {
      name: "decline",
      description: "Decline a reviewed addon.",
      paramsSchema: z.object({ reviewId: z.string(), reason: z.string() }),
      async execute(params, context) {
        if (context.actorRole !== "security_review") {
          return { status: "blocked", summary: "Only the security review agent can decline addons.", risk: "addon approval role boundary" };
        }
        const input = params as { reviewId: string; reason: string };
        database.db.prepare("UPDATE addon_reviews SET status = ?, risk_summary = ?, reviewed_at = ? WHERE id = ?").run("declined", input.reason, nowIso(), input.reviewId);
        return { status: "ok", summary: `Declined addon ${input.reviewId}: ${input.reason}` };
      }
    }
  ];
}

function reviewLocalAddon(source: string): { riskSummary: string; findings: string[] } {
  const findings: string[] = [];
  try {
    const files = collectFiles(source, 3).slice(0, 80);
    for (const file of files) {
      const text = readFileSync(file, "utf8").slice(0, 200_000);
      if (/ignore (all )?(previous|above) instructions/i.test(text)) findings.push(`${file}: prompt-injection phrase`);
      if (/\bsudo\b|\brm\s+-rf\b|\bcurl\b.+\|\s*(sh|bash)/i.test(text)) findings.push(`${file}: dangerous shell pattern`);
      if (/"postinstall"\s*:/i.test(text)) findings.push(`${file}: package postinstall script`);
      if (/process\.env|keychain|credential/i.test(text)) findings.push(`${file}: credential-sensitive access`);
    }
  } catch (error) {
    findings.push(`review read failed: ${(error as Error).message}`);
  }
  return {
    riskSummary: findings.length ? `${findings.length} finding(s) require review.` : "No obvious high-risk patterns found.",
    findings
  };
}

function collectFiles(path: string, depth: number): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory() || depth <= 0) return [];
  const files: string[] = [];
  for (const name of readdirSync(path)) {
    if (name === "node_modules" || name === ".git") continue;
    files.push(...collectFiles(join(path, name), depth - 1));
  }
  return files;
}
