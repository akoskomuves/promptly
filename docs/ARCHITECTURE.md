# Architecture

## System Overview

```
Engineer's Machine
+---------------------------------------------------+
|                                                    |
|  Claude Code --> MCP Server --> ~/.promptly/       |
|                                  +-- config.json   |
|                                  +-- session.json  |
|                                  +-- buffer.json   |
|                                  +-- promptly.db   |
|                                        |           |
|  promptly serve -----------------------+           |
|       |                                            |
|  http://localhost:3000                             |
+---------------------------------------------------+

Cloud/Self-Hosted (optional)
+---------------------------------------------------+
|  promptly finish --> API --> PostgreSQL             |
|                               |                    |
|                          Web Dashboard             |
+---------------------------------------------------+
```

## Packages

### @getpromptly/shared

Shared TypeScript types used by all packages. No runtime dependencies.

Key types: `SessionStatus`, `ConversationTurn`, `LocalSession`, `CliConfig`, `ActiveSessionState`.

### @getpromptly/mcp-server

MCP server that runs as a subprocess of Claude Code. Provides 4 tools:

| Tool | Purpose |
|------|---------|
| `promptly_start` | Initialize conversation buffer for a ticket |
| `promptly_log` | Record a conversation turn |
| `promptly_status` | Check current session stats |
| `promptly_finish` | Finalize session, write to SQLite, clear buffer |

Uses `@modelcontextprotocol/sdk` with stdio transport. Buffers data to `~/.promptly/buffer.json` for crash recovery, and writes completed sessions to `~/.promptly/promptly.db` (SQLite).

### @getpromptly/cli

CLI tool built with Commander.js. Commands:

| Command | Local Mode | Cloud Mode |
|---------|-----------|------------|
| `init` | Configures MCP in Claude Code | Same |
| `start` | Creates session in SQLite | Creates in SQLite + API |
| `finish` | Reads buffer, writes to SQLite | Writes to SQLite + uploads to API |
| `status` | Reads local session state | Same |
| `serve` | Starts HTTP server reading SQLite | Same |
| `login` | Sets cloud config | Sets cloud config |

### @getpromptly/api

Fastify REST API for cloud/team mode. Uses Prisma ORM with PostgreSQL.

Endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/sessions` | Create session |
| `GET` | `/api/sessions` | List sessions |
| `GET` | `/api/sessions/:id` | Get session detail |
| `POST` | `/api/sessions/:id/upload` | Upload conversation data |
| `PATCH` | `/api/sessions/:id` | Update tags/status |
| `GET` | `/api/teams/:slug/export/sessions` | Export sessions (CSV/JSON) |
| `GET` | `/api/teams/:slug/export/analytics` | Export analytics (CSV/JSON) |
| `GET` | `/health` | Health check |

### @getpromptly/web

Next.js 14 App Router dashboard for cloud mode. Server-side rendered, fetches from API.

Pages:

- `/` -- Landing page
- `/sessions` -- Session list
- `/sessions/:id` -- Session detail with conversation view

## Data Flow

### Local Mode

```
1. promptly start TICKET-1
   -> Insert row into SQLite (status: ACTIVE)
   -> Write session.json

2. Claude Code conversation
   -> MCP server writes to buffer.json on each turn

3. promptly finish
   -> Read buffer.json
   -> Update SQLite row (conversations, tokens, status: COMPLETED)
   -> Delete session.json and buffer.json
```

### Cloud Mode

```
1. promptly start TICKET-1
   -> POST /api/sessions (creates in PostgreSQL)
   -> Insert into SQLite
   -> Write session.json

2. Claude Code conversation
   -> MCP server writes to buffer.json

3. promptly finish
   -> Read buffer.json
   -> Update SQLite row
   -> POST /api/sessions/:id/upload (updates PostgreSQL)
   -> Delete session.json and buffer.json
```

## SQLite Schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT DEFAULT 'ACTIVE',
  total_tokens INTEGER DEFAULT 0,
  prompt_tokens INTEGER DEFAULT 0,
  response_tokens INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  conversations TEXT DEFAULT '[]',   -- JSON array
  models TEXT DEFAULT '[]',          -- JSON array
  tags TEXT DEFAULT '[]',            -- JSON array
  created_at TEXT DEFAULT (datetime('now'))
);
```

## PostgreSQL Schema

Managed by Prisma. See `packages/api/prisma/schema.prisma`.

Key differences from SQLite:
- Uses `cuid()` for IDs
- Has a `User` model with relations
- `conversations` stored as `Json` type
- `models` and `tags` as `String[]` (PostgreSQL arrays)
- Has `updatedAt` with `@updatedAt`

## Security Considerations

- Local mode: all data stays on disk. No network calls.
- Cloud mode: token-based auth. Token stored in `~/.promptly/config.json`.
- SQLite uses WAL mode for safe concurrent reads.
- No sensitive data (API keys, passwords) is captured -- only conversation text and metadata.
