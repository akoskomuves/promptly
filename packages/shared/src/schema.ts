/**
 * Canonical SQLite schema for ~/.promptly/promptly.db.
 *
 * Both writers (the CLI and the MCP server) MUST apply the schema through
 * this module so they can never drift apart. Add new columns by appending
 * to SESSION_COLUMN_MIGRATIONS — never by editing a package-local copy.
 */

/** Minimal surface of better-sqlite3's Database that schema setup needs. */
export interface SqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

/** Full schema for fresh databases. */
export const SESSIONS_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS sessions (
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
    conversations TEXT DEFAULT '[]',
    models TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    client_tool TEXT,
    git_activity TEXT,
    category TEXT,
    intelligence TEXT,
    external_session_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`;

/** Columns added after the initial release, for databases created before them. */
export const SESSION_COLUMN_MIGRATIONS: ReadonlyArray<{
  column: string;
  ddl: string;
}> = [
  { column: "client_tool", ddl: "ALTER TABLE sessions ADD COLUMN client_tool TEXT" },
  { column: "git_activity", ddl: "ALTER TABLE sessions ADD COLUMN git_activity TEXT" },
  { column: "category", ddl: "ALTER TABLE sessions ADD COLUMN category TEXT" },
  { column: "intelligence", ddl: "ALTER TABLE sessions ADD COLUMN intelligence TEXT" },
  { column: "external_session_id", ddl: "ALTER TABLE sessions ADD COLUMN external_session_id TEXT" },
];

/**
 * Create the sessions table if missing and add any columns an older
 * database lacks. Unlike a bare try/catch around ALTER TABLE, this only
 * swallows nothing: a real failure (corrupt db, no disk, readonly fs)
 * propagates to the caller.
 */
export function applySessionSchema(db: SqliteLike): void {
  db.exec(SESSIONS_TABLE_DDL);
  const existing = new Set(
    (db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).map(
      (c) => c.name
    )
  );
  for (const migration of SESSION_COLUMN_MIGRATIONS) {
    if (!existing.has(migration.column)) {
      db.exec(migration.ddl);
    }
  }
}
