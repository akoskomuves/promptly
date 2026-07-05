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

This captures git activity (commits, branch, diff stats, instruction file changes) from the session window, auto-categorizes the session (bug-fix, feature, refactor, investigation, testing, docs, or other), computes session intelligence (quality score, tool usage, subagent tracking, context window metrics, prompt quality analysis), saves everything to SQLite, and clears the buffer. If you're in a git repo, the session detail will show which commits were made during the session.

Categories are determined automatically using:
1. Ticket ID prefix (e.g., `fix/login-bug` → bug-fix, `feat/new-dashboard` → feature)
2. Git commit messages (conventional commits like `fix:`, `feat:`, `refactor:`)
3. First user message keywords as a fallback

### Session Intelligence

At finish time, the CLI analyzes conversation content to compute:

- **Quality Score (1-5 stars)**: Based on plan mode usage, one-shot success, correction rate, and error recovery
- **Tool Usage**: Which tools were used (Bash, Read, Edit, Grep, etc.) and how often, plus skill invocations
- **Subagent Tracking**: How many Task agent spawns occurred and their types (Explore, Plan, etc.)
- **Context Window Metrics**: Peak token count, summarization/compaction events, token growth rate, and context utilization ratio
- **Prompt Quality Analysis**: Efficiency score (0-100), average prompt length, back-and-forth score, and actionable insights (vague prompts, excessive back-and-forth, missing context, scope creep, long prompts)

Intelligence data appears in the session summary output, the local dashboard, analytics page, reports, and CSV exports.

### 6. Weekly Digest

```bash
promptly digest
```

Shows a week-over-week comparison of your sessions: total sessions, tokens, messages, quality trends, top projects, and auto-generated highlights. Also available in the local dashboard at `/digest`.

Options:
- `--from YYYY-MM-DD` — Custom period start date
- `--to YYYY-MM-DD` — Custom period end date

### 7. View Dashboard

```bash
promptly serve
# Open http://localhost:3000
```

The dashboard includes:
- **Sessions**: List and detail views with quality scores, tool usage, context window metrics, and prompt quality insights
- **Analytics**: Cost-per-project trends, parallel session detection, skill usage analytics, instruction file effectiveness, and aggregate prompt quality
- **Digest**: Weekly insights with week-over-week trends
- **Session Replay**: Step through conversation turns with timing, playback controls (play/pause, speed, keyboard shortcuts), and cumulative stats

### Cost Estimates

Promptly fetches model pricing from the live `vizra.ai` pricing API (covers 290+ models). Sessions whose model has no pricing entry display `—` instead of a misleading `$0.00` — hover the cell or check the session detail page to see which model is missing pricing data.

## Optimization — Find AI Spend Leaks

Once you have a few weeks of session data, `promptly optimize` analyzes patterns and surfaces dollar-quantified recommendations. Available as a CLI command, a dashboard page (`/optimize`), and a JSON API (`/api/optimize?days=N`).

```bash
promptly optimize                       # Last 90 days (default)
promptly optimize --days 30             # Last 30 days
promptly optimize --from 2026-04-01     # Custom range
promptly optimize --json                # Machine-readable output
promptly optimize --apply <rec-id>      # Apply a recommendation (id shown in the listing)
```

### One-Click Apply

Each appliable recommendation prints its id and an `Apply:` line. `promptly optimize --apply <rec-id>` previews the exact files it will create, asks for confirmation (`--yes` to skip — works from scripts and AI agents), then writes:

| Recommendation type | What gets generated |
|---|---|
| Repeated workflow | A Claude Code skill (`.claude/skills/<name>/SKILL.md`) that runs the detected step sequence |
| Repeated correction | A marker-wrapped standing rule appended to your project `CLAUDE.md` |
| Pre/post action | A guarded hook script (`.claude/hooks/`) + the matching `PreToolUse`/`PostToolUse` entry in project `.claude/settings.json` |
| Model misuse / context bloat | Advice only — these are usage habits, not config |

Every generated artifact carries the recommendation id as a marker, so re-applying is detected and skipped instead of duplicated. Generated files are plain config in your project — edit or delete them like anything else.

The dashboard view at `http://localhost:3000/optimize` shows the same recommendations visually, with severity-colored cards, a window selector (7/30/90/180/365 days), and evidence rows that link back to the session detail page that triggered each rec.

