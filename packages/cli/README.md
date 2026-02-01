# @getpromptly/cli

Developer prompt analytics CLI — capture, analyze, and review AI coding sessions tied to tickets.

## Install

```bash
npm i -g @getpromptly/cli
```

## Quick Start

```bash
promptly init            # Auto-detect & configure all supported AI coding tools
promptly start TICKET-1  # Start logging conversations
# ... work with your AI coding tool ...
promptly finish          # Save session data
promptly serve           # Open dashboard at localhost:3000
```

## Commands

| Command | Description |
|---------|-------------|
| `promptly init` | Auto-detect & configure all supported AI coding tools |
| `promptly start <ticket-id>` | Start logging AI conversations for a ticket |
| `promptly finish` | Finish the session and save data |
| `promptly status` | Show current session status |
| `promptly serve` | Start local dashboard on localhost:3000 |
| `promptly login` | Authenticate with cloud API |

## How It Works

```
Claude Code / Gemini CLI / Codex CLI
        |
        └──> MCP Server → ~/.promptly/buffer.json → SQLite
                                                        ↓
                                          promptly serve (localhost:3000)
```

1. `promptly init` auto-detects installed tools and registers the MCP server.
2. `promptly start TICKET-123` creates a session and begins logging.
3. The MCP server captures all conversation turns, tokens, and tool calls.
4. `promptly finish` writes data to SQLite and clears the buffer.
5. `promptly serve` serves a dashboard reading from SQLite.

## Data Storage

All data stays on your machine at `~/.promptly/`:

| File | Purpose |
|------|---------|
| `config.json` | CLI configuration |
| `session.json` | Active session state |
| `buffer.json` | Conversation buffer (cleared on finish) |
| `promptly.db` | SQLite database with all sessions |

## Links

- [Website](https://getpromptly.xyz)
- [GitHub](https://github.com/akoskomuves/promptly)
- [Documentation](https://github.com/akoskomuves/promptly/blob/main/docs/SETUP.md)

## License

MIT
