# Setup Guide

## Prerequisites

- Node.js 20+
- Claude Code (for MCP integration)

## Local Setup (Free Tier)

### 1. Install

```bash
npm i -g @promptly/cli
```

### 2. Configure MCP

```bash
promptly init
```

This detects your Claude Code config and adds the Promptly MCP server entry. Restart Claude Code after running this.

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

### 1. Deploy the API

```bash
cd packages/api
cp .env.example .env
# Set DATABASE_URL to your PostgreSQL instance
pnpm prisma migrate deploy
pnpm start
```

### 2. Deploy the Web Dashboard

```bash
cd packages/web
# Set NEXT_PUBLIC_API_URL to your API URL
pnpm build && pnpm start
```

### 3. Connect CLI

```bash
promptly login --api-url https://your-api.example.com
```

This sets mode to `cloud`. Sessions will be saved locally AND uploaded to the API.

### 4. Verify

```bash
promptly start TEST-1
promptly finish
# Check both localhost:3000 and your web dashboard
```

## Self-Hosted Setup

See [SELF-HOSTING.md](SELF-HOSTING.md) for Docker Compose deployment.

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
