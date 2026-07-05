# Changelog

All notable changes to `@getpromptly/cli` will be documented in this file.

## [0.2.8] - 2026-07-04

### Added

- **`promptly review --pr <n>`** — review every recorded session behind a GitHub PR in one verdict. Matches sessions to the PR by branch + commit, then scores:
  - **Prompt quality** — LLM-as-judge (Haiku) on markdown rubrics (`intent-clarity`, `scope-discipline`), 0–10, with the weakest rubric called out.
  - **Spend efficiency** — the same leak detectors as `optimize`, scored against avoidable PR spend.
- **`--comment`** — post the verdict back to the PR as a comment. Idempotent: a hidden marker makes a re-run edit the same comment in place instead of stacking new ones.
- New review flags: `--no-quality` (spend only), `--rubric <id>`, `--model <id>`, `--json`.
- The `promptly_review` MCP tool now returns prompt quality **and** spend (previously spend-only), so reviewing a PR through your AI agent gives the full verdict.
- `promptly init` now notes that configuring Claude Code also covers the Claude Desktop "Code" panel (shared MCP config).

### Notes

- Prompt-quality scoring uses your own Anthropic key (`ANTHROPIC_API_KEY`); without one, review degrades cleanly to spend-only. `--pr` and `--comment` use the GitHub CLI (`gh`).

## [0.1.9] - 2024-02-04

### Added

- **`/track` skill for Claude Code** - Native slash command for session tracking
  - `/track <ticket-id>` — Start tracking a session
  - `/track status` — Check if tracking is active
  - `/track finish` — End and save the session
  - Installed automatically during `promptly init` for Claude Code users

- **`promptly skill` command** - Manage Claude Code skills
  - `promptly skill install` — Install the /track skill
  - `promptly skill uninstall` — Remove the /track skill
  - `promptly skill status` — Check installation status

- **Upgrade hint** - Existing users see a one-time tip about the /track skill when running `promptly start`

### For Existing Users

If you already have Promptly configured, install the new `/track` skill:

```bash
promptly skill install
```

Then restart Claude Code to activate.

## [0.1.8] - 2024-01-XX

- Initial public release
- Multi-tool support (Claude Code, Gemini CLI, Codex CLI, Cursor, Windsurf, VS Code)
- Local dashboard with session tracking
- Cloud mode with team support