Current detectors:
- **Model misuse** — sessions where a premium model (Opus, GPT-5.5 Pro, Gemini Ultra) handled tasks completed in ≤5 turns with quality ≥4/5 and low correction rate. A cheaper-tier model in the same family would likely have produced the same outcome.
- **Context bloat** — sessions where peak context utilization hit 80%+, at least one summarization/compaction event triggered, and the total token volume was material (≥100K). Splitting these into smaller scopes saves the context-restoration overhead. The waste estimate is intentionally conservative (only the overage above 80% counts, halved as a calibration).
- **Repeated corrections** — phrases the user repeats across 5+ distinct sessions ("don't use any types", "always run the linter") signal an instruction-file gap. Adding the rule to CLAUDE.md / .cursorrules / GEMINI.md prevents the friction. Direct $ savings are small (a few cents/mo); the real win is fewer re-do cycles and less compounding context bloat.
- **Repetitive workflow** — multi-step Bash sequences (`npm test → npm run lint → git commit`) that repeat across 5+ sessions. Recommends automating as a Claude Code skill / Cursor command / Codex skill / Gemini command. Savings are time-based — about 30s per occurrence of typing + AI deliberation, monetized at $1/min as a transparent placeholder so it sorts alongside the dollar detectors.
- **Pre/post action automation** — Bash command **bigrams** with high conditional probability. If `git commit` is preceded by `eslint` ≥80% of the time, that's a pre-hook candidate. If `Edit` is followed by `npm test` ≥80% of the time, that's a post-hook candidate. Distinct from repetitive workflow: that one says "automate as a skill"; this one says "automate as a hook" (Claude Code hooks, git pre-commit hooks, shell aliases). Time savings at ~10s per prevented manual invocation.

Each recommendation shows the top 3-5 evidence rows. Aggregate monthly savings is extrapolated from the analysis window — model misuse uses real prices, context bloat uses a conservative formula, repeated corrections estimate ~1500 wasted tokens per occurrence at the user's median model price, repetitive workflow uses time × placeholder rate.

> **Privacy note:** Repeated-corrections evidence shows verbatim user messages. The CLI and local dashboard are single-user and read from your local SQLite — nothing is uploaded. Cloud team aggregation of correction patterns is deliberately not yet implemented.

## Prompt Review

Where `optimize` looks at your whole history, `promptly review` looks at the prompts behind a specific unit of work and scores them. It uses an LLM-as-judge, so it needs your own Anthropic key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Without a key, review still runs — it just falls back to the spend-only analysis and skips the quality score (it never errors out).

### Review one session

```bash
promptly review <session-id>            # id or unique prefix; --rubric <id>, --model <id>, --json
```

Prints the judge's score (0–10), rationale, and eval cost for that session against a rubric (default `intent-clarity`).

### Review a whole GitHub PR

```bash
promptly review --pr 42                  # quality + spend verdict for the PR
promptly review --pr 42 --comment        # ...and post it back to the PR
```

