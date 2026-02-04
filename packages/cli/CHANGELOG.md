# Changelog

All notable changes to `@getpromptly/cli` will be documented in this file.

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
