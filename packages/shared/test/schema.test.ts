import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  applySessionSchema,
  SESSION_COLUMN_MIGRATIONS,
} from "../src/schema";

function columnNames(db: InstanceType<typeof Database>): Set<string> {
  return new Set(
    (db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).map(
      (c) => c.name
    )
  );
}

describe("applySessionSchema", () => {
  it("creates the full schema on a fresh database", () => {
    const db = new Database(":memory:");
    applySessionSchema(db);
    const cols = columnNames(db);
    for (const required of [
      "id",
      "ticket_id",
      "started_at",
      "finished_at",
      "status",
      "total_tokens",
      "prompt_tokens",
      "response_tokens",
      "message_count",
      "tool_call_count",
      "conversations",
      "models",
      "tags",
      "client_tool",
      "git_activity",
      "category",
      "intelligence",
      "external_session_id",
      "created_at",
    ]) {
      expect(cols, `missing column ${required}`).toContain(required);
    }
  });

  it("migrates a v1-era database that lacks the newer columns", () => {
    const db = new Database(":memory:");
    // The original launch schema, before any migrations existed
    db.exec(`
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
        conversations TEXT DEFAULT '[]',
        models TEXT DEFAULT '[]',
        tags TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db.prepare(
      "INSERT INTO sessions (id, ticket_id, started_at) VALUES (?, ?, ?)"
    ).run("old-1", "TICKET-1", "2026-01-01T00:00:00.000Z");

    applySessionSchema(db);

    const cols = columnNames(db);
    for (const migration of SESSION_COLUMN_MIGRATIONS) {
      expect(cols).toContain(migration.column);
    }
    // Existing rows survive the migration
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get("old-1") as {
      ticket_id: string;
      external_session_id: string | null;
    };
    expect(row.ticket_id).toBe("TICKET-1");
    expect(row.external_session_id).toBeNull();
  });

  it("is idempotent", () => {
    const db = new Database(":memory:");
    applySessionSchema(db);
    expect(() => applySessionSchema(db)).not.toThrow();
    expect(() => applySessionSchema(db)).not.toThrow();
  });

  it("propagates real failures instead of swallowing them", () => {
    const db = new Database(":memory:");
    db.close();
    expect(() => applySessionSchema(db)).toThrow();
  });
});
