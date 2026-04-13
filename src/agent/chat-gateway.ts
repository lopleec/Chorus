import type { ChorusSettings } from "../config/settings.js";
import type { ProviderMessage, ProviderStreamChunk, ToolContext, ToolResult } from "../core/types.js";
import type { MemoryStore } from "../memory/memory-store.js";
import type { ProviderRegistry } from "../providers/provider-registry.js";
import type { ToolGateway } from "../tools/gateway.js";
import { GitAutoCommitter, type GitAutoCommitResult } from "./git-auto-commit.js";

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ModelToolCall {
  name: string;
  params: unknown;
}

export interface ChatTurnRequest {
  prompt: string;
  history?: ChatHistoryMessage[];
  context: ToolContext;
  workspace?: string;
  provider?: string;
  model?: string;
  maxTokens?: number;
  maxToolTurns?: number;
  autoCommit?: boolean;
}

export type ChatGatewayEvent =
  | { type: "status"; label: string }
  | { type: "text_delta"; text: string }
  | { type: "assistant_message"; text: string }
  | { type: "tool_call"; call: ModelToolCall; summary: string }
  | { type: "tool_result"; call: ModelToolCall; result: ToolResult; summary: string }
  | { type: "auto_commit"; result: GitAutoCommitResult }
  | { type: "system"; message: string }
  | { type: "error"; error: string }
  | { type: "done"; text: string };

export interface ChatGatewayServices {
  providerRegistry: ProviderRegistry;
  toolGateway: ToolGateway;
  memoryStore?: MemoryStore;
  settings: ChorusSettings;
}

interface ReadIntent {
  kind: "read";
  paths: string[];
}