`--pr` resolves the PR with the GitHub CLI (`gh` — install from [cli.github.com](https://cli.github.com) and run `gh auth login`), matches your recorded sessions to it **by branch and commit**, then prints one verdict combining:

- **Prompt quality** — each matched session judged on markdown rubrics (`intent-clarity`, `scope-discipline`), scored 0–10, with the weakest rubric called out.
- **Spend efficiency** — the same leak detectors as `optimize` (model misuse, context bloat, …), scored against how much of the PR's spend was avoidable.

Flags:

| Flag | Effect |
|---|---|
| `--comment` | Post the verdict as a PR comment. **Idempotent** — a hidden marker lets a re-run edit the same comment in place instead of stacking new ones. Needs `gh` auth with repo write. |
| `--no-quality` | Skip the LLM judge — spend analysis only. |
| `--rubric <id>` | Score against a single rubric instead of the default set. |
| `--model <id>` | Override the judge model (default: the rubric's `model_default`, Haiku). |
| `--json` | Machine-readable verdict. |

Cost is bounded: only sessions with captured turns are judged, capped at the 8 most expensive per PR, on Haiku by default. If no sessions match the PR, nothing is posted.

### Through your AI agent (MCP)

The same PR review is available as the `promptly_review` MCP tool. Tell your agent you're reviewing a PR — "I'm reviewing PR 42", "let's review #42" — and it calls `promptly_review` and relays the quality + spend verdict. It's **read-only**: it analyzes the sessions that produced the PR and never starts a recording.

## Importing Past Claude Code Sessions

If you used Claude Code before installing Promptly (or want to skip MCP setup entirely), you can import existing sessions directly from `~/.claude/projects`:

```bash
promptly import-claude              # Interactive picker over the 20 most recent sessions
promptly import-claude --list       # List recent sessions and exit
promptly import-claude --session <prefix> --ticket AUTH-123   # Non-interactive
```

Imported sessions parse the JSONL conversation log, capture models, token usage, and tool calls, run the same auto-categorization and intelligence analysis as live sessions, and tag the AI tool field as `claude-code` so they show up alongside live Claude Code sessions in the dashboard's filters and analytics. Git activity isn't captured (the import is post-hoc), so commits/diff stats are omitted on those sessions.

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

### Non-Interactive Setup (scripts, CI, AI agents)

Interactive prompts need a real terminal — they can't run from `!` commands inside Claude Code, CI jobs, or scripts. Every command degrades gracefully without a TTY: confirms take their defaults, selectors use their default or fail with the exact flag to pass instead. For fully unattended setup:

```bash
promptly init --tools claude --yes        # configure MCP + /track skill + auto-prompt, no prompts
promptly init --tools claude,codex --yes  # multiple tools
promptly skill install --yes              # skills only
```

This means an AI agent can set Promptly up by itself: if the `/track` skill is installed but the MCP tools are missing, the skill instructs the agent to run `promptly init --tools claude --yes` and ask you to restart the session.

## Auto-Prompt

After installing skills, `promptly init` offers to enable **auto-prompt**. This adds a small instruction block to each tool's system instructions file so the AI automatically offers session tracking at the start of each conversation.

### How It Works

- **Full MCP tools** (Claude Code, Codex CLI, Gemini CLI, VS Code + Copilot):
  - Say you're starting a ticket in plain language — "I'm starting ABC-111", "let's work on AUTH-42" — and the AI calls `promptly_start` with that ticket ID automatically, confirming with `🔴 Promptly recording — ABC-111`.
  - At conversation start, the AI calls `promptly_status`; if a session is already active it mentions it once, otherwise it offers to start one.
  - Say the work is done — "wrap up the ticket", "we're done here" — and the AI calls `promptly_finish` and reports the session summary.
- **Limited MCP tools** (Cursor, Windsurf): The AI suggests running `promptly start <ticket-id>` manually.

> Installed the auto-prompt block before? Re-run `promptly init` (or `promptly skill install`) to update it to the latest version — natural-language ticket start/finish was added in CLI 0.2.1.

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

## Recording Indicator (Status Line)

To always see whether a session is being recorded, wire Promptly into Claude Code's status line:

```bash
promptly statusline install     # writes statusLine to ~/.claude/settings.json
```

While a session is active, the bottom of Claude Code shows:

```
🔴 REC ABC-111 · 12 msgs · 34.3k tok · 1h 23m
```

When nothing is being recorded, the line is empty. The indicator is **project-scoped**: recordings are stamped with the project directory they were started in, and other Claude Code windows won't show them (the MCP server in another project also refuses to log turns into a recording that isn't its own). `promptly statusline` prints the same line for any other tool that can run a shell command for its status area (tmux status bars, shell prompts, etc.) — without Claude Code's workspace context it shows the machine-wide recording. Remove it with `promptly statusline uninstall`. If you already have a custom status line, the installer won't overwrite it — it prints instructions for chaining instead.

## Telemetry

Two layers, both anonymous, both opt-out:

1. **Install ping** — `promptly init` sends a single one-time event (CLI version, OS, node version — never prompt content, code, or file paths) so we know an install happened. It prints a notice when it fires.
2. **Usage telemetry** — only in cloud mode after `promptly login`: event names + version + OS. Local-mode users never send usage data; the analytics client doesn't even initialize.

Disable everything with any of: `promptly telemetry off`, `PROMPTLY_NO_TELEMETRY=1`, or the standard `DO_NOT_TRACK=1`. Check the current state with `promptly telemetry status`.

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
