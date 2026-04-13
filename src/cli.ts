#!/usr/bin/env node
import { Command } from "commander";
import React from "react";
import { render } from "ink";
import { createRuntime } from "./runtime/create-runtime.js";
import { readProviderEnv } from "./config/env.js";
import { getChorusPaths, resolveChorusHome, ensureChorusDirs } from "./config/paths.js";
import { loadSettings, saveSettings } from "./config/settings.js";
import { OnboardApp } from "./onboarding/onboard-app.js";
import { MainTuiApp } from "./tui/main-app.js";

const program = new Command();

program
  .name("chorus")
  .description("Chorus local agent core CLI")
  .version("0.1.0");

program.command("onboard").description("Run TUI onboarding and save local settings.").action(async () => {
  const paths = getChorusPaths(resolveChorusHome());
  ensureChorusDirs(paths);
  const initial = loadSettings(paths);
  await new Promise<void>((resolve) => {
    render(React.createElement(OnboardApp, {
      initial,
      onComplete: (settings) => {
        saveSettings(paths, settings);
        resolve();
      }
    }));
  });
  console.log(`Saved Chorus settings to ${paths.configPath}`);
});

program.command("tui").description("Open the bordered interactive TUI.").action(async () => {
  const runtime = createRuntime();
  await new Promise<void>((resolve) => {
    render(React.createElement(MainTuiApp, {
      runtime,
      onExit: () => {
        void runtime.close().finally(resolve);
      }
    }));
  });
});

program.command("status").description("Show runtime status.").action(async () => {
  const runtime = createRuntime();
  try {
    const tasks = runtime.scheduler.listTasks();
    const subagents = runtime.subAgentManager.list();
    console.log(JSON.stringify({
      home: runtime.paths.home,
      dbPath: runtime.paths.dbPath,
      configPath: runtime.paths.configPath,
      settings: {
        agentName: runtime.settings.agentName,
        provider: runtime.settings.provider,
        model: runtime.settings.model,
        customProviders: runtime.settings.customProviders.map((provider) => ({
          name: provider.name,
          models: provider.models,
          callFormat: provider.callFormat,
          allowInsecureTls: provider.allowInsecureTls
        })),
        opencodeEnabled: runtime.settings.opencode.enabled,
        mcpServers: runtime.settings.mcp.servers.length
      },
      tasks: tasks.length,
      subagents: subagents.length,
      tools: runtime.toolGateway.list().map((tool) => tool.name),
      providers: runtime.providerRegistry.list()
    }, null, 2));
  } finally {
    await runtime.close();
  }
});

program.command("ask")
  .description("Ask through the Chorus chat gateway, including memory and model-requested tools.")
  .argument("<prompt...>", "Prompt text")
  .option("--provider <provider>", "Provider id")
  .option("--model <model>", "Model id")
  .action(async (prompt: string[], options: { provider?: string; model?: string }) => {
    const runtime = createRuntime();
    try {
      const env = readProviderEnv();
      let wroteText = false;
      for await (const event of runtime.chatGateway.runTurn({
        prompt: prompt.join(" "),
        provider: options.provider,
        model: options.model ?? env.model,
        context: { actorId: "cli", actorRole: "main", cwd: process.cwd() },
        workspace: process.cwd(),
        autoCommit: true,
        maxTokens: 1024
      })) {
        if (event.type === "text_delta") {
          wroteText = true;
          process.stdout.write(event.text);
        }
        if (event.type === "assistant_message") {
          wroteText = true;
          process.stdout.write(event.text);
        }
        if (event.type === "tool_call" || event.type === "tool_result") {
          process.stderr.write(`${event.summary}\n`);
        }
        if (event.type === "auto_commit") {
          process.stderr.write(`${event.result.summary}\n`);
        }
        if (event.type === "system") {
          process.stderr.write(`${event.message}\n`);
        }
        if (event.type === "error") {
          process.stderr.write(`Error: ${event.error}\n`);
          process.exitCode = 1;
        }
      }
      if (wroteText) process.stdout.write("\n");
    } finally {
      await runtime.close();
    }
  });