const absolutePathPattern = /(?:\/[^\s"'`<>|，。！？、,;:!?）)\]]+)+/gu;
const readIntentPattern = /(内容|有什么|看看|看一下|读取|读一下|查看|打开|里面|文件|what.*(content|contain|say)|read|show|open|cat|look|summari[sz]e|summary)/iu;
const toolCallTagPattern = /<chorus_tool_call>\s*([\s\S]*?)\s*<\/chorus_tool_call>/iu;
const defaultMaxModelToolTurns = 4;

export class ChatGateway {
  constructor(private readonly services: ChatGatewayServices) {}

  async *runTurn(request: ChatTurnRequest): AsyncIterable<ChatGatewayEvent> {
    const maxToolTurns = request.maxToolTurns ?? defaultMaxModelToolTurns;
    const autoCommitter = request.autoCommit ? new GitAutoCommitter(request.context.cwd) : undefined;
    const snapshot = autoCommitter ? await autoCommitter.snapshot() : null;
    const memories = this.services.memoryStore?.search({
      keyword: request.prompt,
      workspace: request.workspace,
      topK: 5
    }, { actorId: request.context.actorId, taskId: request.context.taskId }) ?? [];
    const providerMessages = providerConversation(
      request.history ?? [],
      request.prompt,
      this.services.toolGateway.list().map((tool) => tool.name),
      memories.map((memory) => ({
        kind: memory.entry.kind,
        summary: memory.entry.summary,
        body: memory.entry.body ?? "",
        tags: memory.entry.tags
      }))
    );
    const obviousRead = detectReadIntent(request.prompt);
    let finalText = "";

    try {
      for (let turn = 0; turn < maxToolTurns; turn += 1) {
        yield { type: "status", label: turn === 0 ? "model thinking" : "model thinking with tool result" };
        let responseText = "";
        let visibleText = "";
        const suppressVisible = turn === 0 && Boolean(obviousRead);

        for await (const chunk of this.services.providerRegistry.streamText({
          messages: providerMessages,
          model: request.model ?? this.services.settings.model,
          maxTokens: request.maxTokens ?? 1200
        }, request.provider)) {
          const text = chunkText(chunk);
          responseText += text;
          if (!suppressVisible && shouldShowStream(responseText)) {
            const nextVisible = stripModelToolCall(responseText);
            const delta = nextVisible.slice(visibleText.length);
            if (delta) {
              visibleText = nextVisible;
              finalText = nextVisible;
              yield { type: "text_delta", text: delta };
            }
          }
        }

        const toolCall = extractModelToolCall(responseText)
          ?? (turn === 0 && obviousRead ? readIntentToToolCall(obviousRead) : undefined);
        if (!toolCall) {
          const clean = stripModelToolCall(responseText);
          if (!visibleText && clean.trim()) {
            finalText = clean;
            yield { type: "assistant_message", text: clean };
          }
          if (!clean.trim()) {
            finalText = "";
            yield { type: "assistant_message", text: "(empty response)" };
          }
          yield { type: "done", text: finalText };
          return;
        }

        yield { type: "status", label: `calling tool: ${toolCall.name}` };
        yield { type: "tool_call", call: toolCall, summary: toolCallActivityText(toolCall) };
        const result = await this.services.toolGateway.execute(toolCall.name, toolCall.params, request.context);
        yield { type: "tool_result", call: toolCall, result, summary: toolResultActivityText(toolCall, result) };
        providerMessages.push({
          role: "assistant",
          content: responseText.trim() || modelToolCallText(toolCall)
        });
        providerMessages.push({
          role: "user",
          content: [
            `Tool result for ${toolCall.name}:`,
            clip(JSON.stringify(compactToolResult(result), null, 2), 7000),
            "Now continue. If another tool is needed, emit one more <chorus_tool_call> JSON block. Otherwise answer normally."
          ].join("\n")
        });
      }

      yield { type: "system", message: `Stopped after ${maxToolTurns} model-requested tool call(s) to avoid a loop.` };
      yield { type: "done", text: finalText };
    } catch (error) {
      yield { type: "error", error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (autoCommitter) {
        const commit = await autoCommitter.commitChanges(snapshot, autoCommitMessage(request.prompt));
        if (commit.status !== "none") {
          yield { type: "auto_commit", result: commit };
        }
      }
    }
  }
}

export function providerConversation(
  history: ChatHistoryMessage[],
  prompt: string,
  toolNames: string[],
  memories: Array<{ kind: string; summary: string; body?: string; tags: string[] }> = []
): ProviderMessage[] {
  const memoryMessage = memories.length
    ? [{
      role: "system" as const,
      content: [
        "Relevant long-term memory:",
        ...memories.map((memory) => `- (${memory.kind}; tags:${memory.tags.join(",") || "none"}) ${memory.summary}${memory.body ? `\n  ${clip(memory.body, 500)}` : ""}`)
      ].join("\n")
    }]
    : [];

  return [
    {
      role: "system",
      content: [
        "You are Chorus inside a local agent runtime. Be concise and practical.",
        "You may request local tools when needed. To call one tool, respond with exactly one JSON object inside these tags and no other prose:",
        '<chorus_tool_call>{"tool":"read","params":{"path":"/absolute/or/relative/path"}}</chorus_tool_call>',
        `Available tools: ${toolNames.join(", ")}.`,
        "Useful params: read {path} or {paths}; list {path, depth}; search {path, query, depth, maxResults}; memory {action:'search', keyword, topK}; browser {action, url, selector, text}; skills {action, name, query}; contact {recipientId, body}; read_inbox {recipientId}; bash {command, cwd}.",
        "If the user includes a local file path and asks what it contains, asks for a summary, or provides only a path, you must call read before answering.",
        "Use skills when the task matches a local Skill, memory for durable context, browser for interactive web pages, and read_inbox/contact for agent coordination.",
        "Use bash only for harmless commands. Never say you will use a tool unless you emit the tool-call block.",
        "After a tool result is returned, answer normally unless another tool is required."
      ].join("\n")
    },
    ...memoryMessage,
    ...history.slice(-10).map((message) => ({
      role: message.role,
      content: message.content
    })),
    { role: "user", content: prompt }
  ];
}

export function extractModelToolCall(text: string): ModelToolCall | undefined {
  const tagged = toolCallTagPattern.exec(text);
  const candidate = tagged?.[1] ?? (looksLikeToolCallJson(text) ? text.trim() : undefined);
  if (!candidate) return undefined;
  try {
    const parsed = JSON.parse(candidate) as { tool?: unknown; name?: unknown; params?: unknown };
    const name = typeof parsed.tool === "string" ? parsed.tool : typeof parsed.name === "string" ? parsed.name : "";
    if (!name) return undefined;
    return { name, params: parsed.params ?? {} };
  } catch {
    return undefined;
  }
}

export function detectReadIntent(text: string): ReadIntent | undefined {
  const paths = extractAbsolutePaths(text);
  if (paths.length === 0 || (!readIntentPattern.test(text) && !isOnlyPaths(text, paths))) {
    return undefined;
  }
  return { kind: "read", paths };
}

export function extractAbsolutePaths(text: string): string[] {
  const matches = text.match(absolutePathPattern) ?? [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const match of matches) {
    const cleaned = cleanPath(match);
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      paths.push(cleaned);
    }
  }
  return paths;
}

export function toolCallActivityText(call: ModelToolCall): string {
  const params = summarizeToolParams(call.params);
  return `agent tool call: ${call.name}${params ? ` ${params}` : ""}`;
}

function toolResultActivityText(call: ModelToolCall, result: ToolResult): string {
  return `agent tool result: ${call.name} ${result.status} - ${clip(result.summary, 220)}`;
}

function looksLikeToolCallJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}") && /"(tool|name)"\s*:/u.test(trimmed);
}

