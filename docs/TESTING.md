# Testing Guide

Manual testing checklist for Promptly features.

## Multi-Tool /track Commands

### Claude Code

**Prerequisites:**
- Claude Code installed and configured
- `promptly init` run with Claude Code selected

**Test cases:**

1. **Skill installation**
   ```bash
   promptly skill status          # Should show Claude Code skill status
   promptly skill install         # Should install .claude/skills/track/SKILL.md
   ```

2. **Session tracking via /track**
   - Open Claude Code in a project
   - Type `/track TEST-123` - should start a session
   - Type `/track status` - should show active session
   - Type `/track finish` - should end session
   - Run `promptly serve` - should see session in dashboard

3. **Global vs project install**
   - Test with `--global` flag: `promptly skill install --global`
   - Verify `~/.claude/skills/track/SKILL.md` exists

### Codex CLI

**Prerequisites:**
- Codex CLI installed (`codex` command available)
- `promptly init` run with Codex selected

**Test cases:**

1. **MCP configuration**
   - Verify `~/.codex/config.toml` has `[mcp.promptly]` section
   - Restart Codex CLI after init

2. **Skill installation**
   ```bash
   promptly skill install         # Should create .codex/skills/track/SKILL.md
   promptly skill status          # Should show Codex skill installed
   ```

3. **Session tracking**
   - Open Codex CLI
   - Type `/track TEST-456` - should call promptly_start MCP tool
   - Type `/track status` - should show active session
   - Type `/track finish` - should end and save session

### Gemini CLI

**Prerequisites:**
- Gemini CLI installed (`gemini` command available)
- `promptly init` run with Gemini selected

**Test cases:**

1. **MCP configuration**
   - Verify `~/.gemini/settings.json` has MCP server entry
   - Restart Gemini CLI after init

2. **Command installation**
   ```bash
   promptly skill install         # Should create .gemini/commands/track.toml
   promptly skill status          # Should show Gemini command installed
   ```

3. **Session tracking**
   - Open Gemini CLI
   - Type `/track TEST-789` - should start tracking
   - Type `/track status` - check status
   - Type `/track finish` - end session

### VS Code + Copilot

**Prerequisites:**
- VS Code with GitHub Copilot extension
- MCP support enabled in Copilot settings
- `promptly init` run with VS Code selected

**Test cases:**

1. **MCP configuration**
   - Verify `~/.vscode/mcp.json` has promptly server entry

2. **Prompt installation**
   ```bash
   promptly skill install         # Should create .github/prompts/track.prompt.md
   promptly skill status          # Should show VS Code prompt installed
   ```

3. **Session tracking**
   - Open VS Code with Copilot Chat
   - Use `/track AUTH-001` prompt
   - Verify MCP tools are called

### Cursor (Limited Support)

**Limitation:** Cursor commands (`.cursor/commands/`) cannot directly invoke MCP tools. The AI must be instructed to use the MCP tools manually.

**Workaround:**

1. Configure MCP via `promptly init` (creates `~/.cursor/mcp.json`)
2. Manually instruct Cursor AI to use session tracking:
   ```
   Use the promptly MCP tools to track this session:
   - Call mcp__promptly__promptly_start with ticketId "TICKET-123"
   - When done, call mcp__promptly__promptly_finish
   ```

**Test cases:**

1. **MCP configuration**
   - Run `promptly init` and select Cursor
   - Verify `~/.cursor/mcp.json` has promptly server entry
   - Restart Cursor

2. **Manual MCP usage**
   - Ask Cursor AI to list available MCP tools
   - Verify promptly tools appear (promptly_start, promptly_log, promptly_status, promptly_finish)
   - Instruct AI to call promptly_start with a ticket ID
   - Verify session starts

### Windsurf (Limited Support)

**Limitation:** Windsurf workflows (`.windsurf/workflows/`) have indirect MCP access through Cascade. The AI needs guidance to use MCP tools.

**Workaround:**

1. Configure MCP via `promptly init` (creates `~/.codeium/windsurf/mcp_config.json`)
2. Guide Cascade to use session tracking:
   ```
   I want to track this coding session. Please use the promptly MCP server:
   1. Call promptly_start with ticketId "TICKET-123" to begin
   2. Call promptly_finish when we're done
   ```

**Test cases:**

1. **MCP configuration**
   - Run `promptly init` and select Windsurf
   - Verify `~/.codeium/windsurf/mcp_config.json` has promptly server entry
   - Restart Windsurf

2. **Guided MCP usage**
   - Ask Cascade about available MCP tools
   - Verify promptly tools are accessible
   - Guide Cascade to start a session
   - Verify session appears in `promptly status`

## CLI Commands

### promptly init

**Test cases:**

1. **Fresh install**
   ```bash
   rm -rf ~/.promptly
   promptly init
   ```
   - Should detect available tools
   - Should prompt for tool selection
   - Should offer skill installation for each tool

2. **Re-run with existing config**
   ```bash
   promptly init
   ```
   - Should show already configured tools
   - Should still offer skill installation

### promptly skill

**Test cases:**

1. **Status command**
   ```bash
   promptly skill status
   ```
   - Should show installation status for all configured tools

2. **Install command**
   ```bash
   promptly skill install
   ```
   - Should install skills for all configured tools
   - Should skip already installed skills

3. **Uninstall command**
   ```bash
   promptly skill uninstall
   ```
   - Should remove skill files
   - Should confirm before removal

### promptly start/finish

**Test cases:**

1. **Interactive start**
   ```bash
   promptly start
   ```
   - Should prompt for ticket ID

2. **Direct start**
   ```bash
   promptly start TICKET-123
   ```
   - Should start session immediately

3. **Skill hint**
   - Configure a tool but don't install skill
   - Run `promptly start TICKET-1`
   - Should show one-time hint about `promptly skill install`

## Cloud Features

### Team Analytics

**Prerequisites:**
- Logged in to cloud (`promptly login`)
- Member of a team with sessions

**Test cases:**

1. **Analytics endpoint**
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     https://api.getpromptly.xyz/api/teams/my-team/analytics
   ```
   - Should return summary, byUser, byModel, byDay

2. **Period filter**
   - Test `?period=7d`, `?period=30d`, `?period=all`
   - Verify data changes appropriately

3. **Web dashboard**
   - Visit `app.getpromptly.xyz/teams/my-team`
   - Verify analytics section displays
   - Test period selector (7d/30d/All)

## Edge Cases

### No tools installed
```bash
# Simulate no tools
promptly init
```
- Should show "No supported tools detected"

### MCP server not running
- Start a session
- Use AI tool without MCP configured
- Verify graceful handling

### Concurrent sessions
- Try to start a session while one is active
- Should show error message

## Smoke Test Checklist

Quick verification after deployment:

- [ ] `npm i -g @getpromptly/cli` installs successfully
- [ ] `promptly init` detects tools correctly
- [ ] `promptly skill install` creates skill files
- [ ] `promptly start TEST-1` creates session
- [ ] `promptly finish` saves session
- [ ] `promptly serve` shows dashboard with session
- [ ] `promptly login` opens browser auth flow
- [ ] Cloud dashboard loads at app.getpromptly.xyz