const tools = program.command("tools").description("Inspect tools.");

tools.command("list").description("List registered tools.").action(async () => {
  const runtime = createRuntime();
  try {
    for (const tool of runtime.toolGateway.list()) {
      console.log(`${tool.name}\t${tool.description}`);
    }
  } finally {
    await runtime.close();
  }
});

program.command("tool")
  .description("Execute a tool with JSON params.")
  .argument("<name>", "Tool name")
  .argument("[params]", "JSON params", "{}")
  .action(async (name: string, paramsRaw: string) => {
    const runtime = createRuntime();
    try {
      const params = JSON.parse(paramsRaw) as unknown;
      const result = await runtime.toolGateway.execute(name, params, {
        actorId: "cli",
        actorRole: "main",
        cwd: process.cwd()
      });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await runtime.close();
    }
  });

const memory = program.command("memory").description("Manage memory.");

memory.command("add")
  .description("Add a memory entry.")
  .requiredOption("--summary <summary>", "Summary")
  .option("--body <body>", "Body")
  .option("--kind <kind>", "world_fact | belief | experience | summary", "experience")
  .option("--workspace <workspace>", "Workspace")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--weight <weight>", "Weight", Number.parseFloat)
  .action(async (options: { summary: string; body?: string; kind: "world_fact" | "belief" | "experience" | "summary"; workspace?: string; tags?: string; weight?: number }) => {
    const runtime = createRuntime();
    try {
      const entry = runtime.memoryStore.add({
        scope: options.workspace ? "workspace" : "global",
        workspace: options.workspace ?? null,
        kind: options.kind,
        summary: options.summary,
        body: options.body,
        tags: options.tags?.split(",").map((tag) => tag.trim()).filter(Boolean),
        weight: options.weight
      });
      console.log(JSON.stringify(entry, null, 2));
    } finally {
      await runtime.close();
    }
  });

memory.command("search")
  .description("Search memory entries.")
  .argument("[keyword]", "Keyword")
  .option("--workspace <workspace>", "Workspace")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--top <topK>", "Top K", (value) => Number.parseInt(value, 10), 5)
  .action(async (keyword: string | undefined, options: { workspace?: string; tags?: string; top: number }) => {
    const runtime = createRuntime();
    try {
      const results = runtime.memoryStore.search({
        keyword,
        workspace: options.workspace,
        tags: options.tags?.split(",").map((tag) => tag.trim()).filter(Boolean),
        topK: options.top
      }, { actorId: "cli" });
      console.log(JSON.stringify(results, null, 2));
    } finally {
      await runtime.close();
    }
  });

memory.command("prune").description("Prune expired low-value memory entries.").action(async () => {
  const runtime = createRuntime();
  try {
    console.log(JSON.stringify(runtime.memoryStore.prune(), null, 2));
  } finally {
    await runtime.close();
  }
});

const subagents = program.command("subagents").description("Manage sub-agents.");

subagents.command("list").description("List sub-agents.").action(async () => {
  const runtime = createRuntime();
  try {
    console.log(JSON.stringify(runtime.subAgentManager.list(), null, 2));
  } finally {
    await runtime.close();
  }
});

subagents.command("stop")
  .description("Stop a sub-agent, task, or everything.")
  .argument("[id]", "Sub-agent or task id")
  .option("--scope <scope>", "agent | task | global", "agent")
  .option("--reason <reason>", "Reason", "stopped from CLI")
  .action(async (id: string | undefined, options: { scope: "agent" | "task" | "global"; reason: string }) => {
    const runtime = createRuntime();
    try {
      console.log(JSON.stringify({
        stopped: runtime.subAgentManager.stop(options.scope, id, options.reason)
      }, null, 2));
    } finally {
      await runtime.close();
    }
  });

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
