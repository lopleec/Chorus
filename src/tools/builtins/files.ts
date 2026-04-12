import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../../core/types.js";
import { resolveToolPath } from "../path.js";

export function fileTools(): ToolDefinition[] {
  return [
    {
      name: "read",
      description: "Read one or more text files.",
      paramsSchema: z.object({
        path: z.string().optional(),
        paths: z.array(z.string()).optional()
      }).refine((value) => Boolean(value.path || value.paths?.length), "Provide path or paths."),
      async execute(params, context) {
        const input = params as { path?: string; paths?: string[] };
        const paths = input.paths ?? (input.path ? [input.path] : []);
        const files = paths.map((path) => {
          const resolved = resolveToolPath(context.cwd, path, context.allowedRoots);
          return { path: resolved, content: readFileSync(resolved, "utf8") };
        });
        return { status: "ok", summary: `Read ${files.length} file(s).`, data: { files } };
      }
    },
    {
      name: "write",
      description: "Create or overwrite a text file.",
      paramsSchema: z.object({ path: z.string(), content: z.string() }),
      async execute(params, context) {
        const input = params as { path: string; content: string };
        const resolved = resolveToolPath(context.cwd, input.path, context.allowedRoots);
        mkdirSync(dirname(resolved), { recursive: true });
        writeFileSync(resolved, input.content, "utf8");
        return { status: "ok", summary: `Wrote ${resolved}.`, data: { path: resolved } };
      }
    },
    {
      name: "edit",
      description: "Append to a file or replace a matching text segment.",
      paramsSchema: z.object({
        path: z.string(),
        search: z.string().optional(),
        replace: z.string().optional(),
        append: z.string().optional()
      }).refine((value) => Boolean(value.append || (value.search !== undefined && value.replace !== undefined)), "Provide append or search+replace."),
      async execute(params, context) {
        const input = params as { path: string; search?: string; replace?: string; append?: string };
        const resolved = resolveToolPath(context.cwd, input.path, context.allowedRoots);
        if (input.append !== undefined) {
          appendFileSync(resolved, input.append, "utf8");
          return { status: "ok", summary: `Appended to ${resolved}.`, data: { path: resolved } };
        }
        const original = readFileSync(resolved, "utf8");
        if (!original.includes(input.search ?? "")) {
          return { status: "error", summary: `Search text not found in ${resolved}.`, error: "Search text not found." };
        }
        writeFileSync(resolved, original.replace(input.search ?? "", input.replace ?? ""), "utf8");
        return { status: "ok", summary: `Edited ${resolved}.`, data: { path: resolved } };
      }
    },
    {
      name: "list",
      description: "List files and folders.",
      paramsSchema: z.object({ path: z.string().default("."), depth: z.number().int().min(0).max(5).default(1) }),
      async execute(params, context) {
        const input = params as { path: string; depth: number };
        const root = resolveToolPath(context.cwd, input.path, context.allowedRoots);
        const entries = listRecursive(root, input.depth, root);
        return { status: "ok", summary: `Listed ${entries.length} entries.`, data: { root, entries } };
      }
    },
    {
      name: "search",
      description: "Search file names and text contents.",
      paramsSchema: z.object({
        path: z.string().default("."),
        query: z.string(),
        depth: z.number().int().min(0).max(8).default(4),
        maxResults: z.number().int().min(1).max(100).default(25)
      }),
      async execute(params, context) {
        const input = params as { path: string; query: string; depth: number; maxResults: number };
        const root = resolveToolPath(context.cwd, input.path, context.allowedRoots);
        const results = searchRecursive(root, input.query.toLowerCase(), input.depth, input.maxResults, root);
        return { status: "ok", summary: `Found ${results.length} match(es).`, data: { root, results } };
      }
    }
  ];
}

function listRecursive(path: string, depth: number, root: string): Array<{ path: string; type: "file" | "directory" }> {
  const stat = statSync(path);
  const type: "file" | "directory" = stat.isDirectory() ? "directory" : "file";
  const current = [{ path: relative(root, path) || ".", type }];
  if (!stat.isDirectory() || depth <= 0) {
    return current;
  }
  for (const name of readdirSync(path)) {
    if (name === "node_modules" || name === ".git") continue;
    current.push(...listRecursive(join(path, name), depth - 1, root));
  }
  return current;
}

function searchRecursive(
  path: string,
  query: string,
  depth: number,
  maxResults: number,
  root: string
): Array<{ path: string; match: "name" | "content"; snippet?: string }> {
  if (maxResults <= 0) return [];
  const stat = statSync(path);
  const rel = relative(root, path) || ".";
  const results: Array<{ path: string; match: "name" | "content"; snippet?: string }> = [];
  if (rel.toLowerCase().includes(query)) {
    results.push({ path: rel, match: "name" });
  }
  if (stat.isFile()) {
    try {
      const content = readFileSync(path, "utf8");
      const index = content.toLowerCase().indexOf(query);
      if (index >= 0) {
        results.push({ path: rel, match: "content", snippet: content.slice(Math.max(0, index - 60), index + query.length + 60) });
      }
    } catch {
      // Binary or unreadable files are ignored by the simple v1 search tool.
    }
  }
  if (!stat.isDirectory() || depth <= 0 || results.length >= maxResults) {
    return results.slice(0, maxResults);
  }
  for (const name of readdirSync(path)) {
    if (name === "node_modules" || name === ".git") continue;
    results.push(...searchRecursive(join(path, name), query, depth - 1, maxResults - results.length, root));
    if (results.length >= maxResults) break;
  }
  return results.slice(0, maxResults);
}
