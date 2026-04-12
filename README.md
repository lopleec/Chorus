# Chorus

Chorus is a local-first macOS agent core. This first implementation slice focuses on the runtime kernel: provider routing, tool gateway, task/sub-agent scheduling, persistence, memory retrieval, and a lightweight CLI.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm dev status
pnpm dev onboard
```

Runtime state defaults to `~/.chorus`. Tests use temporary `CHORUS_HOME` directories.
