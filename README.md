# Chorus

Chorus is a local-first macOS agent core with a CLI, TUI onboarding, provider routing, tool gateway, sub-agent scheduler, persistent memory, operation logs, and a first pass at the built-in tool set.

This repository currently implements the kernel, command-line workflow, onboarding TUI, and a lightweight chat TUI with slash commands.

## Requirements

- macOS
- Node.js 20 or newer
- pnpm
- Optional: OpenCode, if you want to use the `opencode` tool
- Optional: provider API keys for OpenAI, Anthropic, or Gemini

## Install

```bash
pnpm install
pnpm build
```

Use the development command while working in the repo:

```bash
pnpm dev status
pnpm dev tui
```

Or link the built CLI globally:

```bash
pnpm build
pnpm link --global
chorus status
```

## First Run

Run the TUI onboarding flow:

```bash
pnpm dev onboard
```

Open the main bordered TUI:

```bash
pnpm dev tui
```

Type in the bottom chat box and press Enter to talk. Type `/` to open the command palette, use the up/down arrow keys, then press Enter.

Useful TUI commands:

```text
/read <path>        read a file with the read tool
/list [path]        list files
/search <text>      search files under the current folder
/memory <keyword>   search long-term memory
/opencode <msg>     run opencode run [message]
/bash <command>     run a guarded shell command
/tool <name> <json> run any registered tool
/tools              list tools
/subagents          list sub-agents
/status             show runtime status
/kill               stop all sub-agents
/help               show commands
/ask <message>      force provider chat
/quit               quit
```

You can also paste a local absolute path into normal chat and ask about its content. For example:

```text
/Users/luccazh/Documents/Programing☕️/Chorus/Plan_总结.md 这个文件有什么内容
```

Chorus detects that as a file-read request and calls the `read` tool instead of letting the model only talk about reading it.

It saves settings to:

```text
~/.chorus/config.json
```

The onboarding flow configures:

- agent name
- UI language
- tone/personality
- provider and default model
- custom provider name, URL, API key, model IDs, and call format
- provider API key
- optional OpenAI base URL
- OpenCode enable/disable
- addon review strictness
- addon cooldown duration

You can also configure providers with environment variables. Environment variables override saved settings when the runtime starts:

```bash
export CHORUS_PROVIDER=openai
export CHORUS_MODEL=gpt-4o-mini
export OPENAI_API_KEY=...
export OPENAI_BASE_URL=...

export CHORUS_PROVIDER=anthropic
export CHORUS_MODEL=claude-3-5-haiku-latest
export ANTHROPIC_API_KEY=...

export CHORUS_PROVIDER=gemini
export CHORUS_MODEL=gemini-2.0-flash-001
export GEMINI_API_KEY=...
```

Custom providers are configured in onboarding or directly in `~/.chorus/config.json`.
Each custom provider supports:

- `name`: the provider name used by `CHORUS_PROVIDER` or `--provider`
- `baseUrl`: the API endpoint base URL
- `apiKey`: optional API key
- `models`: one or more model IDs
- `callFormat`: `openai_chat`, `anthropic_messages`, or `gemini_generate_content`
- `allowInsecureTls`: optional, only for trusted custom gateways with broken certificate chains

Example:

```json
{
  "provider": "local-openai",
  "model": "qwen2.5-coder:32b",
  "customProviders": [
    {
      "name": "local-openai",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "not-needed",
      "models": ["qwen2.5-coder:32b", "llama3.1:8b"],
      "callFormat": "openai_chat",
      "allowInsecureTls": false
    }
  ]
}
```

Then call it with:

```bash
pnpm dev ask --provider local-openai --model qwen2.5-coder:32b "hello"
```

If a trusted custom HTTPS gateway fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, either fix the server certificate chain or set `"allowInsecureTls": true` for that one custom provider. Keep it `false` for normal public API endpoints.

For local testing without network calls:

```bash
export CHORUS_PROVIDER=mock
pnpm dev ask ping
```

## Data Directory

Runtime state defaults to:

```text
~/.chorus
```

Important files:

- `~/.chorus/config.json` for user settings
- `~/.chorus/chorus.sqlite` for structured state and memory
- `~/.chorus/logs/operations.jsonl` for tool execution logs
- `~/.chorus/tasks/<task-id>.jsonl` for task timelines
- `~/.chorus/workspaces/<workspace>/summary.md` for human-readable notes

Use `CHORUS_HOME` to run Chorus against a different data directory:

```bash
CHORUS_HOME=/tmp/chorus-dev pnpm dev status
```

## Common Commands

Show runtime status:

```bash
pnpm dev status
```

Ask the configured provider:

```bash
pnpm dev ask "Say hello from Chorus"
```

List tools:

```bash
pnpm dev tools list
```

Run a tool with JSON parameters:

```bash
pnpm dev tool bash '{"command":"pwd"}'
pnpm dev tool read '{"path":"README.md"}'
pnpm dev tool search '{"path":".","query":"OpenCode"}'
```

Dangerous shell commands are blocked by the gateway:

```bash
pnpm dev tool bash '{"command":"rm -rf ./danger"}'
pnpm dev tool bash '{"command":"sudo whoami"}'
```

OpenCode must go through the dedicated tool. Chorus calls it as `opencode run [message]`:

```bash
pnpm dev tool opencode '{"message":"Explain this repository","cwd":"."}'
```

HTTP and web tools:

```bash
pnpm dev tool http '{"method":"GET","url":"https://example.com"}'
pnpm dev tool web '{"action":"read","url":"https://example.com"}'
pnpm dev tool web '{"action":"search","query":"Chorus local agent"}'
```

Git helper:

```bash
pnpm dev tool git '{"action":"status"}'
pnpm dev tool git '{"action":"diff"}'
```

Memory:

```bash
pnpm dev memory add --kind world_fact --summary "Chorus stores structured memory in SQLite" --tags chorus,memory
pnpm dev memory search "SQLite memory"
pnpm dev memory prune
```

Sub-agents:

```bash
pnpm dev tool open_subagent '{"goal":"Inspect README","workspace":"chorus","success_criteria":["Report findings"],"file_scope":["README.md"]}'
pnpm dev subagents list
pnpm dev subagents stop <sub-agent-id> --scope agent --reason "manual stop"
```

Addon review:

```bash
pnpm dev tool install_addon '{"source":"./some-addon","addonType":"plugin"}'
```

Only a `security_review` actor can call `allow` or `decline` successfully through the tool gateway.

## Built-In Tools

Current tools:

- `bash`
- `read`
- `write`
- `edit`
- `list`
- `search`
- `del`
- `memory`
- `http`
- `web`
- `git`
- `screen`
- `ui`
- `opencode`
- `mcp`
- `open_subagent`
- `contact`
- `stop`
- `list_subagents`
- `install_addon`
- `allow`
- `decline`

## Verify

Run the full local check:

```bash
pnpm check
```

Expected result:

```text
7 test files passed
19 tests passed
```

Node may print an experimental warning for `node:sqlite` on Node 23. The warning is expected and does not indicate a failing check.
