import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// promptly_review shells out to `gh` and calls the Anthropic API, so the review
// itself is stubbed — what's under test here is that both of its result shapes
// survive the SDK's outputSchema validation.
const reviewPr = vi.hoisted(() => vi.fn());
vi.mock("../src/review.js", () => ({ reviewPr }));

/**
 * Drives the tools through a real MCP client over an in-memory transport, so
 * every assertion goes through the SDK's own outputSchema validation — a
 * structuredContent payload that doesn't match its declared schema fails here
 * rather than at runtime in an editor.
 */

// Point the MCP server's data directory at a temp dir BEFORE importing
// server.ts, whose session module resolves PROMPTLY_DIR at module load.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "promptly-mcp-server-"));
process.env.PROMPTLY_DIR = tmpDir;

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { createServer } = await import("../src/server");

let client: InstanceType<typeof Client>;
let disconnect: () => Promise<void>;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  return res.structuredContent as Record<string, any>;
}

beforeEach(async () => {
  for (const f of ["session.json", "buffer.json", "promptly.db"]) {
    fs.rmSync(path.join(tmpDir, f), { force: true });
  }

  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  disconnect = async () => {
    await client.close();
    await server.close();
  };
});

afterEach(async () => {
  await disconnect();
});

describe("tool listing", () => {
  it("advertises every tool with a stable order and annotations", async () => {
    const { tools } = await client.listTools();
    // MCP 2026-07-28 asks for a deterministic tools/list order so clients can cache it.
    expect(tools.map((t) => t.name)).toEqual([
      "promptly_start",
      "promptly_log",
      "promptly_status",
      "promptly_finish",
      "promptly_review",
    ]);

    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.promptly_status.annotations?.readOnlyHint).toBe(true);
    expect(byName.promptly_review.annotations?.readOnlyHint).toBe(true);
    // Shells out to `gh` and calls the Anthropic API.
    expect(byName.promptly_review.annotations?.openWorldHint).toBe(true);
    // Clears buffer.json + session.json.
    expect(byName.promptly_finish.annotations?.destructiveHint).toBe(true);
    expect(byName.promptly_start.annotations?.readOnlyHint).toBe(false);

    for (const t of tools) expect(t.outputSchema).toBeTruthy();
  });
});

describe("MCP App", () => {
  it("points promptly_review at a UI resource the server actually serves", async () => {
    const { tools } = await client.listTools();
    const review = tools.find((t) => t.name === "promptly_review")!;
    const ui = (review._meta as any)?.ui;
    expect(ui?.resourceUri).toBe("ui://promptly/review.html");

    // The host preloads that URI off the tool metadata — a dangling reference
    // would leave it rendering nothing.
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("ui://promptly/review.html");
  });

  it("serves the panel as self-contained MCP App HTML", async () => {
    const res = await client.readResource({ uri: "ui://promptly/review.html" });
    const doc = res.contents[0];
    expect(doc.mimeType).toBe("text/html;profile=mcp-app");

    const html = doc.text as string;
    expect(html).toContain("<!doctype html>");
    // Speaks the postMessage dialect directly rather than bundling the App class.
    expect(html).toContain("ui/initialize");
    expect(html).toContain("ui/notifications/tool-result");
    expect(html).toContain("2026-01-26");
    // A sandboxed iframe under CSP can't reach the network — everything inlined.
    expect(html).not.toMatch(/<script[^>]+\ssrc=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
  });
});

describe("recording lifecycle", () => {
  it("mints a handle on start and reports it through status and finish", async () => {
    const started = await call("promptly_start", { ticketId: "ABC-1" });
    expect(started.recording).toBe(true);
    expect(started.alreadyActive).toBe(false);
    expect(started.ticketId).toBe("ABC-1");
    expect(typeof started.sessionId).toBe("string");

    const logged = await call("promptly_log", {
      role: "user",
      content: "hello",
      tokenCount: 12,
      sessionId: started.sessionId,
    });
    expect(logged).toEqual({ logged: true, reason: null });

    const status = await call("promptly_status", { sessionId: started.sessionId });
    expect(status.recording).toBe(true);
    expect(status.sessionId).toBe(started.sessionId);
    expect(status.ticketId).toBe("ABC-1");
    expect(status.messageCount).toBe(1);
    expect(status.totalTokens).toBe(12);
    expect(status.foreignProject).toBe(false);

    const finished = await call("promptly_finish", { sessionId: started.sessionId });
    expect(finished.saved).toBe(true);
    expect(finished.ticketId).toBe("ABC-1");
    expect(finished.messageCount).toBe(1);
    expect(finished.totalTokens).toBe(12);
    expect(finished.error).toBeNull();

    expect(await call("promptly_status")).toMatchObject({ recording: false, sessionId: null });
  });

  it("reports the idle state before anything starts", async () => {
    expect(await call("promptly_status")).toMatchObject({
      recording: false,
      ticketId: null,
      messageCount: 0,
      totalTokens: 0,
    });
    expect(await call("promptly_log", { role: "user", content: "x" })).toMatchObject({
      logged: false,
    });
    expect(await call("promptly_finish")).toMatchObject({ saved: false });
  });

  it("treats a second start as a no-op and returns the live handle", async () => {
    const first = await call("promptly_start", { ticketId: "ABC-1" });
    const second = await call("promptly_start", { ticketId: "ABC-2" });
    expect(second.alreadyActive).toBe(true);
    expect(second.recording).toBe(false);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.ticketId).toBe("ABC-1");
  });

  it("defaults a missing ticket id to untitled", async () => {
    expect(await call("promptly_start")).toMatchObject({ ticketId: "untitled", recording: true });
  });
});