function shouldShowStream(buffer: string): boolean {
  const trimmed = buffer.trimStart();
  if (!trimmed) return false;
  return !"<chorus_tool_call>".startsWith(trimmed) && !trimmed.startsWith("<chorus_tool_call>");
}

function stripModelToolCall(text: string): string {
  return text.replace(toolCallTagPattern, "").trim();
}

function readIntentToToolCall(intent: ReadIntent): ModelToolCall {
  return {
    name: "read",
    params: intent.paths.length === 1 ? { path: intent.paths[0] } : { paths: intent.paths }
  };
}

function modelToolCallText(call: ModelToolCall): string {
  return `<chorus_tool_call>${JSON.stringify({ tool: call.name, params: call.params })}</chorus_tool_call>`;
}

function compactToolResult(result: { status: string; summary: string; data?: unknown; error?: string; risk?: string }) {
  return {
    status: result.status,
    summary: result.summary,
    data: shrinkForModel(result.data),
    error: result.error,
    risk: result.risk
  };
}

function shrinkForModel(value: unknown): unknown {
  if (typeof value === "string") return clip(value, 6000);
  if (Array.isArray(value)) return value.map((item) => shrinkForModel(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shrinkForModel(item)]));
}

function summarizeToolParams(params: unknown): string {
  const json = JSON.stringify(redactSensitive(params));
  if (!json || json === "{}") return "";
  return clip(json, 220);
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/(api[_-]?key|token|secret|password|authorization)/iu.test(key)) {
      return [key, "[redacted]"];
    }
    return [key, redactSensitive(item)];
  }));
}

function cleanPath(path: string): string {
  return path.replace(/[，。！？、,;:!?）)\]]+$/u, "");
}

function isOnlyPaths(text: string, paths: string[]): boolean {
  let remaining = text;
  for (const path of paths) {
    const index = remaining.indexOf(path);
    if (index >= 0) {
      remaining = `${remaining.slice(0, index)}${remaining.slice(index + path.length)}`;
    }
  }
  return remaining.replace(/[\s，。！？、,;:!?()[\]{}"'`<>|]+/gu, "").length === 0;
}

function chunkText(chunk: ProviderStreamChunk): string {
  return typeof chunk.text === "string" ? chunk.text : "";
}

function autoCommitMessage(prompt: string): string {
  return `Chorus auto-commit: ${clip(prompt.replace(/\s+/gu, " ").trim(), 56) || "chat changes"}`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
