import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { LocalSession } from "@getpromptly/shared";

const PROMPTLY_DIR = path.join(os.homedir(), ".promptly");
const DB_PATH = path.join(PROMPTLY_DIR, "promptly.db");

let _db: Database.Database | null = null;

function ensureDir() {
  if (!fs.existsSync(PROMPTLY_DIR)) {
    fs.mkdirSync(PROMPTLY_DIR, { recursive: true });
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;
  ensureDir();
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
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
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  // Migrate: add client_tool column if missing
  try {
    _db.exec("ALTER TABLE sessions ADD COLUMN client_tool TEXT");
  } catch {
    // column already exists
  }
  // Migrate: add git_activity column if missing
  try {
    _db.exec("ALTER TABLE sessions ADD COLUMN git_activity TEXT");
  } catch {
    // column already exists
  }
  // Migrate: add category column if missing
  try {
    _db.exec("ALTER TABLE sessions ADD COLUMN category TEXT");
  } catch {
    // column already exists
  }
  // Migrate: add intelligence column if missing
  try {
    _db.exec("ALTER TABLE sessions ADD COLUMN intelligence TEXT");
  } catch {
    // column already exists
  }
  return _db;
}

export function createSession(id: string, ticketId: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO sessions (id, ticket_id, started_at, status) VALUES (?, ?, ?, 'ACTIVE')`
  ).run(id, ticketId, new Date().toISOString());
}

export function finishSession(
  id: string,
  data: {
    conversations: unknown[];
    models: string[];
    totalTokens: number;
    promptTokens: number;
    responseTokens: number;
    messageCount: number;
    toolCallCount: number;
    startedAt: string;
    finishedAt: string;
    gitActivity?: unknown;
    category?: string;
    intelligence?: unknown;
  }
): void {
  const db = getDb();
  db.prepare(
    `UPDATE sessions SET
      finished_at = ?,
      status = 'COMPLETED',
      total_tokens = ?,
      prompt_tokens = ?,
      response_tokens = ?,
      message_count = ?,
      tool_call_count = ?,
      conversations = ?,
      models = ?,
      started_at = ?,
      git_activity = ?,
      category = ?,
      intelligence = ?
    WHERE id = ?`
  ).run(
    data.finishedAt,
    data.totalTokens,
    data.promptTokens,
    data.responseTokens,
    data.messageCount,
    data.toolCallCount,
    JSON.stringify(data.conversations),
    JSON.stringify(data.models),
    data.startedAt,
    data.gitActivity ? JSON.stringify(data.gitActivity) : null,
    data.category ?? null,
    data.intelligence ? JSON.stringify(data.intelligence) : null,
    id
  );
}

export interface DbSession {
  id: string;
  ticket_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  total_tokens: number;
  prompt_tokens: number;
  response_tokens: number;
  message_count: number;
  tool_call_count: number;
  conversations: string;
  models: string;
  tags: string;
  client_tool: string | null;
  git_activity: string | null;
  category: string | null;
  intelligence: string | null;
  created_at: string;
}

export function listAllSessions(): DbSession[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM sessions ORDER BY started_at DESC`)
    .all() as DbSession[];
}

export function listSessions(limit = 50, offset = 0): DbSession[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as DbSession[];
}

export function getSession(id: string): DbSession | undefined {
  const db = getDb();
  return db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | DbSession
    | undefined;
}

export function countSessions(): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as count FROM sessions`).get() as {
    count: number;
  };
  return row.count;
}

export function listSessionsInRange(from: string, to: string): DbSession[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM sessions WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC`)
    .all(from, to) as DbSession[];
}

export function updateSessionTags(id: string, tags: string[]): boolean {
  const db = getDb();
  const result = db.prepare(`UPDATE sessions SET tags = ? WHERE id = ?`).run(JSON.stringify(tags), id);
  return result.changes > 0;
}

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export { generateId, DB_PATH };
