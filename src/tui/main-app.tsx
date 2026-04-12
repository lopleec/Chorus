import React, { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import type { ToolContext, ToolResult } from "../core/types.js";
import type { ChorusRuntime } from "../runtime/create-runtime.js";

interface TuiMessage {
  from: "user" | "chorus" | "system" | "tool";
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

export interface MainTuiAppProps {
  runtime: ChorusRuntime;
  onExit(): void;
}

const commandItems: CommandItem[] = [
  { label: "/read <path>        read a file with the read tool", value: "read" },
  { label: "/list [path]        list files", value: "list" },
  { label: "/search <text>      search files under the current folder", value: "search" },
  { label: "/memory <keyword>   search long-term memory", value: "memory" },
  { label: "/opencode <msg>     run opencode run [message]", value: "opencode" },
  { label: "/bash <command>     run a guarded shell command", value: "bash" },
  { label: "/tool <name> <json> run any registered tool", value: "tool" },
  { label: "/tools              list tools", value: "tools" },
  { label: "/subagents          list sub-agents", value: "subagents" },
  { label: "/status             show runtime status", value: "status" },
  { label: "/kill               stop all sub-agents", value: "kill" },
  { label: "/help               show commands", value: "help" },
  { label: "/ask <message>      force provider chat", value: "ask" },
  { label: "/quit               quit", value: "quit" }
];

const commandsNeedingInput = new Set<SlashCommandName>(["ask", "read", "list", "search", "memory", "opencode", "bash", "tool"]);

const absolutePathPattern = /(?:\/[^\s"'`<>|，。！？、,;:!?）)\]]+)+/gu;
const readIntentPattern = /(内容|有什么|看看|看一下|读取|读一下|查看|打开|里面|文件|what.*(content|contain|say)|read|show|open|cat|look)/iu;

export function MainTuiApp({ runtime, onExit }: MainTuiAppProps) {
  const app = useApp();
  const [messages, setMessages] = useState<TuiMessage[]>([
    {
      from: "chorus",
      text: "Chorus is ready. Type normally to chat, paste a file path to read it, or type / to open commands."
    }
  ]);
  const [input, setInput] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

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

  const addMessage = (message: TuiMessage) => {
    setMessages((current) => [...current.slice(-16), message]);
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

      await askProvider(trimmed);
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
        await askProvider(command.args);
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
        addMessage({
          from: "tool",
          text: `provider=${runtime.settings.provider} model=${runtime.settings.model ?? "(default)"} tasks=${monitor.tasks.length} subagents=${monitor.agents.length} tools=${monitor.tools.length}`
        });
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

  const askProvider = async (prompt: string) => {
    const response = await runtime.providerRegistry.generateText({
      messages: [
        {
          role: "system",
          content: "You are Chorus inside a terminal TUI. Be concise. The TUI will run local tools for slash commands and obvious file-read requests."
        },
        ...messages
          .filter((message) => message.from === "user" || message.from === "chorus")
          .slice(-10)
          .map((message) => ({
            role: message.from === "user" ? "user" as const : "assistant" as const,
            content: message.text
          })),
        { role: "user" as const, content: prompt }
      ],
      model: runtime.settings.model,
      maxTokens: 1024
    });
    addMessage({ from: "chorus", text: response.text || "(empty response)" });
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
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text color="cyan" bold>Chorus</Text>
        <Text>  provider: {runtime.settings.provider}  model: {runtime.settings.model ?? "(default)"}  / commands  Ctrl+C quit</Text>
      </Box>

      <Box borderStyle="single" borderColor="green" height={20} paddingX={1} flexDirection="column">
        <Text color="green">Conversation</Text>
        {messages.map((message, index) => (
          <Text key={`${index}-${message.from}`} color={messageColor(message.from)}>
            {prefix(message.from)} {clip(message.text, 1200)}
          </Text>
        ))}
      </Box>

      <Box marginTop={1} minHeight={1}>
        <Text dimColor>
          tasks {monitor.tasks.length} | sub-agents {monitor.agents.length} | tools {monitor.tools.length} | {busy ? "busy" : "ready"}
        </Text>
      </Box>

      {paletteOpen ? (
        <Box borderStyle="single" borderColor="magenta" paddingX={1} flexDirection="column" marginTop={1}>
          <Text color="magenta">Command palette</Text>
          <SelectInput items={commandItems} onSelect={chooseCommand} isFocused={!busy} />
          <Text dimColor>Esc closes. Enter selects. Up/down moves.</Text>
        </Box>
      ) : null}

      <Box borderStyle="single" borderColor="yellow" paddingX={1} marginTop={1}>
        <Text color={busy ? "gray" : "yellow"}>{busy ? "..." : "> "}</Text>
        <TextInput value={input} onChange={updateInput} onSubmit={submitInput} focus={!busy && !paletteOpen} />
      </Box>
    </Box>
  );
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
    .map((file) => `${file.path}\n${clip(file.content, 3000)}`)
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

function messageColor(from: TuiMessage["from"]): "yellow" | "white" | "red" | "cyan" {
  if (from === "user") return "yellow";
  if (from === "system") return "red";
  if (from === "tool") return "cyan";
  return "white";
}

function prefix(from: TuiMessage["from"]): string {
  if (from === "user") return "user:";
  if (from === "tool") return "tool:";
  if (from === "system") return "system:";
  return "chorus:";
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
