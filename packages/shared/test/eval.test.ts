import { describe, it, expect } from "vitest";
import { loadRubric, listRubrics } from "../src/eval/rubric";
import { judgePrSessions, DEFAULT_PR_RUBRICS } from "../src/eval/judge-pr";
import type { JudgeableSession } from "../src/eval/judge-pr";

describe("loadRubric", () => {
  it("parses the bundled PR rubrics from markdown frontmatter", () => {
    for (const id of DEFAULT_PR_RUBRICS) {
      const r = loadRubric(id);
      expect(r.id).toBe(id);
      expect(r.version).toBeGreaterThanOrEqual(1);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.modelDefault).toMatch(/claude/);
      expect(r.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it("throws for an unknown rubric id", () => {
    expect(() => loadRubric("does-not-exist")).toThrow();
  });

  it("lists the bundled rubrics", () => {
    const ids = listRubrics();
    for (const id of DEFAULT_PR_RUBRICS) expect(ids).toContain(id);
  });
});

describe("judgePrSessions (offline degradation)", () => {
  const session: JudgeableSession = {
    id: "s1",
    ticketId: "AUTH-42",
    turns: [{ role: "user", content: "add receipt capture" }],
    costUsd: 1,
  };

  it("degrades to spend-only when no API key is available", async () => {
    const res = await judgePrSessions([session], { apiKey: "" });
    expect(res.verdicts).toEqual([]);
    expect(res.skippedReason).toContain("ANTHROPIC_API_KEY");
  });

  it("degrades to spend-only when a rubric fails to load (no judge call made)", async () => {
    const res = await judgePrSessions([session], { apiKey: "test-key", rubricIds: ["nope"] });
    expect(res.verdicts).toEqual([]);
    expect(res.skippedReason).toContain("rubric load failed");
  });

  it("makes no judge call when no session has captured turns", async () => {
    const noTurns: JudgeableSession = { ...session, turns: [] };
    const res = await judgePrSessions([noTurns], { apiKey: "test-key" });
    expect(res.verdicts).toEqual([]);
    expect(res.skippedReason).toBeDefined();
  });
});
