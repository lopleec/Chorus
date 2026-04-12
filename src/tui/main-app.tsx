import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import type { ProviderMessage, ToolContext } from "../core/types.js";
import type { ChorusRuntime } from "../runtime/create-runtime.js";

interface TuiMessage {
  id: string;
  from: "user" | "chorus" | "system" | "tool";
  text: string;
}

interface RenderLine {
  from: TuiMessage["from"];
  text: string;
  style: "normal" | "heading" | "quote" | "code" | "list" | "rule";
}

interface CommandItem {
  label: string;
  value: SlashCommandName;
}

type SlashCommandName =
  | "status"
  | "clear"
  | "help"
  | "quit";

interface ParsedSlashCommand {
  name: string;
  args: string;
}

interface ReadIntent {
  kind: "read";
  paths: string[];
}

interface ModelToolCall {
  name: string;
  params: unknown;
}

interface TerminalSize {
  columns: number;
  rows: number;
}

export interface MainTuiAppProps {
  runtime: ChorusRuntime;
  onExit(): void;
}

const commandItems: CommandItem[] = [
  { label: "/status             show status", value: "status" },
  { label: "/clear              clear conversation", value: "clear" },
  { label: "/help               show commands", value: "help" },
  { label: "/quit               quit", value: "quit" }
];

