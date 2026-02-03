# Setup Guide

## Prerequisites

- Node.js 20+
- Claude Code (for MCP integration)

## Local Setup (Free Tier)

### 1. Install

```bash
npm i -g @getpromptly/cli
```

### 2. Configure MCP

```bash
promptly init
```

This auto-detects your AI coding tools (Claude Code, Gemini CLI, Codex CLI, Cursor, Windsurf, VS Code) and configures the MCP server. Restart your AI tool after running this.

### 3. Start a Session

```bash
promptly start TICKET-123
```

### 4. Work with Claude Code

Use Claude Code as normal. The MCP server captures conversation turns in the background.

### 5. Finish

```bash
promptly finish
```

### 6. View Dashboard

```bash
promptly serve
# Open http://localhost:3000
```

## Cloud Setup (Teams)

For teams that want a shared dashboard, use the hosted cloud at [app.getpromptly.xyz](https://app.getpromptly.xyz).

### 1. Connect CLI

```bash
promptly login
```

This opens your browser to sign in. After authenticating, your CLI is connected to the cloud.

### 2. Use as normal

```bash
promptly start TICKET-123
# Work with your AI coding tool...
promptly finish
```

Sessions are saved locally AND synced to the cloud dashboard at [app.getpromptly.xyz](https://app.getpromptly.xyz).

## Self-Hosted Setup

For enterprise deployments, see [SELF-HOSTING.md](SELF-HOSTING.md).

## Configuration

CLI config is stored at `~/.promptly/config.json`:

```json
{
  "apiUrl": "http://localhost:3001",
  "mode": "local",
  "token": null
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `apiUrl` | API server URL | `http://localhost:3001` |
| `mode` | `"local"` or `"cloud"` | `"local"` |
| `token` | Auth token for cloud mode | `null` |
| `userEmail` | User email (cloud mode) | `null` |

## Troubleshooting

### MCP server not capturing conversations

1. Verify MCP config: check `~/.claude/claude_desktop_config.json` has a `promptly` entry.
2. Restart Claude Code after running `promptly init`.
3. Check `~/.promptly/buffer.json` exists during an active session.

### `promptly serve` shows no sessions

1. Verify `~/.promptly/promptly.db` exists.
2. Run `promptly start TEST-1 && promptly finish` to create a test session.

### Cloud upload fails

1. Check API is running: `curl http://your-api/health`.
2. Verify token in `~/.promptly/config.json`.
3. Session is still saved locally -- view with `promptly serve`.
