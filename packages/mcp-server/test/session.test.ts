import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// Point the MCP server's data directory at a temp dir BEFORE importing
// session.ts, which resolves PROMPTLY_DIR at module load.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "promptly-mcp-test-"));
process.env.PROMPTLY_DIR = tmpDir;

const {
  initBuffer,
  addTurn,
  readBuffer,
  clearBuffer,
  writeToSqlite,
  writeActiveSession,
  clearActiveSession,
  getActiveSession,
  readSessionsForReview,
} = await import("../src/session");

const DB_PATH = path.join(tmpDir, "promptly.db");

function turn(role: "user" | "assistant" | "system", tokenCount: number) {
  return {
    role,
    content: `${role} message`,
    timestamp: "2026-06-01T10:00:00.000Z",
    tokenCount,
  };
}

beforeEach(() => {
  clearBuffer();
  clearActiveSession();
});

describe("buffer lifecycle", () => {
  it("initBuffer creates a fresh zeroed session buffer", () => {
    const s = initBuffer("TICKET-1", "claude-code", "ext-123", "/some/project");
    expect(s.totalTokens).toBe(0);
    expect(s.conversations).toEqual([]);
    expect(readBuffer()).toMatchObject({
      ticketId: "TICKET-1",
      clientTool: "claude-code",
      externalSessionId: "ext-123",
      projectDir: "/some/project",
    });
  });

  it("addTurn is a no-op when no buffer exists", () => {
    expect(() => addTurn(turn("user", 100))).not.toThrow();
    expect(readBuffer()).toBeNull();
  });

  it("accumulates turns so prompt + response always equals total", () => {
    initBuffer("TICKET-1");
    addTurn(turn("user", 100));
    addTurn(turn("system", 50));
    addTurn(turn("assistant", 200));

    const s = readBuffer()!;
    expect(s.messageCount).toBe(3);
    expect(s.totalTokens).toBe(350);
    expect(s.promptTokens).toBe(150); // user + system are input-side
    expect(s.responseTokens).toBe(200);
    expect(s.promptTokens + s.responseTokens).toBe(s.totalTokens);
  });

  it("tracks distinct models and tool call counts", () => {
    initBuffer("TICKET-1");
    addTurn({ ...turn("assistant", 10), model: "claude-sonnet-4-6" });
    addTurn({ ...turn("assistant", 10), model: "claude-sonnet-4-6" });
    addTurn({
      ...turn("assistant", 10),
      model: "claude-opus-4-8",
      toolCalls: [
        { name: "Read", input: {}, timestamp: "2026-06-01T10:00:00.000Z" },
        { name: "Edit", input: {}, timestamp: "2026-06-01T10:00:01.000Z" },
      ],
    });

    const s = readBuffer()!;
    expect(s.models).toEqual(["claude-sonnet-4-6", "claude-opus-4-8"]);
    expect(s.toolCallCount).toBe(2);
  });
});

describe("writeToSqlite", () => {
  it("inserts a completed session under the active session id", () => {
    writeActiveSession({
      sessionId: "mcp-sess-1",
      ticketId: "TICKET-1",
      startedAt: "2026-06-01T10:00:00.000Z",
      apiUrl: "http://localhost:3001",
    });
    const buffer = initBuffer("TICKET-1", "claude-code", "ext-1");
    addTurn(turn("user", 100));
    addTurn(turn("assistant", 300));
    const finished = { ...readBuffer()!, finishedAt: "2026-06-01T10:30:00.000Z", status: "COMPLETED" as const };

    const result = writeToSqlite(finished);
    expect(result.ok).toBe(true);

    const db = new Database(DB_PATH);
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get("mcp-sess-1") as Record<string, unknown>;
    db.close();
    expect(row.status).toBe("COMPLETED");
    expect(row.total_tokens).toBe(400);
    expect(row.external_session_id).toBe("ext-1");
    expect(row.client_tool).toBe("claude-code");
  });

  it("upserts: a second write for the same id updates instead of failing", () => {
    writeActiveSession({
      sessionId: "mcp-sess-1",
      ticketId: "TICKET-1",
      startedAt: "2026-06-01T10:00:00.000Z",
      apiUrl: "http://localhost:3001",
    });
    initBuffer("TICKET-1");
    addTurn(turn("user", 100));
    addTurn(turn("assistant", 300));
    addTurn(turn("assistant", 600));
    const finished = { ...readBuffer()!, finishedAt: "2026-06-01T11:00:00.000Z", status: "COMPLETED" as const };

    const result = writeToSqlite(finished);
    expect(result.ok).toBe(true);

    const db = new Database(DB_PATH);
    const rows = db.prepare("SELECT * FROM sessions WHERE id = ?").all("mcp-sess-1") as Array<Record<string, unknown>>;
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0].total_tokens).toBe(1000);
  });

  it("reports failure instead of swallowing it", () => {
    // Corrupt the database file so the write must fail
    fs.writeFileSync(DB_PATH, "this is not a sqlite file");
    // Remove WAL artifacts from earlier tests so SQLite reads the corrupt main file
    for (const suffix of ["-wal", "-shm"]) {
      try {
        fs.unlinkSync(DB_PATH + suffix);
      } catch {}
    }
    const buffer = initBuffer("TICKET-1");
    const finished = { ...buffer, finishedAt: "2026-06-01T10:30:00.000Z", status: "COMPLETED" as const };

    const result = writeToSqlite(finished);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
    // Restore a clean db for any later tests
    fs.unlinkSync(DB_PATH);
  });

  it("generates a fallback id when no active session exists", () => {
    clearActiveSession();
    expect(getActiveSession()).toBeNull();
    const buffer = initBuffer("TICKET-ORPHAN");
    const finished = { ...buffer, finishedAt: "2026-06-01T10:30:00.000Z", status: "COMPLETED" as const };

    const result = writeToSqlite(finished);
    expect(result.ok).toBe(true);

    const db = new Database(DB_PATH);
    const row = db
      .prepare("SELECT * FROM sessions WHERE ticket_id = ?")
      .get("TICKET-ORPHAN") as Record<string, unknown>;
    db.close();
    expect(row).toBeDefined();
    expect(row.status).toBe("COMPLETED");
  });
});

describe("readSessionsForReview", () => {
  it("returns only completed sessions that have git activity", () => {
    clearActiveSession();
    const a = { ...initBuffer("HASGIT"), finishedAt: "2026-06-01T10:30:00.000Z", status: "COMPLETED" as const };
    expect(writeToSqlite(a).ok).toBe(true);
    clearBuffer();
    clearActiveSession();

    const b = { ...initBuffer("NOGIT"), finishedAt: "2026-06-01T10:35:00.000Z", status: "COMPLETED" as const };
    expect(writeToSqlite(b).ok).toBe(true);
    clearBuffer();
    clearActiveSession();

    // Attach git activity to HASGIT only.
    const db = new Database(DB_PATH);
    db.prepare("UPDATE sessions SET git_activity = ? WHERE ticket_id = ?").run(
      JSON.stringify({ branch: "fix/receipt", commits: [] }),
      "HASGIT"
    );
    db.close();

    const tickets = readSessionsForReview().map((r) => r.ticket_id);
    expect(tickets).toContain("HASGIT");
    expect(tickets).not.toContain("NOGIT");
  });
});
