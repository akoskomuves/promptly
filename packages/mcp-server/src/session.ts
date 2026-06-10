import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { applySessionSchema } from "@getpromptly/shared";
import type {
  ConversationTurn,
  LocalSession,
  ActiveSessionState,
} from "@getpromptly/shared";

const PROMPTLY_DIR =
  process.env.PROMPTLY_DIR ?? path.join(os.homedir(), ".promptly");
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

/** Write session state file (used by MCP server when starting sessions directly) */
export function writeActiveSession(state: ActiveSessionState): void {
  ensureDir();
  fs.writeFileSync(SESSION_STATE_FILE, JSON.stringify(state, null, 2));
}

/** Clear session state file */
export function clearActiveSession(): void {
  try {
    if (fs.existsSync(SESSION_STATE_FILE)) fs.unlinkSync(SESSION_STATE_FILE);
  } catch {
    // ignore
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
export function initBuffer(ticketId: string, clientTool?: string, externalSessionId?: string): LocalSession {
  const session: LocalSession = {
    ticketId,
    startedAt: new Date().toISOString(),
    status: "ACTIVE",
    conversations: [],
    models: [],
    clientTool,
    externalSessionId,
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
    if (turn.role === "assistant") {
      session.responseTokens += turn.tokenCount;
    } else {
      // user and system turns are both input-side tokens, so the
      // prompt/response split always sums to totalTokens
      session.promptTokens += turn.tokenCount;
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

export type SqliteWriteResult = { ok: true } | { ok: false; error: string };

/** Write completed session data to SQLite for local persistence */
export function writeToSqlite(session: LocalSession): SqliteWriteResult {
  let db: InstanceType<typeof Database> | null = null;
  try {
    ensureDir();
    const dbPath = path.join(PROMPTLY_DIR, "promptly.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    applySessionSchema(db);

    const activeSession = getActiveSession();
    const id = activeSession?.sessionId ??
      (Math.random().toString(36).substring(2) + Date.now().toString(36));

    // Atomic upsert — a SELECT-then-INSERT would race against the CLI
    // writing the same session id from another process
    db.prepare(`
      INSERT INTO sessions (id, ticket_id, started_at, finished_at, status,
        total_tokens, prompt_tokens, response_tokens, message_count, tool_call_count,
        conversations, models, client_tool, external_session_id)
      VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        finished_at = excluded.finished_at,
        status = 'COMPLETED',
        total_tokens = excluded.total_tokens,
        prompt_tokens = excluded.prompt_tokens,
        response_tokens = excluded.response_tokens,
        message_count = excluded.message_count,
        tool_call_count = excluded.tool_call_count,
        conversations = excluded.conversations,
        models = excluded.models,
        client_tool = COALESCE(excluded.client_tool, client_tool),
        started_at = excluded.started_at,
        external_session_id = COALESCE(excluded.external_session_id, external_session_id)
    `).run(
      id, session.ticketId, session.startedAt, session.finishedAt,
      session.totalTokens, session.promptTokens, session.responseTokens,
      session.messageCount, session.toolCallCount,
      JSON.stringify(session.conversations), JSON.stringify(session.models),
      session.clientTool ?? null, session.externalSessionId ?? null
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      db?.close();
    } catch {
      // already closed or never opened
    }
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
