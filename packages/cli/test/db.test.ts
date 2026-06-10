import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the CLI's data directory at a temp dir BEFORE importing db.ts,
// which resolves PROMPTLY_DIR at module load.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "promptly-db-test-"));
process.env.PROMPTLY_DIR = tmpDir;

const {
  createSession,
  finishSession,
  getSession,
  listAllSessions,
  listSessions,
  listSessionsInRange,
  countSessions,
  updateSessionTags,
} = await import("../src/db");

describe("CLI SQLite layer", () => {
  it("creates the database in PROMPTLY_DIR and inserts an active session", () => {
    createSession("sess-1", "TICKET-1");
    expect(fs.existsSync(path.join(tmpDir, "promptly.db"))).toBe(true);

    const s = getSession("sess-1");
    expect(s).toBeDefined();
    expect(s!.ticket_id).toBe("TICKET-1");
    expect(s!.status).toBe("ACTIVE");
    expect(s!.total_tokens).toBe(0);
  });

  it("finishes a session with full metrics and JSON payloads", () => {
    finishSession("sess-1", {
      conversations: [{ role: "user", content: "hi", timestamp: "2026-06-01T10:00:00.000Z" }],
      models: ["claude-sonnet-4-6"],
      totalTokens: 1500,
      promptTokens: 500,
      responseTokens: 1000,
      messageCount: 2,
      toolCallCount: 3,
      startedAt: "2026-06-01T10:00:00.000Z",
      finishedAt: "2026-06-01T10:30:00.000Z",
      gitActivity: { totalCommits: 1, totalInsertions: 10, totalDeletions: 2 },
      category: "feature",
      intelligence: { qualityScore: { overall: 4.2 } },
      clientTool: "claude-code",
    });

    const s = getSession("sess-1")!;
    expect(s.status).toBe("COMPLETED");
    expect(s.total_tokens).toBe(1500);
    expect(s.prompt_tokens + s.response_tokens).toBe(s.total_tokens);
    expect(JSON.parse(s.models)).toEqual(["claude-sonnet-4-6"]);
    expect(JSON.parse(s.conversations)).toHaveLength(1);
    expect(JSON.parse(s.git_activity!)).toMatchObject({ totalCommits: 1 });
    expect(s.category).toBe("feature");
    expect(s.client_tool).toBe("claude-code");
  });

  it("includes the external_session_id column (schema parity with MCP server)", () => {
    const s = getSession("sess-1")!;
    expect("external_session_id" in s).toBe(true);
  });

  it("lists, counts, and paginates sessions", () => {
    createSession("sess-2", "TICKET-2");
    expect(countSessions()).toBe(2);
    expect(listAllSessions()).toHaveLength(2);
    expect(listSessions(1, 0)).toHaveLength(1);
    expect(listSessions(1, 1)).toHaveLength(1);
  });

  it("filters sessions by started_at range", () => {
    const inRange = listSessionsInRange(
      "2026-06-01T00:00:00.000Z",
      "2026-06-02T00:00:00.000Z"
    );
    expect(inRange.map((s) => s.id)).toContain("sess-1");
    expect(inRange.map((s) => s.id)).not.toContain("sess-2"); // created "now"
  });

  it("updates tags and reports missing sessions", () => {
    expect(updateSessionTags("sess-1", ["backend", "auth"])).toBe(true);
    expect(JSON.parse(getSession("sess-1")!.tags)).toEqual(["backend", "auth"]);
    expect(updateSessionTags("nope", ["x"])).toBe(false);
  });
});