const commandNameSet = new Set<string>(commandItems.map((item) => item.value));
const absolutePathPattern = /(?:\/[^\s"'`<>|，。！？、,;:!?）)\]]+)+/gu;
const readIntentPattern = /(内容|有什么|看看|看一下|读取|读一下|查看|打开|里面|文件|what.*(content|contain|say)|read|show|open|cat|look)/iu;
const toolCallTagPattern = /<chorus_tool_call>\s*([\s\S]*?)\s*<\/chorus_tool_call>/iu;
const mouseReportPattern = /(?:\x1b)?\[<(\d+)[;:]\d+[;:]\d+[mM]/gu;
const maxModelToolTurns = 4;

function initialMessage(): TuiMessage {
  return {
    id: "initial",
    from: "chorus",
    text: "Ready. Chat naturally. Agent tools are internal. / opens UI commands."
  };
}

export function MainTuiApp({ runtime, onExit }: MainTuiAppProps) {
  const app = useApp();
  const terminal = useTerminalSize();
  useMouseWheelReporting();
  const messageCounter = useRef(0);
  const [messages, setMessages] = useState<TuiMessage[]>(() => [initialMessage()]);
  const [input, setInput] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const frameWidth = clamp(48, terminal.columns - 2, 88);
  const innerWidth = Math.max(24, frameWidth - 4);
  const paletteLimit = clamp(4, terminal.rows - 14, 8);
  const viewportHeight = Math.max(6, terminal.rows - (paletteOpen ? paletteLimit + 12 : 9));
  const activeProvider = process.env.CHORUS_PROVIDER ?? runtime.settings.provider;
  const activeModel = process.env.CHORUS_MODEL ?? runtime.settings.model;

  const monitor = useMemo(() => {
    const tasks = runtime.scheduler.listTasks();
    const agents = runtime.subAgentManager.list();
    return {
      tasks,
      agents,
      tools: runtime.toolGateway.list(),
      refresh
    };
  }, [runtime, refresh]);

  const visibleCommandItems = useMemo(
    () => commandItems.map((item) => ({
      ...item,
      label: truncateDisplay(item.label, Math.max(20, innerWidth - 4))
    })),
    [innerWidth]
  );

  const messageLines = useMemo(() => flattenMessages(messages, innerWidth), [messages, innerWidth]);
  const maxScroll = Math.max(0, messageLines.length - viewportHeight);
  const normalizedScroll = Math.min(scrollOffset, maxScroll);
  const firstVisibleLine = Math.max(0, messageLines.length - viewportHeight - normalizedScroll);
  const visibleLines = messageLines.slice(firstVisibleLine, firstVisibleLine + viewportHeight);

  const addMessage = (message: TuiMessage) => {
    setMessages((current) => [...current, message]);
    setScrollOffset(0);
  };

  const pushMessage = (from: TuiMessage["from"], text: string): string => {
    const id = `msg-${Date.now()}-${messageCounter.current++}`;
    addMessage({ id, from, text });
    return id;
  };

  const updateMessage = (id: string, text: string) => {
    setMessages((current) => current.map((message) => message.id === id ? { ...message, text } : message));
    setScrollOffset(0);
  };

  const close = () => {
    onExit();
    app.exit();
  };

  useInput((char, key) => {
    const wheelDelta = mouseWheelDelta(char);
    if (isMouseReport(char)) {
      if (!paletteOpen && !busy && wheelDelta !== 0) {
        setScrollOffset((offset) => Math.max(0, Math.min(maxScroll, offset + wheelDelta)));
      }
      return;
    }
    if (key.escape && paletteOpen) {
      setPaletteOpen(false);
      setInput("");
      return;
    }
    if (paletteOpen && !busy) {
      if (key.backspace || key.delete) {
        const next = input.slice(0, -1);
        setInput(next);
        setPaletteOpen(isSlashCommandPrefix(next));
        return;
      }
      if (!key.return && !key.upArrow && !key.downArrow && !key.pageUp && !key.pageDown && !key.ctrl && !key.meta && char) {
        const next = `${input}${char}`;
        setInput(next);
        setPaletteOpen(isSlashCommandPrefix(next));
        return;
      }
    }
    if (key.ctrl && char === "c") {
      close();
      return;
    }
    if (!paletteOpen && !busy && key.upArrow) {
      setScrollOffset((offset) => Math.min(maxScroll, offset + 1));
      return;
    }
    if (!paletteOpen && !busy && key.downArrow) {
      setScrollOffset((offset) => Math.max(0, offset - 1));
      return;
    }
    if (!paletteOpen && !busy && key.pageUp) {
      setScrollOffset((offset) => Math.min(maxScroll, offset + viewportHeight));
      return;
    }
    if (!paletteOpen && !busy && key.pageDown) {
      setScrollOffset((offset) => Math.max(0, offset - viewportHeight));
    }
  });

  const updateInput = (value: string) => {
    const cleanValue = stripMouseReports(value);
    setInput(cleanValue);
    if (cleanValue === "/") {
      setPaletteOpen(true);
      return;
    }
    setPaletteOpen(isSlashCommandPrefix(cleanValue));
  };

  const chooseCommand = async (item: CommandItem) => {
    setPaletteOpen(false);
    await submitInput(`/${item.value}`);
  };

  const submitInput = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    pushMessage("user", trimmed);
    setInput("");
    setPaletteOpen(false);
    setBusy(true);
    try {
      if (isKnownSlashCommandInput(trimmed)) {
        await runSlashCommand(trimmed);
        return;
      }

      await askProviderWithTools(trimmed);
    } catch (error) {
      pushMessage("system", `Error: ${(error as Error).message}`);
    } finally {
      setBusy(false);
      setRefresh((value) => value + 1);
    }
  };

  const runSlashCommand = async (raw: string) => {
    const command = parseSlashCommand(raw);
    if (!command) {
      pushMessage("system", "Type / to choose a command, or /help to list them.");
      return;
    }

    switch (command.name) {
      case "status":
        pushMessage("tool", statusLine(activeProvider, monitor.tasks.length, monitor.agents.length));
        return;
      case "clear":
        setMessages([initialMessage()]);
        setScrollOffset(0);
        return;
      case "help":
        pushMessage("tool", commandItems.map((item) => item.label).join("\n"));
        return;
      case "quit":
        close();
        return;
      default:
        pushMessage("system", `Unknown command /${command.name}. Type /help for commands.`);
    }
  };

  const askProviderWithTools = async (prompt: string) => {
    const providerMessages = providerConversation(messages, prompt, runtime.toolGateway.list().map((tool) => tool.name));
    const obviousRead = detectReadIntent(prompt);

    for (let turn = 0; turn < maxModelToolTurns; turn += 1) {
      const responseText = await streamProviderTurn(providerMessages, turn === 0 && Boolean(obviousRead));
      const toolCall = extractModelToolCall(responseText)
        ?? (turn === 0 && obviousRead ? readIntentToToolCall(obviousRead) : undefined);
      if (!toolCall) {
        if (!responseText.trim()) {
          pushMessage("chorus", "(empty response)");
        }
        return;
      }

      pushMessage("tool", agentActivityText(toolCall.name));
      const result = await runtime.toolGateway.execute(toolCall.name, toolCall.params, toolContext());
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
      continue;
    }

    pushMessage("system", `Stopped after ${maxModelToolTurns} model-requested tool call(s) to avoid a loop.`);
  };

  const streamProviderTurn = async (providerMessages: ProviderMessage[], suppressVisible = false): Promise<string> => {
    let id: string | undefined;
    let buffer = "";
    for await (const chunk of runtime.providerRegistry.streamText({
        messages: providerMessages,
        model: runtime.settings.model,
        maxTokens: 1200
      })) {
      buffer += chunk.text;
      if (!suppressVisible && shouldShowStream(buffer)) {
        id ??= pushMessage("chorus", "");
        updateMessage(id, stripModelToolCall(buffer));
      }
    }
    if (!suppressVisible && !id && !extractModelToolCall(buffer) && buffer.trim()) {
      pushMessage("chorus", stripModelToolCall(buffer));
    }
    return buffer;
  };

  const toolContext = (): ToolContext => ({
    actorId: "tui",
    actorRole: "main",
    cwd: process.cwd()
  });

  return (
    <Box flexDirection="column" paddingX={1} width={frameWidth + 2} overflow="hidden">
      <Box width={frameWidth} borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column" marginBottom={1}>
        <Text bold>› Chorus <Text dimColor>(v0.1.0)</Text></Text>
        <Text dimColor>model: <Text color="white">{activeModel ?? "(default)"}</Text>  provider: <Text color="cyan">{activeProvider}</Text></Text>
        <Text dimColor>directory: {truncateDisplay(process.cwd(), Math.max(12, innerWidth - 11))}</Text>
      </Box>

      <Box width={frameWidth} height={viewportHeight} flexDirection="column" overflow="hidden">
        {visibleLines.length === 0 ? <Text dimColor> </Text> : visibleLines.map((line, index) => (
          <Text
            key={`${firstVisibleLine}-${index}-${line.from}`}
            color={messageColor(line)}
            bold={line.style === "heading"}
            dimColor={line.style === "quote"}
            wrap="truncate-end"
          >
            {line.text}
          </Text>
        ))}
      </Box>

      <Box width={frameWidth} minHeight={1}>
        <Text dimColor>{statusLine(activeProvider, monitor.tasks.length, monitor.agents.length)} | {busy ? "busy" : "ready"} | {scrollHint(normalizedScroll, maxScroll)}</Text>
      </Box>

      {paletteOpen ? (
        <Box width={frameWidth} borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column" marginTop={1}>
          <Text dimColor>Commands</Text>
          <SelectInput items={visibleCommandItems} onSelect={chooseCommand} isFocused={!busy} limit={paletteLimit} />
          <Text dimColor>Esc closes. Enter selects.</Text>
        </Box>
      ) : null}

      <Box width={frameWidth} borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
        <Text color={busy ? "gray" : "white"}>{busy ? "…" : "› "}</Text>
        <TextInput value={input} onChange={updateInput} onSubmit={submitInput} focus={!busy && !paletteOpen} />
      </Box>
    </Box>
  );
}

function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const readSize = () => ({
    columns: stdout.columns || process.stdout.columns || 80,
    rows: stdout.rows || process.stdout.rows || 24
  });
  const [size, setSize] = useState<TerminalSize>(readSize);

  useEffect(() => {
    const onResize = () => {
      setSize(readSize());
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}

function useMouseWheelReporting(): void {
  const { stdout } = useStdout();
  useEffect(() => {
    stdout.write("\x1b[?1000h\x1b[?1006h");
    return () => {
      stdout.write("\x1b[?1000l\x1b[?1006l");
    };
  }, [stdout]);
}

function providerConversation(messages: TuiMessage[], prompt: string, toolNames: string[]): ProviderMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are Chorus inside a terminal TUI. Be concise and practical.",
        "You may request local tools when needed. To call one tool, respond with exactly one JSON object inside these tags and no other prose:",
        '<chorus_tool_call>{"tool":"read","params":{"path":"/absolute/or/relative/path"}}</chorus_tool_call>',
        `Available tools: ${toolNames.join(", ")}.`,
        "Useful params: read {path} or {paths}; list {path, depth}; search {path, query, depth, maxResults}; memory {action:'search', keyword, topK}; bash {command, cwd}.",
        "If the user includes a local file path and asks what it contains, asks for a summary, or provides only a path, you must call read before answering.",
        "Use read/list/search/memory for information gathering. Use bash only for harmless commands. Never say you will use a tool unless you emit the tool-call block.",
        "After a tool result is returned, answer normally unless another tool is required."
      ].join("\n")
    },
    ...messages
      .filter((message) => message.from === "user" || message.from === "chorus")
      .slice(-10)
      .map((message) => ({
        role: message.from === "user" ? "user" as const : "assistant" as const,
        content: message.text
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

function looksLikeToolCallJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}") && /"(tool|name)"\s*:/u.test(trimmed);
}

function stripModelToolCall(text: string): string {
  return text.replace(toolCallTagPattern, "").trim();
}

function shouldShowStream(buffer: string): boolean {
  const trimmed = buffer.trimStart();
  if (!trimmed) return false;
  return !"<chorus_tool_call>".startsWith(trimmed) && !trimmed.startsWith("<chorus_tool_call>");
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

function agentActivityText(toolName: string): string {
  if (toolName === "read") return "agent is reading context...";
  if (toolName === "search") return "agent is searching context...";
  if (toolName === "list") return "agent is checking files...";
  if (toolName === "memory") return "agent is recalling memory...";
  if (toolName === "bash") return "agent is running a guarded command...";
  if (toolName === "opencode") return "agent is asking OpenCode...";
  return "agent is using an internal tool...";
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

function parseSlashCommand(raw: string): ParsedSlashCommand | undefined {
  const text = raw.trim();
  if (!text.startsWith("/")) return undefined;
  const body = text.slice(1).trim();
  if (!body) return undefined;
  const [name, args] = splitFirstWord(body);
  return { name: name.toLowerCase(), args: args.trim() };
}

function splitFirstWord(text: string): [string, string] {
  const trimmed = text.trim();
  if (!trimmed) return ["", ""];
  const firstSpace = trimmed.search(/\s/u);
  if (firstSpace < 0) return [trimmed, ""];
  return [trimmed.slice(0, firstSpace), trimmed.slice(firstSpace + 1)];
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

function cleanPath(path: string): string {
  return path.replace(/[，。！？、,;:!?）)\]]+$/u, "");
}

export function isKnownSlashCommandInput(text: string): boolean {
  const command = parseSlashCommand(text);
  return Boolean(command && commandNameSet.has(command.name));
}

export function stripMouseReports(input: string): string {
  return input.replace(mouseReportPattern, "");
}

export function isMouseReport(input: string): boolean {
  mouseReportPattern.lastIndex = 0;
  const found = mouseReportPattern.test(input);
  mouseReportPattern.lastIndex = 0;
  return found;
}

export function mouseWheelDelta(input: string): number {
  let delta = 0;
  mouseReportPattern.lastIndex = 0;
  for (const match of input.matchAll(mouseReportPattern)) {
    const button = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(button) || button < 64) continue;
    const direction = (button - 64) % 4;
    if (direction === 0) delta += 3;
    if (direction === 1) delta -= 3;
  }
  mouseReportPattern.lastIndex = 0;
  return delta;
}

function isSlashCommandPrefix(text: string): boolean {
  if (!text.startsWith("/")) return false;
  const body = text.slice(1);
  if (body === "") return true;
  if (/\s/u.test(body)) return false;
  const lowered = body.toLowerCase();
  return commandItems.some((item) => item.value.startsWith(lowered));
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

function flattenMessages(messages: TuiMessage[], width: number): RenderLine[] {
  const lines: RenderLine[] = [];
  for (const message of messages) {
    const prefixText = prefix(message.from);
    const rendered = message.from === "chorus" ? markdownLines(message.text) : plainLines(message.text);
    rendered.forEach((line, index) => {
      const prefix = index === 0 ? `${prefixText} ` : continuationPrefix(prefixText);
      const wrapped = wrapDisplay(`${prefix}${line.text}`, width);
      for (const text of wrapped) {
        lines.push({ from: message.from, text, style: line.style });
      }
    });
  }
  return lines;
}

function plainLines(text: string): Array<{ text: string; style: RenderLine["style"] }> {
  return text.split("\n").map((line) => ({ text: line, style: "normal" }));
}

export function markdownLines(markdown: string): Array<{ text: string; style: RenderLine["style"] }> {
  const lines: Array<{ text: string; style: RenderLine["style"] }> = [];
  let inFence = false;
  let fenceLabel = "";

  for (const rawLine of markdown.split("\n")) {
    const trimmed = rawLine.trim();
    const fence = /^```+\s*([^`]*)$/u.exec(trimmed);
    if (fence) {
      inFence = !inFence;
      fenceLabel = inFence ? (fence[1]?.trim() || "code") : "";
      lines.push({ text: inFence ? `--- ${fenceLabel} ---` : "---", style: "code" });
      continue;
    }
    if (inFence) {
      lines.push({ text: rawLine || " ", style: "code" });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/u.test(trimmed)) {
      lines.push({ text: "----------------", style: "rule" });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(rawLine);
    if (heading) {
      lines.push({ text: cleanInlineMarkdown(heading[2] ?? "").toUpperCase(), style: "heading" });
      continue;
    }

    const quote = /^>\s?(.*)$/u.exec(rawLine);
    if (quote) {
      lines.push({ text: `| ${cleanInlineMarkdown(quote[1] ?? "")}`, style: "quote" });
      continue;
    }

    const list = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/u.exec(rawLine);
    if (list) {
      const indent = list[1] ?? "";
      const marker = list[2] ?? "-";
      lines.push({ text: `${indent}${marker} ${cleanInlineMarkdown(list[3] ?? "")}`, style: "list" });
      continue;
    }

    lines.push({ text: cleanInlineMarkdown(rawLine), style: "normal" });
  }

  return lines.length ? lines : [{ text: "", style: "normal" }];
}

function cleanInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/\*([^*]+)\*/gu, "$1")
    .replace(/_([^_]+)_/gu, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1 ($2)");
}

function continuationPrefix(prefixText: string): string {
  return " ".repeat(displayTextWidth(prefixText) + 1);
}

export function wrapDisplay(text: string, maxWidth: number): string[] {
  const safeWidth = Math.max(8, maxWidth);
  const output: string[] = [];
  for (const rawLine of text.split("\n")) {
    let current = "";
    let width = 0;
    for (const char of [...rawLine]) {
      const nextWidth = displayWidth(char);
      if (width > 0 && width + nextWidth > safeWidth) {
        output.push(current);
        current = "";
        width = 0;
      }
      current += char;
      width += nextWidth;
    }
    output.push(current || " ");
  }
  return output;
}

function truncateDisplay(text: string, maxWidth: number): string {
  const safeWidth = Math.max(4, maxWidth);
  let result = "";
  let width = 0;
  for (const char of [...text]) {
    const nextWidth = displayWidth(char);
    if (width + nextWidth > safeWidth - 1) {
      return `${result}…`;
    }
    result += char;
    width += nextWidth;
  }
  return result;
}

function displayWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0x200d || code === 0xfe0f || (code >= 0x300 && code <= 0x36f)) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1faff)
  ) {
    return 2;
  }
  return 1;
}

function displayTextWidth(text: string): number {
  return [...text].reduce((width, char) => width + displayWidth(char), 0);
}

function messageColor(line: RenderLine): "yellow" | "white" | "red" | "cyan" | "green" | "gray" {
  if (line.from === "user") return "yellow";
  if (line.from === "system") return "red";
  if (line.from === "tool") return "cyan";
  if (line.style === "heading") return "green";
  if (line.style === "code" || line.style === "rule") return "cyan";
  if (line.style === "quote") return "gray";
  return "white";
}

function prefix(from: TuiMessage["from"]): string {
  if (from === "user") return "›";
  if (from === "tool") return "tool:";
  if (from === "system") return "!";
  return "chorus:";
}

function statusLine(provider: string, tasks: number, agents: number): string {
  return `tasks ${tasks} | sub-agents ${agents} | ${provider}`;
}

function scrollHint(scrollOffset: number, maxScroll: number): string {
  return maxScroll > 0 ? `scroll ${scrollOffset}/${maxScroll} ↑↓` : "scroll 0/0";
}

function clamp(min: number, value: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
