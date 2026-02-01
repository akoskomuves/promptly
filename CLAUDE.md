# Promptly

Local-first developer prompt analytics -- capture, analyze, and review AI conversations tied to development work.

## Project Structure

TypeScript monorepo using Turborepo:

- `packages/shared` - Shared types and utilities
- `packages/cli` - CLI tool (`promptly` command) with embedded SQLite and local dashboard
- `packages/mcp-server` - MCP server for intercepting AI conversations
- `cloud/` - **Private repo** (gitignored) containing cloud/team packages (api, web)

## Architecture

### Local-First (default)

```
Claude Code --> MCP Server --> ~/.promptly/buffer.json --> SQLite (promptly.db)
                                                              |
                                               promptly serve (localhost:3000)
```

### Cloud Mode (optional, for teams)

```
Same as above, PLUS:
promptly finish --> API (remote) --> PostgreSQL --> Web Dashboard
```

### Two Modes

- **Local mode** (default): All data in `~/.promptly/promptly.db`. No server needed.
- **Cloud mode**: Data stored locally AND synced to remote API. Set via `promptly login`.

## Development

```bash
pnpm install
pnpm dev                          # Run all packages in dev mode
pnpm --filter @promptly/cli dev   # Run specific package
pnpm build                        # Build all
pnpm test                         # Run tests
```

### Cloud development

The cloud packages (api, web) live in `cloud/`, which is a separate private repo gitignored from this one. See `cloud/CLAUDE.md` for cloud-specific instructions.

## Key Technologies

- **Runtime**: Node.js 20+
- **Package Manager**: pnpm with workspaces
- **Build**: Turborepo
- **Language**: TypeScript (strict mode)
- **Local Storage**: SQLite via better-sqlite3
- **MCP**: @modelcontextprotocol/sdk

## Database

### Local (SQLite)

Stored at `~/.promptly/promptly.db`. Schema created automatically on first use.

## CLI Commands

| Command | Description |
|---------|-------------|
| `promptly init` | Configure MCP server in Claude Code |
| `promptly start <ticket-id>` | Start logging conversations |
| `promptly finish` | Save session and stop logging |
| `promptly status` | Show active session info |
| `promptly serve [-p PORT]` | Local dashboard at localhost:3000 |
| `promptly login [--api-url URL]` | Set up cloud mode |

## Environment Variables

### CLI (`~/.promptly/config.json`)
- `apiUrl` - API server URL (default: `http://localhost:3001`)
- `mode` - `"local"` or `"cloud"` (default: `"local"`)
- `token` - Auth token for cloud mode

## Code Style

- Use TypeScript strict mode
- Prefer async/await over callbacks
- Use Zod or TypeBox for runtime validation
- Keep functions small and focused

## Common Tasks

### Adding a new CLI command
1. Create command in `packages/cli/src/commands/`
2. Register in `packages/cli/src/index.ts`

## Documentation

- [README.md](README.md) - Product overview and quick start
- [docs/SETUP.md](docs/SETUP.md) - Setup guide for all tiers
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - Technical architecture
- [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) - Self-hosted deployment
