# @getpromptly/cli

Developer prompt analytics CLI — capture, analyze, and review AI coding sessions tied to tickets.

## Install

```bash
npm i -g @getpromptly/cli
```

## Quick Start

```bash
promptly init            # Select which AI tools to configure
promptly start           # Prompts for ticket ID interactively
# ... work with your AI coding tool ...
promptly finish          # Save session data
promptly serve           # Open dashboard at localhost:3000
promptly report          # View stats (select time period)
```

## Commands

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

All commands support direct arguments for scripting/automation.

## How It Works

```
Claude Code / Gemini CLI / Codex CLI
        |
        └──> MCP Server → ~/.promptly/buffer.json → SQLite
                                                        ↓
                                          promptly serve (localhost:3000)
```

1. `promptly init` auto-detects installed tools and lets you select which to configure.
2. `promptly start` creates a session and begins logging.
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
