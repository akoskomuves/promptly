# Setup Guide

## Prerequisites

- Node.js 20+
- One of the supported AI coding tools:
  - Claude Code
  - Gemini CLI
  - Codex CLI
  - Cursor
  - Windsurf
  - VS Code (with Copilot or similar)

## Local Setup (Free Tier)

### 1. Install

```bash
npm i -g @getpromptly/cli
```

### 2. Configure MCP

```bash
promptly init
```

This auto-detects your AI coding tools (Claude Code, Gemini CLI, Codex CLI, Cursor, Windsurf, VS Code) and configures the MCP server.

**For supported tools**: You'll be prompted to install the `/track` command, which adds native slash commands for session tracking (Claude Code, Codex CLI, Gemini CLI, VS Code + Copilot).

Restart your AI tool after running this.

### 3. Start a Session

```bash
promptly start TICKET-123
```

### 4. Work with Your AI Tool

Use your AI coding tool as normal. The MCP server captures conversation turns in the background.

### 5. Finish

```bash
promptly finish
```

This captures git activity (commits, branch, diff stats) from the session window, saves everything to SQLite, and clears the buffer. If you're in a git repo, the session detail will show which commits were made during the session.

### 6. View Dashboard

```bash
promptly serve
# Open http://localhost:3000
```

## Native /track Commands

`promptly init` offers to install native `/track` commands for supported AI tools. This provides slash commands for session tracking directly in your AI tool.

### Supported Tools

| Tool | Command Location |
|------|------------------|
| Claude Code | `.claude/skills/track/SKILL.md` |
| Codex CLI | `.codex/skills/track/SKILL.md` |
| Gemini CLI | `.gemini/commands/track.toml` |
| VS Code + Copilot | `.github/prompts/track.prompt.md` |

### Commands

| Command | Description |
|---------|-------------|
| `/track <ticket-id>` | Start tracking (e.g., `/track AUTH-123`) |
| `/track status` | Check if tracking is active |
| `/track finish` | End session and save to dashboard |

### Installation Location (Claude Code)

During `promptly init`, you can choose:

- **Project** (default): `.claude/skills/track/SKILL.md` — Only available in this project
- **Global**: `~/.claude/skills/track/SKILL.md` — Available in all projects

### Installing/Reinstalling

For existing users or to reinstall:

```bash
promptly skill install    # Install for all configured tools
promptly skill status     # Check installation status
```

Or run `promptly init` again — even if tools are already configured, it will offer to install `/track` commands.

## Auto-Prompt

After installing skills, `promptly init` offers to enable **auto-prompt**. This adds a small instruction block to each tool's system instructions file so the AI automatically offers session tracking at the start of each conversation.

### How It Works

- **Full MCP tools** (Claude Code, Codex CLI, Gemini CLI, VS Code + Copilot): The AI calls `promptly_status` to check if tracking is active, then offers to start if not.
- **Limited MCP tools** (Cursor, Windsurf): The AI suggests running `promptly start <ticket-id>` manually.

### Instruction Files

| Tool | Project file | Global file |
|------|-------------|-------------|
| Claude Code | `CLAUDE.md` or `.claude/CLAUDE.md` | `~/.claude/CLAUDE.md` |
| Codex CLI | `.codex/instructions.md` | `~/.codex/instructions.md` |
| Gemini CLI | `GEMINI.md` | `~/.gemini/GEMINI.md` |
| VS Code + Copilot | `.github/copilot-instructions.md` | N/A |
| Cursor | `.cursorrules` | N/A |
| Windsurf | `.windsurfrules` | N/A |

### Checking Status

```bash
promptly skill status    # Shows auto-prompt status per tool
```

The instruction blocks are marked with `promptly:auto-prompt:start/end` markers, so re-running `promptly init` detects existing blocks and skips them.

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

### 3. Create or Join a Team

Create a team at [app.getpromptly.xyz/teams](https://app.getpromptly.xyz/teams), then set it as your default:

```bash
promptly teams              # List your teams
promptly team set           # Interactive team selector
promptly team set my-team   # Or set by slug directly
```

New sessions will be shared with all team members.

```bash
promptly team unset         # Clear default (personal sessions)
```

### 4. Team Analytics

The team dashboard at [app.getpromptly.xyz/teams/your-team](https://app.getpromptly.xyz/teams) shows:

- **Overview stats**: Total sessions, tokens, messages, and average duration
- **By Developer**: Which team members are using AI tools most
- **By Model**: Which AI models are being used (Claude Opus, GPT-4o, Gemini, etc.)
- **By Tool**: Which AI coding tools your team prefers (Claude Code, Cursor, Gemini CLI, etc.)
- **Usage trends**: Daily activity over time

Click on a developer to see their individual analytics, including their preferred models and tools.

### 5. Data Export

The team dashboard includes an **Export** button (next to the period selector) to download your data:

- **Sessions (CSV)**: Flat file with one row per session — ticket, user, tokens, cost, models, tags, duration
- **Sessions (JSON)**: Same data in structured JSON with metadata
- **Analytics (CSV)**: Multi-section report with summary, by user, by model, by tool, and daily trend
- **Analytics (JSON)**: Full analytics breakdown matching the dashboard

Exports respect the currently selected time period (7d, 30d, all). Admins can export all team data; members can export their own sessions.

## Self-Hosted Setup

For enterprise deployments, see [SELF-HOSTING.md](SELF-HOSTING.md).

## Configuration

CLI config is stored at `~/.promptly/config.json`:

```json
{
  "apiUrl": "https://api.getpromptly.xyz",
  "mode": "cloud",
  "token": "your-api-key",
  "userEmail": "you@example.com",
  "defaultTeamSlug": "my-team"
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `apiUrl` | API server URL | `https://api.getpromptly.xyz` |
| `mode` | `"local"` or `"cloud"` | `"local"` |
| `token` | Auth token for cloud mode | `null` |
| `userEmail` | User email (cloud mode) | `null` |
| `defaultTeamSlug` | Default team for new sessions | `null` |

## Troubleshooting

### MCP server not capturing conversations

1. Verify MCP config was added by running `promptly init` again (it will show which tools were configured).
2. Restart your AI coding tool after running `promptly init`.
3. Check `~/.promptly/buffer.json` exists during an active session.

**Config locations by tool:**
- Claude Code: `~/.claude/claude_desktop_config.json`
- Gemini CLI: `~/.gemini/settings.json`
- Codex CLI: `~/.codex/config.json`
- Cursor: `~/.cursor/mcp.json`
- Windsurf: `~/.codeium/windsurf/mcp_config.json`
- VS Code: `~/.vscode/mcp.json`

### `promptly serve` shows no sessions

1. Verify `~/.promptly/promptly.db` exists.
2. Run `promptly start TEST-1 && promptly finish` to create a test session.

### Cloud upload fails

1. Check API is running: `curl http://your-api/health`.
2. Verify token in `~/.promptly/config.json`.
3. Session is still saved locally -- view with `promptly serve`.

### `/track` command not found

1. Run `promptly skill install` to install for all configured tools.
2. Restart your AI tool after installing.
3. Run `promptly skill status` to verify installation.
4. Check if files exist:
   - Claude Code: `.claude/skills/track/SKILL.md` or `~/.claude/skills/track/SKILL.md`
   - Codex CLI: `.codex/skills/track/SKILL.md`
   - Gemini CLI: `.gemini/commands/track.toml`
   - VS Code + Copilot: `.github/prompts/track.prompt.md`
