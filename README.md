# Promptly

Developer prompt analytics -- capture, analyze, and review AI conversations tied to development work.

## Quick Start

```bash
npm i -g @getpromptly/cli
promptly init            # Configure AI tools + install /track skill
promptly start           # Prompts for ticket ID interactively
# ... work with any supported AI coding tool ...
promptly finish          # Save session data
promptly serve           # Open local dashboard at localhost:3000
promptly report          # View stats (select time period)
```

### Native /track Commands

After `promptly init`, use the `/track` command directly in your AI tool:

| Tool | Command |
|------|---------|
| Claude Code | `/track AUTH-123` |
| Codex CLI | `/track AUTH-123` |
| Gemini CLI | `/track AUTH-123` |
| VS Code + Copilot | `/track AUTH-123` |

All tools support: `/track <ticket-id>`, `/track status`, `/track finish`

## Features

- **Local-first**: Everything runs on your machine. No account needed.
- **Multi-tool support**: Works with Claude Code, Gemini CLI, Codex CLI, Cursor, Windsurf, and VS Code/Copilot via MCP.
- **Native `/track` command**: Built-in slash commands for Claude Code, Codex CLI, Gemini CLI, and VS Code + Copilot.
- **Auto-prompt**: AI tools offer session tracking at conversation start — no manual setup needed.
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
| `promptly init` | Configure MCP (interactive tool selector) |
| `promptly start` | Start logging (prompts for ticket ID) |
| `promptly start <ticket-id>` | Start logging for specific ticket |
| `promptly finish` | Finish session and save data |
| `promptly status` | Show current session status |
| `promptly serve` | Start local dashboard on localhost:3000 |
| `promptly report` | Show stats (interactive period selector) |
| `promptly login` | Authenticate with cloud API |
| `promptly teams` | List teams with quick actions |
| `promptly team set` | Interactive team selector |
| `promptly team set <slug>` | Set default team by slug |
| `promptly team unset` | Clear default team |
| `promptly skill install` | Install /track command for all configured tools |
| `promptly skill status` | Check skill installation status |

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
promptly teams             # List your teams
promptly team set          # Interactive team selector (or: promptly team set my-team)
promptly start TICKET-1    # Creates session in your team
promptly finish            # Saves to SQLite AND uploads to API
```

### Team Features

- **Create teams** at [app.getpromptly.xyz/teams](https://app.getpromptly.xyz/teams)
- **Invite members** via shareable link (Owner/Admin can invite)
- **Role-based access**: Owner, Admin, Member
- **Shared sessions**: All team members can view sessions created within the team
- **Team analytics**: View usage by developer, model, and tool
- **Per-tool comparison**: See which AI coding tools your team uses most (Claude Code, Cursor, Gemini CLI, etc.)
- **Data export**: Download sessions and analytics as CSV or JSON from the dashboard

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