describe("session handles", () => {
  it("rejects a log pinned to a handle that isn't the active recording", async () => {
    await call("promptly_start", { ticketId: "ABC-1" });
    const res = await call("promptly_log", {
      role: "user",
      content: "should not land",
      sessionId: "not-the-active-one",
    });
    expect(res.logged).toBe(false);
    expect(res.reason).toContain("does not match the active recording");
    expect((await call("promptly_status")).messageCount).toBe(0);
  });

  it("rejects a finish pinned to the wrong handle and keeps the recording alive", async () => {
    const started = await call("promptly_start", { ticketId: "ABC-1" });
    const res = await call("promptly_finish", { sessionId: "stale-handle" });
    expect(res.saved).toBe(false);
    expect(res.error).toContain("does not match the active recording");
    expect(await call("promptly_status")).toMatchObject({
      recording: true,
      sessionId: started.sessionId,
    });
  });

  it("allows calls that omit the handle, so the CLI-started flow still works", async () => {
    await call("promptly_start", { ticketId: "ABC-1" });
    expect(await call("promptly_log", { role: "assistant", content: "hi" })).toMatchObject({
      logged: true,
    });
  });
});

describe("promptly_review", () => {
  it("returns the verdict as structured content", async () => {
    reviewPr.mockResolvedValue({
      ok: true,
      text: "Prompt quality 8/10",
      summary: {
        prNumber: 42,
        prTitle: "Add auth",
        sessionCount: 3,
        totalTokens: 120_000,
        totalCostUsd: 1.25,
        avoidableUsd: 0.4,
        spendEfficiency: 7,
        qualityScore: 8,
        status: "success",
        recommendations: [{ id: "model-misuse", severity: "warning", title: "Downshift model" }],
        rubrics: [
          { id: "intent-clarity", title: "Intent clarity", score10: 8, worst: null },
          {
            id: "scope-discipline",
            title: "Scope discipline",
            score10: 6,
            worst: { ticketId: "AUTH-42", score: 3, note: "Bundled three unrelated asks." },
          },
        ],
        sessions: [
          { id: "s1", ticketId: "AUTH-42", model: "claude-opus-5", costUsd: 0.71 },
          { id: "s2", ticketId: "AUTH-43", model: null, costUsd: 0.34 },
        ],
        weakestRubricId: "scope-discipline",
        unpricedSessions: 0,
      },
    });

    const res = await call("promptly_review", { prNumber: 42 });
    expect(res).toMatchObject({
      reviewed: true,
      prNumber: 42,
      prTitle: "Add auth",
      qualityScore: 8,
      status: "success",
      weakestRubricId: "scope-discipline",
      error: null,
    });
    // The panel renders off these, so they have to survive the schema intact.
    expect(res.rubrics).toHaveLength(2);
    expect(res.rubrics[1].worst.ticketId).toBe("AUTH-42");
    expect(res.sessions.map((s: any) => s.ticketId)).toEqual(["AUTH-42", "AUTH-43"]);
  });

  it("carries an unpriced session through as null cost, not zero", async () => {
    reviewPr.mockResolvedValue({
      ok: true,
      text: "1 session unpriced",
      summary: {
        prNumber: 9, prTitle: null, sessionCount: 2, totalTokens: 111_000,
        totalCostUsd: 0.11, avoidableUsd: 0,
        // No spend score, because the total is only a floor.
        spendEfficiency: null, qualityScore: null, status: null,
        recommendations: [], rubrics: [], weakestRubricId: null,
        sessions: [
          { id: "s1", ticketId: "MCP-32", model: "claude-sonnet-5", costUsd: 0.11 },
          { id: "s2", ticketId: "MCP-31", model: "model-not-in-feed", costUsd: null },
        ],
        unpricedSessions: 1,
      },
    });

    const res = await call("promptly_review", { prNumber: 9 });
    expect(res.unpricedSessions).toBe(1);
    expect(res.spendEfficiency).toBeNull();
    // null must survive the schema — coercing it to 0 is the bug this guards.
    expect(res.sessions[1].costUsd).toBeNull();
  });

  it("reports a failed review without inventing numbers", async () => {
    reviewPr.mockResolvedValue({ ok: false, text: "GitHub CLI (gh) is not installed" });

    expect(await call("promptly_review", { prNumber: 7 })).toMatchObject({
      reviewed: false,
      prNumber: 7,
      sessionCount: 0,
      totalCostUsd: 0,
      spendEfficiency: null,
      qualityScore: null,
      status: null,
      recommendations: [],
      error: "GitHub CLI (gh) is not installed",
    });
  });
});
