# Promptly

Developer prompt analytics -- capture, analyze, and review AI conversations tied to development work.

## Quick Start

```bash
npm i -g @getpromptly/cli
promptly init            # Auto-detects and configures your AI coding tools
promptly start TICKET-1  # Start logging conversations
# ... work with any supported AI coding tool ...
promptly finish          # Save session data
promptly serve           # Open local dashboard at localhost:3000
```

## Features

- **Local-first**: Everything runs on your machine. No account needed.
- **Multi-tool support**: Works with Claude Code, Gemini CLI, Codex CLI, Cursor, Windsurf, and VS Code/Copilot via MCP.
- **Session tracking**: Tag conversations to tickets, track token usage and duration.
- **Built-in dashboard**: View sessions in your browser at `localhost:3000`.
- **Optional cloud sync**: For teams that want a shared dashboard.

## Deployment Tiers

| | Free (Local) | Cloud |
|---|---|---|
| **Install** | `npm i -g @getpromptly/cli` | SaaS |
| **Storage** | SQLite on disk | Our infra |
| **Dashboard** | `promptly serve` (localhost) | app.getpromptly.xyz |
| **Users** | Single user | Multi-user, teams |
| **Signup** | None | Per-seat |
| **Connectivity** | Full offline | Zero ops |

## CLI Commands

| Command | Description |
|---------|-------------|
| `promptly init` | Auto-detect and configure MCP in all supported AI coding tools |
| `promptly start <ticket-id>` | Start logging AI conversations for a ticket |
| `promptly finish` | Finish the session and save data |
| `promptly status` | Show current session status |
| `promptly serve` | Start local dashboard on localhost:3000 |
| `promptly login` | Authenticate with cloud API (cloud mode) |

## How It Works

```
Claude Code / Gemini CLI / Codex CLI
        |
        └──> MCP Server --> ~/.promptly/buffer.json --> SQLite
                                                          |
                                            promptly serve (localhost:3000)
```

1. `promptly init` auto-detects installed AI coding tools and registers the MCP server with each.
2. `promptly start TICKET-123` creates a session and signals the MCP server to begin logging.
3. As you work with your AI coding tool, the MCP server captures all conversation turns to a local buffer.
4. `promptly finish` writes the buffered data into SQLite and clears the buffer.
5. `promptly serve` starts a local HTTP server that reads from SQLite and serves a dashboard.

## Data Storage

All data is stored locally at `~/.promptly/`:

| File | Purpose |
|------|---------|
| `config.json` | CLI configuration (API URL, mode, token) |
| `session.json` | Active session state |
| `buffer.json` | MCP conversation buffer (cleared on finish) |
| `promptly.db` | SQLite database with all completed sessions |

## Cloud Mode

For teams that want a shared dashboard, sign up at [getpromptly.xyz](https://getpromptly.xyz).

```bash
promptly login             # Opens browser to sign in
promptly start TICKET-1   # Creates session locally AND on server
promptly finish            # Saves to SQLite AND uploads to API
```

See [docs/SETUP.md](docs/SETUP.md) for cloud setup details.

## Development

This is a TypeScript monorepo using Turborepo and pnpm.

```bash
pnpm install
pnpm build          # Build all packages
pnpm dev            # Dev mode (watch)
```

### Packages

| Package | Path | Description |
|---------|------|-------------|
| `@getpromptly/shared` | `packages/shared` | Shared types and utilities |
| `@getpromptly/cli` | `packages/cli` | CLI tool |
| `@getpromptly/mcp-server` | `packages/mcp-server` | MCP server for conversation capture |

## Documentation

- [Setup Guide](docs/SETUP.md) -- Installation and configuration
- [Architecture](docs/ARCHITECTURE.md) -- Technical design and data flow

## License

MIT
