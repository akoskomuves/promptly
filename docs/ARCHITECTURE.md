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

Key types: `SessionStatus`, `ConversationTurn`, `LocalSession`, `CliConfig`, `ActiveSessionState`, `GitCommit`, `GitActivity`, `SessionIntelligence`, `QualityScore`, `ToolUsageStats`, `ContextWindowMetrics`, `PromptQualityAnalysis`, `PromptQualityInsight`, `ProjectCostTrend`, `ParallelSessionGroup`, `SkillUsageAnalytics`, `InstructionEffectiveness`.

Key shared modules:
- `analyze.ts` — Session intelligence computation (quality scoring, tool usage, context metrics, prompt quality, skill analytics, instruction effectiveness)
- `trends.ts` — Cost-per-project trend computation
- `parallel.ts` — Parallel/overlapping session detection
- `digest.ts` — Weekly digest computation
- `categorize.ts` — Session auto-categorization

### @getpromptly/mcp-server

MCP server that runs as a subprocess of Claude Code. Provides 5 tools:

| Tool | Purpose | Annotations |
|------|---------|-------------|
| `promptly_start` | Initialize conversation buffer for a ticket; mints the session handle | — |
| `promptly_log` | Record a conversation turn | — |
| `promptly_status` | Check current session stats | `readOnly`, `idempotent` |
| `promptly_finish` | Finalize session, write to SQLite, clear buffer | `destructive`, `idempotent` |
| `promptly_review` | Review the sessions behind a GitHub PR — prompt quality (LLM-as-judge) + spend | `readOnly`, `idempotent`, `openWorld` |

Uses `@modelcontextprotocol/sdk` with stdio transport. Buffers data to `~/.promptly/buffer.json` for crash recovery, and writes completed sessions to `~/.promptly/promptly.db` (SQLite).

#### Tool contract

Every tool declares an `outputSchema` and returns `structuredContent` alongside its
prose, so callers read numbers (token counts, cost, quality score, pass/fail) as
data instead of re-parsing text. The SDK validates each result against its schema,
including the failure paths — a review that couldn't run returns
`reviewed: false` with an `error` string rather than zeros that look like findings.

Tools are registered in a fixed order and never sorted at request time, so
`tools/list` is deterministic and clients can cache it.

#### Session handles

`promptly_start` mints a `sessionId` and returns it. `promptly_log`,
`promptly_status`, and `promptly_finish` each take an **optional** `sessionId` —
pass it to pin the call to that recording, and a call naming a recording that
isn't the live one is refused instead of silently landing in the wrong session.

This is the MCP 2026-07-28 pattern: the spec removed protocol-level sessions
(and the `Mcp-Session-Id` header) in favour of explicit, server-minted handles
passed as ordinary tool arguments. The argument stays optional so the CLI flow
(`promptly start`, which writes `session.json` without going through
`promptly_start`) keeps working unchanged, and so do recordings buffered by
earlier versions.

#### MCP App — the review panel

`promptly_review` is registered with `registerAppTool` from
`@modelcontextprotocol/ext-apps`, pointing at a `ui://promptly/review.html`
resource served at `text/html;profile=mcp-app`. Hosts that support the
`io.modelcontextprotocol/ui` extension (Claude, Claude Desktop) render the
verdict as an interactive panel — score tiles, per-rubric bars with the weakest
rubric called out, recommendations, a per-session cost table, and a re-run
button that calls `tools/call` back into `promptly_review`.

The panel lives in `src/ui/review-app.ts` as an exported string, not an `.html`
file: this package builds with plain `tsc`, which copies no assets, so a
separate file would have to be hand-copied into `dist` and would eventually go
missing from the published tarball.

It talks the MCP Apps postMessage dialect directly (`ui/initialize` →
`ui/notifications/initialized`, then `ui/notifications/tool-result`) instead of
bundling `ext-apps`' `App` class. The spec explicitly permits this, and the
pre-bundled `App` is ~330KB that the host would re-fetch on every render; the
panel is ~10KB with everything inlined, which also satisfies the sandboxed
iframe's CSP — no external scripts, styles, or fonts.

This is additive. A host without Apps support still gets the prose and
`structuredContent`, unchanged.

#### Protocol version

The server targets the revision `@modelcontextprotocol/sdk` (1.x) implements —
currently `2025-11-25`. It uses none of the features 2026-07-28 deprecates
(Roots, Sampling, Logging) or removes (`ping`, `logging/setLevel`), and stdio
transport is unaffected by that revision's transport changes.

Note that 2026-07-28 *is* implemented, in the separate
`@modelcontextprotocol/core` / `server` **2.0.0** package family — not in the 1.x
`sdk` line. We stay on 1.x because `ext-apps` peer-deps it, and moving would
strand the review panel. See ROADMAP § "MCP 2026-07-28 migration".

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

#### Local Dashboard Pages (promptly serve)

| Route | Description |
|-------|-------------|
| `/` | Sessions list with search/filter |
| `/sessions/:id` | Session detail with quality score, tool usage, context window, prompt quality |
| `/sessions/:id/replay` | Session replay with timeline, playback controls, turn-by-turn view |
| `/digest` | Weekly insights digest with trends |
| `/analytics` | Cost-per-project trends, parallel sessions, skill usage, instruction effectiveness |
| `/optimize` | Spend-leak recommendations (model misuse, context bloat, repeated corrections) with severity badges + window selector |
| `/api/optimize?days=N` | JSON endpoint backing the optimize page; same data the `promptly optimize` CLI prints |

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
   -> Capture git activity (commits since startedAt, branch, diff stats, instruction file changes)
   -> Auto-categorize session (bug-fix, feature, refactor, etc.)
   -> Compute session intelligence (quality score, tool usage, context metrics, prompt quality)
   -> Update SQLite row (conversations, tokens, git_activity, category, intelligence, status: COMPLETED)
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
   -> Capture git activity (commits since startedAt, branch, diff stats, instruction file changes)
   -> Auto-categorize session, compute session intelligence
   -> Update SQLite row (category, intelligence, git_activity)
   -> POST /api/sessions/:id/upload (updates PostgreSQL, includes gitActivity, category, intelligence)
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
  client_tool TEXT,
  git_activity TEXT,                 -- JSON: { branch, commits[], totals, instructionFileChanges? }
  category TEXT,                     -- auto-categorized: bug-fix, feature, refactor, etc.
  intelligence TEXT,                 -- JSON: SessionIntelligence (quality, tools, context, prompt quality)
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

## System Instructions Integration

The auto-prompt feature writes marked instruction blocks to each AI tool's system instructions file (e.g., `CLAUDE.md`, `GEMINI.md`, `.cursorrules`). These blocks instruct the AI to check session tracking status at conversation start and offer to begin tracking.

Blocks are wrapped in `promptly:auto-prompt:start/end` markers for idempotent install, update, and removal.

## Security Considerations

- Local mode: all data stays on disk. No network calls.
- Cloud mode: token-based auth. Token stored in `~/.promptly/config.json`.
- SQLite uses WAL mode for safe concurrent reads.
- No sensitive data (API keys, passwords) is captured -- only conversation text and metadata.
