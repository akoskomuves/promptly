import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import type {
  ConversationTurn,
  LocalSession,
  ActiveSessionState,
} from "@promptly/shared";

const PROMPTLY_DIR = path.join(os.homedir(), ".promptly");
const SESSION_STATE_FILE = path.join(PROMPTLY_DIR, "session.json");
const BUFFER_FILE = path.join(PROMPTLY_DIR, "buffer.json");

function ensureDir() {
  if (!fs.existsSync(PROMPTLY_DIR)) {
    fs.mkdirSync(PROMPTLY_DIR, { recursive: true });
  }
}

/** Check if there's an active session by reading the CLI-written state file */
export function getActiveSession(): ActiveSessionState | null {
  try {
    if (!fs.existsSync(SESSION_STATE_FILE)) return null;
    const data = fs.readFileSync(SESSION_STATE_FILE, "utf-8");
    return JSON.parse(data) as ActiveSessionState;
  } catch {
    return null;
  }
}

/** Read the buffered conversation data from disk */
export function readBuffer(): LocalSession | null {
  try {
    if (!fs.existsSync(BUFFER_FILE)) return null;
    const data = fs.readFileSync(BUFFER_FILE, "utf-8");
    return JSON.parse(data) as LocalSession;
  } catch {
    return null;
  }
}

/** Write the buffered conversation data to disk (crash recovery) */
export function writeBuffer(session: LocalSession): void {
  ensureDir();
  fs.writeFileSync(BUFFER_FILE, JSON.stringify(session, null, 2));
}

/** Initialize a new buffer when session starts */
export function initBuffer(ticketId: string): LocalSession {
  const session: LocalSession = {
    ticketId,
    startedAt: new Date().toISOString(),
    status: "ACTIVE",
    conversations: [],
    models: [],
    totalTokens: 0,
    promptTokens: 0,
    responseTokens: 0,
    messageCount: 0,
    toolCallCount: 0,
  };
  writeBuffer(session);
  return session;
}

/** Add a conversation turn to the buffer */
export function addTurn(turn: ConversationTurn): void {
  const session = readBuffer();
  if (!session) return;

  session.conversations.push(turn);
  session.messageCount++;

  if (turn.tokenCount) {
    session.totalTokens += turn.tokenCount;
    if (turn.role === "user") {
      session.promptTokens += turn.tokenCount;
    } else if (turn.role === "assistant") {
      session.responseTokens += turn.tokenCount;
    }
  }

  if (turn.model && !session.models.includes(turn.model)) {
    session.models.push(turn.model);
  }

  if (turn.toolCalls) {
    session.toolCallCount += turn.toolCalls.length;
  }

  writeBuffer(session);
}

/** Write completed session data to SQLite for local persistence */
export function writeToSqlite(session: LocalSession): void {
  try {
    ensureDir();
    const dbPath = path.join(PROMPTLY_DIR, "promptly.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
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
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);

    const activeSession = getActiveSession();
    const id = activeSession?.sessionId ??
      (Math.random().toString(36).substring(2) + Date.now().toString(36));

    // Upsert: update if exists, insert if not
    const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(id);
    if (existing) {
      db.prepare(`
        UPDATE sessions SET
          finished_at = ?, status = 'COMPLETED',
          total_tokens = ?, prompt_tokens = ?, response_tokens = ?,
          message_count = ?, tool_call_count = ?,
          conversations = ?, models = ?, started_at = ?
        WHERE id = ?
      `).run(
        session.finishedAt, session.totalTokens, session.promptTokens,
        session.responseTokens, session.messageCount, session.toolCallCount,
        JSON.stringify(session.conversations), JSON.stringify(session.models),
        session.startedAt, id
      );
    } else {
      db.prepare(`
        INSERT INTO sessions (id, ticket_id, started_at, finished_at, status,
          total_tokens, prompt_tokens, response_tokens, message_count, tool_call_count,
          conversations, models)
        VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, session.ticketId, session.startedAt, session.finishedAt,
        session.totalTokens, session.promptTokens, session.responseTokens,
        session.messageCount, session.toolCallCount,
        JSON.stringify(session.conversations), JSON.stringify(session.models)
      );
    }
    db.close();
  } catch {
    // SQLite write is best-effort; buffer.json is the crash-recovery layer
  }
}

/** Clear the buffer file after successful upload */
export function clearBuffer(): void {
  try {
    if (fs.existsSync(BUFFER_FILE)) fs.unlinkSync(BUFFER_FILE);
  } catch {
    // ignore
  }
}
