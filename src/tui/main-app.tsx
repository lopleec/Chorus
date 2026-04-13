import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import type { ChatHistoryMessage } from "../agent/chat-gateway.js";
import type { ToolContext } from "../core/types.js";
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
const mouseReportPattern = /(?:\x1b)?\[<(\d+)[;:]\d+[;:]\d+[mM]/gu;
const spinnerFrames = ["|", "/", "-", "\\"];

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
  const [busyLabel, setBusyLabel] = useState("model thinking");
  const [spinnerIndex, setSpinnerIndex] = useState(0);
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
  const activityLabel = busyStateText(busy, spinnerIndex, busyLabel);

  useEffect(() => {
    if (!busy) {
      setSpinnerIndex(0);
      return undefined;
    }
    const timer = setInterval(() => {
      setSpinnerIndex((index) => (index + 1) % spinnerFrames.length);
    }, 120);
    return () => clearInterval(timer);
  }, [busy]);

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
    setBusyLabel(isKnownSlashCommandInput(trimmed) ? "running command" : "model thinking");
    setBusy(true);
    try {
      if (isKnownSlashCommandInput(trimmed)) {
        await runSlashCommand(trimmed);
        return;
      }

      await runChatTurn(trimmed);
    } catch (error) {
      pushMessage("system", `Error: ${(error as Error).message}`);
    } finally {
      setBusy(false);
      setBusyLabel("model thinking");
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

  const runChatTurn = async (prompt: string) => {
    let assistantId: string | undefined;
    let assistantText = "";

    for await (const event of runtime.chatGateway.runTurn({
      prompt,
      history: chatHistory(messages),
      context: toolContext(),
      workspace: process.cwd(),
      autoCommit: true
    })) {
      if (event.type === "status") {
        setBusyLabel(event.label);
      }
      if (event.type === "text_delta") {
        assistantText += event.text;
        assistantId ??= pushMessage("chorus", "");
        updateMessage(assistantId, assistantText);
      }
      if (event.type === "assistant_message") {
        if (assistantId) {
          assistantText = event.text;
          updateMessage(assistantId, assistantText);
        } else {
          assistantId = pushMessage("chorus", event.text);
        }
      }
      if (event.type === "tool_call" || event.type === "tool_result") {
        pushMessage("tool", event.summary);
      }
      if (event.type === "auto_commit" && event.result.status !== "none") {
        pushMessage("tool", event.result.summary);
      }
      if (event.type === "system") {
        pushMessage("system", event.message);
      }
      if (event.type === "error") {
        pushMessage("system", `Error: ${event.error}`);
      }
    }
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
        <Text dimColor>{statusLine(activeProvider, monitor.tasks.length, monitor.agents.length)} | {activityLabel} | {scrollHint(normalizedScroll, maxScroll)}</Text>
      </Box>

      {paletteOpen ? (
        <Box width={frameWidth} borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column" marginTop={1}>
          <Text dimColor>Commands</Text>
          <SelectInput items={visibleCommandItems} onSelect={chooseCommand} isFocused={!busy} limit={paletteLimit} />
          <Text dimColor>Esc closes. Enter selects.</Text>
        </Box>
      ) : null}

      <Box width={frameWidth} borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
        <Text color={busy ? "gray" : "white"}>{busy ? `${spinnerGlyph(spinnerIndex)} ` : "› "}</Text>
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

function chatHistory(messages: TuiMessage[]): ChatHistoryMessage[] {
  return messages
    .filter((message) => message.from === "user" || message.from === "chorus")
    .slice(-10)
    .map((message) => ({
      role: message.from === "user" ? "user" : "assistant",
      content: message.text
    }));
}

export function spinnerGlyph(index: number): string {
  return spinnerFrames[Math.abs(index) % spinnerFrames.length] ?? "|";
}

export function busyStateText(busy: boolean, spinnerIndex: number, label: string): string {
  return busy ? `${spinnerGlyph(spinnerIndex)} ${label}` : "ready";
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
      fenceLabel = inFence ? fence[1]?.trim() ?? "" : "";
      lines.push({ text: inFence ? `\`\`\`${fenceLabel}` : "```", style: "code" });
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
      lines.push({ text: `${heading[1]} ${cleanInlineMarkdown(heading[2] ?? "")}`, style: "heading" });
      continue;
    }

    const quote = /^>\s?(.*)$/u.exec(rawLine);
    if (quote) {
      lines.push({ text: `> ${cleanInlineMarkdown(quote[1] ?? "")}`, style: "quote" });
      continue;
    }

    const list = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/u.exec(rawLine);
    if (list) {
      const indent = list[1] ?? "";
      const marker = list[2] ?? "-";
      lines.push({ text: `${indent}${marker} ${cleanInlineMarkdown(list[3] ?? "")}`, style: "list" });
      continue;
    }

    if (/^\s*\|.+\|\s*$/u.test(rawLine)) {
      lines.push({ text: cleanInlineMarkdown(rawLine), style: "code" });
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
    .replace(/(^|[\s(])_([^_\n]+)_([\s).,;:!?]|$)/gu, "$1$2$3")
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
