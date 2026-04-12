import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import type { ProviderMessage, ToolContext, ToolResult } from "../core/types.js";
import type { ChorusRuntime } from "../runtime/create-runtime.js";

interface TuiMessage {
  from: "user" | "chorus" | "system" | "tool";
  text: string;
}

interface RenderLine {
  from: TuiMessage["from"];
  text: string;
}

interface CommandItem {
  label: string;
  value: SlashCommandName;
}

type SlashCommandName =
  | "ask"
  | "read"
  | "list"
  | "search"
  | "memory"
  | "opencode"
  | "bash"
  | "tool"
  | "tools"
  | "subagents"
  | "status"
  | "kill"
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
  { label: "/read <path>        read a file", value: "read" },
  { label: "/list [path]        list files", value: "list" },
  { label: "/search <text>      search files", value: "search" },
  { label: "/memory <keyword>   search memory", value: "memory" },
  { label: "/opencode <msg>     opencode run [message]", value: "opencode" },
  { label: "/bash <command>     guarded shell", value: "bash" },
  { label: "/tool <name> <json> run any tool", value: "tool" },
  { label: "/tools              list tools", value: "tools" },
  { label: "/subagents          list sub-agents", value: "subagents" },
  { label: "/status             show status", value: "status" },
  { label: "/kill               stop sub-agents", value: "kill" },
  { label: "/help               show commands", value: "help" },
  { label: "/ask <message>      force chat", value: "ask" },
  { label: "/quit               quit", value: "quit" }
];

