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
