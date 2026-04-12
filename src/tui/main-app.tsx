import React, { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import type { ChorusRuntime } from "../runtime/create-runtime.js";

type InputMode = "none" | "ask" | "memory" | "opencode";

interface TuiMessage {
  from: "user" | "chorus" | "system";
  text: string;
}

interface MenuItem {
  label: string;
  value: string;
}

export interface MainTuiAppProps {
  runtime: ChorusRuntime;
  onExit(): void;
}

const menuItems: MenuItem[] = [
  { label: "Status", value: "status" },
  { label: "Ask model", value: "ask" },
  { label: "Search memory", value: "memory" },
  { label: "List tools", value: "tools" },
  { label: "List sub-agents", value: "subagents" },
  { label: "Run OpenCode", value: "opencode" },
  { label: "Kill all tasks", value: "kill" },
  { label: "Quit", value: "quit" }
];

export function MainTuiApp({ runtime, onExit }: MainTuiAppProps) {
  const app = useApp();
  const [messages, setMessages] = useState<TuiMessage[]>([
    { from: "chorus", text: "Chorus TUI is ready. Use arrow keys and Enter. Press q to quit." }
  ]);
  const [inputMode, setInputMode] = useState<InputMode>("none");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useInput((char) => {
    if (char === "q" && inputMode === "none") {
      onExit();
      app.exit();
    }
  });

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
    setMessages((current) => [...current.slice(-12), message]);
  };

  const choose = async (item: MenuItem) => {
    if (busy) return;
    if (item.value === "quit") {
      onExit();
      app.exit();
      return;
    }
    if (item.value === "ask" || item.value === "memory" || item.value === "opencode") {
      setInput("");
      setInputMode(item.value as InputMode);
      return;
    }
    setBusy(true);
    try {
      if (item.value === "status") {
        addMessage({
          from: "chorus",
          text: `Status: ${monitor.tasks.length} task(s), ${monitor.agents.length} sub-agent(s), provider ${runtime.settings.provider}.`
        });
      }
      if (item.value === "tools") {
        addMessage({ from: "chorus", text: `Tools: ${runtime.toolGateway.list().map((tool) => tool.name).join(", ")}` });
      }
      if (item.value === "subagents") {
        addMessage({
          from: "chorus",
          text: monitor.agents.length
            ? monitor.agents.map((agent) => `${agent.id}: ${agent.status} - ${agent.brief.goal}`).join("\n")
            : "No sub-agents yet."
        });
      }
      if (item.value === "kill") {
        const stopped = runtime.subAgentManager.stop("global", undefined, "TUI kill command");
        addMessage({ from: "system", text: `Stopped ${stopped} sub-agent(s).` });
      }
      setRefresh((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const submitInput = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setInputMode("none");
      return;
    }
    addMessage({ from: "user", text: trimmed });
    setInput("");
    setBusy(true);
    try {
      if (inputMode === "ask") {
        const response = await runtime.providerRegistry.generateText({
          messages: [{ role: "user", content: trimmed }],
          model: runtime.settings.model,
          maxTokens: 1024
        });
        addMessage({ from: "chorus", text: response.text || "(empty response)" });
      }
      if (inputMode === "memory") {
        const results = runtime.memoryStore.search({ keyword: trimmed, topK: 5 }, { actorId: "tui" });
        addMessage({
          from: "chorus",
          text: results.length
            ? results.map((result) => `[${result.score.toFixed(1)}] ${result.entry.summary}`).join("\n")
            : "No memory matches."
        });
      }
      if (inputMode === "opencode") {
        const result = await runtime.toolGateway.execute("opencode", {
          message: trimmed,
          cwd: process.cwd()
        }, { actorId: "tui", actorRole: "main", cwd: process.cwd() });
        addMessage({ from: "chorus", text: `${result.status}: ${result.summary}` });
      }
      setRefresh((value) => value + 1);
    } catch (error) {
      addMessage({ from: "system", text: `Error: ${(error as Error).message}` });
    } finally {
      setBusy(false);
      setInputMode("none");
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Text color="cyan">Chorus</Text>
        <Text>  {runtime.settings.agentName} | provider: {runtime.settings.provider} | q: quit</Text>
      </Box>

      <Box>
        <Box width={64} height={18} borderStyle="single" borderColor="green" paddingX={1} flexDirection="column" marginRight={1}>
          <Text color="green">Messages</Text>
          {messages.map((message, index) => (
            <Text key={`${index}-${message.from}`} color={message.from === "user" ? "yellow" : message.from === "system" ? "red" : "white"}>
              {message.from}: {message.text}
            </Text>
          ))}
        </Box>

        <Box width={36} height={18} borderStyle="single" borderColor="blue" paddingX={1} flexDirection="column">
          <Text color="blue">Monitor</Text>
          <Text>Tasks: {monitor.tasks.length}</Text>
          <Text>Sub-agents: {monitor.agents.length}</Text>
          <Text>Tools: {monitor.tools.length}</Text>
          <Text>OpenCode: {runtime.settings.opencode.enabled ? "enabled" : "available as tool"}</Text>
          <Text>Busy: {busy ? "yes" : "no"}</Text>
          <Box marginTop={1} flexDirection="column">
            {monitor.agents.slice(0, 5).map((agent) => (
              <Text key={agent.id}>{agent.status} {agent.brief.goal.slice(0, 24)}</Text>
            ))}
          </Box>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Box width={42} borderStyle="single" borderColor="magenta" paddingX={1} flexDirection="column" marginRight={1}>
          <Text color="magenta">Menu</Text>
          <SelectInput items={menuItems} onSelect={choose} isFocused={inputMode === "none" && !busy} />
        </Box>
        <Box width={58} borderStyle="single" borderColor="yellow" paddingX={1} flexDirection="column">
          <Text color="yellow">Input</Text>
          {inputMode === "none" ? (
            <Text dimColor>Select a command with up/down and press Enter.</Text>
          ) : (
            <Box>
              <Text>{inputLabel(inputMode)}: </Text>
              <TextInput value={input} onChange={setInput} onSubmit={submitInput} />
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function inputLabel(mode: InputMode): string {
  if (mode === "ask") return "Ask";
  if (mode === "memory") return "Memory keyword";
  if (mode === "opencode") return "OpenCode message";
  return "";
}