const commandsNeedingInput = new Set<SlashCommandName>(["ask", "read", "list", "search", "memory", "opencode", "bash", "tool"]);
const absolutePathPattern = /(?:\/[^\s"'`<>|，。！？、,;:!?）)\]]+)+/gu;
const readIntentPattern = /(内容|有什么|看看|看一下|读取|读一下|查看|打开|里面|文件|what.*(content|contain|say)|read|show|open|cat|look)/iu;
const toolCallTagPattern = /<chorus_tool_call>\s*([\s\S]*?)\s*<\/chorus_tool_call>/iu;
const maxModelToolTurns = 4;

export function MainTuiApp({ runtime, onExit }: MainTuiAppProps) {
  const app = useApp();
  const terminal = useTerminalSize();
  const [messages, setMessages] = useState<TuiMessage[]>([
    {
      from: "chorus",
      text: "Ready. Ask naturally, paste a file path, or type / for commands."
    }
  ]);
  const [input, setInput] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const frameWidth = clamp(48, terminal.columns - 2, 88);
  const innerWidth = Math.max(24, frameWidth - 4);
  const paletteLimit = clamp(4, terminal.rows - 14, 8);
  const viewportHeight = Math.max(6, terminal.rows - (paletteOpen ? paletteLimit + 12 : 9));

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

  const close = () => {
    onExit();
    app.exit();
  };

  useInput((char, key) => {
    if (key.escape && paletteOpen) {
      setPaletteOpen(false);
      setInput("");
      return;
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
    setInput(value);
    if (value === "/") {
      setPaletteOpen(true);
      return;
    }
    if (!value.startsWith("/")) {
      setPaletteOpen(false);
    }
  };

  const chooseCommand = async (item: CommandItem) => {
    setPaletteOpen(false);
    if (commandsNeedingInput.has(item.value)) {
      setInput(`/${item.value} `);
      return;
    }
    await submitInput(`/${item.value}`);
  };

  const submitInput = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    addMessage({ from: "user", text: trimmed });
    setInput("");
    setPaletteOpen(false);
    setBusy(true);
    try {
      if (trimmed.startsWith("/")) {
        await runSlashCommand(trimmed);
        return;
      }

      const readIntent = detectReadIntent(trimmed);
      if (readIntent) {
        await runRead(readIntent.paths);
        return;
      }

      await askProviderWithTools(trimmed);
    } catch (error) {
      addMessage({ from: "system", text: `Error: ${(error as Error).message}` });
    } finally {
      setBusy(false);
      setRefresh((value) => value + 1);
    }
  };

  const runSlashCommand = async (raw: string) => {
    const command = parseSlashCommand(raw);
    if (!command) {
      addMessage({ from: "system", text: "Type / to choose a command, or /help to list them." });
      return;
    }

    switch (command.name) {
      case "ask":
        if (!command.args) {
          addMessage({ from: "system", text: "Usage: /ask <message>" });
          return;
        }
        await askProviderWithTools(command.args);
        return;
      case "read":
        await runRead(parsePathList(command.args));
        return;
      case "list":
        await runTool("list", { path: command.args || ".", depth: 2 });
        return;
      case "search":
        if (!command.args) {
          addMessage({ from: "system", text: "Usage: /search <text>" });
          return;
        }
        await runTool("search", { path: ".", query: command.args, depth: 4, maxResults: 25 });
        return;
      case "memory":
        if (!command.args) {
          addMessage({ from: "system", text: "Usage: /memory <keyword>" });
          return;
        }
        await runTool("memory", { action: "search", keyword: command.args, topK: 5 });
        return;
      case "opencode":
        if (!command.args) {
          addMessage({ from: "system", text: "Usage: /opencode <message>" });
          return;
        }
        await runTool("opencode", { message: command.args, cwd: process.cwd() });
        return;
      case "bash":
        if (!command.args) {
          addMessage({ from: "system", text: "Usage: /bash <command>" });
          return;
        }
        await runTool("bash", { command: command.args, cwd: process.cwd() });
        return;
      case "tool":
        await runGenericTool(command.args);
        return;
      case "tools":
        addMessage({
          from: "tool",
          text: monitor.tools.map((tool) => `${tool.name} - ${tool.description}`).join("\n")
        });
        return;
      case "subagents":
        addMessage({
          from: "tool",
          text: monitor.agents.length
            ? monitor.agents.map((agent) => `${agent.id}: ${agent.status} - ${agent.brief.goal}`).join("\n")
            : "No sub-agents yet."
        });
        return;
      case "status":
        addMessage({ from: "tool", text: statusLine(runtime, monitor.tasks.length, monitor.agents.length, monitor.tools.length) });
        return;
      case "kill": {
        const stopped = runtime.subAgentManager.stop("global", undefined, "TUI /kill command");
        addMessage({ from: "tool", text: `Stopped ${stopped} sub-agent(s).` });
        return;
      }
      case "help":
        addMessage({ from: "tool", text: commandItems.map((item) => item.label).join("\n") });
        return;
      case "quit":
        close();
        return;
      default:
        addMessage({ from: "system", text: `Unknown command /${command.name}. Type /help for commands.` });
    }
  };

  const askProviderWithTools = async (prompt: string) => {
    const providerMessages = providerConversation(messages, prompt, runtime.toolGateway.list().map((tool) => tool.name));

    for (let turn = 0; turn < maxModelToolTurns; turn += 1) {
      const response = await runtime.providerRegistry.generateText({
        messages: providerMessages,
        model: runtime.settings.model,
        maxTokens: 1200
      });
      const toolCall = extractModelToolCall(response.text);
      if (!toolCall) {
        addMessage({ from: "chorus", text: stripModelToolCall(response.text) || "(empty response)" });
        return;
      }

      addMessage({ from: "tool", text: `model -> ${toolCall.name} ${clip(JSON.stringify(toolCall.params), 600)}` });
      const result = await runtime.toolGateway.execute(toolCall.name, toolCall.params, toolContext());
      const formatted = formatToolResult(toolCall.name, result);
      addMessage({ from: result.status === "ok" ? "tool" : "system", text: formatted });

      providerMessages.push({ role: "assistant", content: response.text });
      providerMessages.push({
        role: "user",
        content: [
          `Tool result for ${toolCall.name}:`,
          clip(JSON.stringify(compactToolResult(result), null, 2), 7000),
          "Now continue. If another tool is needed, emit one more <chorus_tool_call> JSON block. Otherwise answer normally."
        ].join("\n")
      });
    }

    addMessage({ from: "system", text: `Stopped after ${maxModelToolTurns} model-requested tool call(s) to avoid a loop.` });
  };

  const runRead = async (paths: string[]) => {
    if (paths.length === 0) {
      addMessage({ from: "system", text: "Usage: /read <path>" });
      return;
    }
    await runTool("read", paths.length === 1 ? { path: paths[0] } : { paths });
  };

  const runTool = async (name: string, params: unknown) => {
    const result = await runtime.toolGateway.execute(name, params, toolContext());
    addMessage({ from: result.status === "ok" ? "tool" : "system", text: formatToolResult(name, result) });
  };

  const runGenericTool = async (args: string) => {
    const [name, jsonRaw] = splitFirstWord(args);
    if (!name) {
      addMessage({ from: "system", text: "Usage: /tool <name> <json-params>" });
      return;
    }
    let params: unknown = {};
    if (jsonRaw.trim()) {
      try {
        params = JSON.parse(jsonRaw);
      } catch (error) {
        addMessage({ from: "system", text: `Invalid JSON params: ${(error as Error).message}` });
        return;
      }
    }
    await runTool(name, params);
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
        <Text dimColor>model: <Text color="white">{runtime.settings.model ?? "(default)"}</Text>  provider: <Text color="cyan">{runtime.settings.provider}</Text></Text>
        <Text dimColor>directory: {truncateDisplay(process.cwd(), Math.max(12, innerWidth - 11))}</Text>
      </Box>

      <Box width={frameWidth} height={viewportHeight} flexDirection="column" overflow="hidden">
        {visibleLines.length === 0 ? <Text dimColor> </Text> : visibleLines.map((line, index) => (
          <Text key={`${firstVisibleLine}-${index}-${line.from}`} color={messageColor(line.from)} wrap="truncate-end">
            {line.text}
          </Text>
        ))}
      </Box>

      <Box width={frameWidth} minHeight={1}>
        <Text dimColor>{statusLine(runtime, monitor.tasks.length, monitor.agents.length, monitor.tools.length)} | {busy ? "busy" : "ready"} | {scrollHint(normalizedScroll, maxScroll)}</Text>
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

function providerConversation(messages: TuiMessage[], prompt: string, toolNames: string[]): ProviderMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are Chorus inside a terminal TUI. Be concise and practical.",
        "You may request local tools when needed. To call one tool, respond with exactly one JSON object inside these tags and no other prose:",
        '<chorus_tool_call>{"tool":"read","params":{"path":"/absolute/or/relative/path"}}</chorus_tool_call>',
        `Available tools: ${toolNames.join(", ")}.`,
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

function compactToolResult(result: ToolResult): ToolResult {
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
  if (paths.length === 0 || !readIntentPattern.test(text)) {
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

function parsePathList(args: string): string[] {
  const extracted = extractAbsolutePaths(args);
  if (extracted.length > 0) return extracted;
  return args.trim() ? [args.trim()] : [];
}

function formatToolResult(name: string, result: ToolResult): string {
  if (result.status !== "ok") {
    return `${result.status}: ${result.summary}${result.error ? `\n${result.error}` : ""}`;
  }
  if (name === "read") return formatReadResult(result);
  if (name === "memory") return formatMemoryResult(result);
  if (name === "bash") return formatProcessResult("bash", result);
  if (name === "opencode") return formatProcessResult("opencode", result);
  return `${result.status}: ${result.summary}${result.data ? `\n${clip(JSON.stringify(result.data, null, 2), 2000)}` : ""}`;
}

function formatReadResult(result: ToolResult): string {
  const data = result.data as { files?: Array<{ path: string; content: string }> } | undefined;
  if (!data?.files?.length) return `${result.status}: ${result.summary}`;
  return data.files
    .map((file) => `${file.path}\n${clip(file.content, 6000)}`)
    .join("\n\n");
}

function formatMemoryResult(result: ToolResult): string {
  const data = result.data as { results?: Array<{ score: number; entry: { summary: string; body?: string | null } }> } | undefined;
  if (!data?.results?.length) return `${result.status}: ${result.summary}`;
  return data.results
    .map((item) => `[${item.score.toFixed(1)}] ${item.entry.summary}${item.entry.body ? `\n${clip(item.entry.body, 500)}` : ""}`)
    .join("\n");
}

function formatProcessResult(command: string, result: ToolResult): string {
  const data = result.data as { stdout?: string; stderr?: string } | undefined;
  const output = [data?.stdout, data?.stderr].filter(Boolean).join("\n").trim();
  return output ? `${command}: ${result.summary}\n${clip(output, 3000)}` : `${command}: ${result.summary}`;
}

function flattenMessages(messages: TuiMessage[], width: number): RenderLine[] {
  const lines: RenderLine[] = [];
  for (const message of messages) {
    const prefixText = prefix(message.from);
    const wrapped = wrapDisplay(`${prefixText} ${message.text}`, width);
    for (const line of wrapped) {
      lines.push({ from: message.from, text: line });
    }
  }
  return lines;
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

function messageColor(from: TuiMessage["from"]): "yellow" | "white" | "red" | "cyan" {
  if (from === "user") return "yellow";
  if (from === "system") return "red";
  if (from === "tool") return "cyan";
  return "white";
}

function prefix(from: TuiMessage["from"]): string {
  if (from === "user") return "›";
  if (from === "tool") return "tool:";
  if (from === "system") return "!";
  return "chorus:";
}

function statusLine(runtime: ChorusRuntime, tasks: number, agents: number, tools: number): string {
  return `tasks ${tasks} | sub-agents ${agents} | tools ${tools} | ${runtime.settings.provider}`;
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
