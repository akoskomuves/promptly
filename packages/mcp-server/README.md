# @getpromptly/mcp-server

MCP server for capturing AI coding conversations. Used by [@getpromptly/cli](https://www.npmjs.com/package/@getpromptly/cli).

## Overview

This package provides an MCP (Model Context Protocol) server that integrates with any MCP-compatible AI coding tool (Claude Code, Gemini CLI, Codex CLI, Cursor, Windsurf, VS Code/Copilot) to capture conversation turns, token usage, and tool calls during development sessions.

## Installation

Installed automatically when you run `promptly init` from [@getpromptly/cli](https://www.npmjs.com/package/@getpromptly/cli). You don't need to install this separately.

```bash
npm i -g @getpromptly/cli
promptly init
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `promptly_start` | Initialize buffer for a ticket |
| `promptly_log` | Log a conversation turn (role, content, model, tokens) |
| `promptly_status` | Check active session stats |
| `promptly_finish` | Finalize session and write to SQLite |

## Links

- [Website](https://getpromptly.xyz)
- [GitHub](https://github.com/akoskomuves/promptly)
- [CLI package](https://www.npmjs.com/package/@getpromptly/cli)

## License

MIT
