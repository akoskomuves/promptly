import { describe, it, expect } from "vitest";
import {
  analyzeSession,
  computeContextMetrics,
  computePromptQuality,
} from "../src/analyze";
import type { ConversationTurn } from "../src/types";

function turn(
  role: ConversationTurn["role"],
  content: string,
  extra: Partial<ConversationTurn> = {}
): ConversationTurn {
  return { role, content, timestamp: "2026-06-01T10:00:00.000Z", ...extra };
}

describe("analyzeSession quality score", () => {
  it("handles an empty session without NaN or out-of-range values", () => {
    const result = analyzeSession({ conversations: [], messageCount: 0 });
    expect(result.qualityScore.overall).toBeGreaterThanOrEqual(1);
    expect(result.qualityScore.overall).toBeLessThanOrEqual(5);
    expect(result.qualityScore.correctionRate).toBe(0);
    expect(result.qualityScore.turnsToComplete).toBe(0);
    expect(result.toolUsage.totalToolCalls).toBe(0);
    expect(result.subagentStats.totalSpawned).toBe(0);
  });

  it("keeps overall score within [1, 5]", () => {
    const corrections = Array.from({ length: 10 }, (_, i) => [
      turn("user", i === 0 ? "fix the bug in auth.ts" : "no, that's wrong, try again"),
      turn("assistant", "I hit an error: TypeError. Build failed."),
    ]).flat();
    const result = analyzeSession({
      conversations: corrections,
      messageCount: corrections.length,
    });
    expect(result.qualityScore.overall).toBeGreaterThanOrEqual(1);
    expect(result.qualityScore.overall).toBeLessThanOrEqual(5);
    expect(result.qualityScore.correctionRate).toBeGreaterThan(0.5);
    expect(result.qualityScore.oneShotSuccess).toBe(false);
  });

  it("scores a clean one-shot session higher than a correction-heavy one", () => {
    const oneShot = analyzeSession({
      conversations: [
        turn("user", "add a --json flag to the report command in packages/cli/src/commands/report.ts"),
        turn("assistant", "Done. Tests pass."),
      ],
      messageCount: 2,
    });
    const messy = analyzeSession({
      conversations: [
        turn("user", "fix it"),
        turn("assistant", "Error: build failed"),
        turn("user", "no, that's wrong"),
        turn("assistant", "Error: test failed"),
        turn("user", "try again"),
        turn("assistant", "Error again"),
        turn("user", "start over"),
        turn("assistant", "Failure"),
      ],
      messageCount: 8,
    });
    expect(oneShot.qualityScore.overall).toBeGreaterThan(messy.qualityScore.overall);
  });

  it("detects plan mode and counts only user+assistant turns in turnsToComplete", () => {
    const result = analyzeSession({
      conversations: [
        turn("system", "system preamble"),
        turn("user", "refactor using EnterPlanMode first"),
        turn("assistant", "Entering plan mode."),
      ],
      messageCount: 3,
    });
    expect(result.qualityScore.planModeUsed).toBe(true);
    expect(result.qualityScore.turnsToComplete).toBe(2);
  });

  it("counts structured Task toolCalls as subagent spawns with types", () => {
    const result = analyzeSession({
      conversations: [
        turn("assistant", "Spawning agents.", {
          toolCalls: [
            { name: "Task", input: { subagent_type: "Explore" }, timestamp: "2026-06-01T10:00:00.000Z" },
            { name: "Task", input: { subagent_type: "Explore" }, timestamp: "2026-06-01T10:00:01.000Z" },
            { name: "Read", input: {}, timestamp: "2026-06-01T10:00:02.000Z" },
          ],
        }),
      ],
      messageCount: 1,
    });
    expect(result.subagentStats.totalSpawned).toBe(2);
    expect(result.subagentStats.subagentTypes["Explore"]).toBe(2);
    expect(result.toolUsage.toolCounts["Task"]).toBe(2);
    expect(result.toolUsage.toolCounts["Read"]).toBe(1);
  });

  it("extracts hyphenated subagent types from content mentions", () => {
    const result = analyzeSession({
      conversations: [
        turn("assistant", 'Running with subagent_type: "general-purpose" and subagent_type=Plan now.'),
      ],
      messageCount: 1,
    });
    expect(result.subagentStats.subagentTypes["general-purpose"]).toBe(1);
    expect(result.subagentStats.subagentTypes["Plan"]).toBe(1);
  });
});

describe("computeContextMetrics", () => {
  it("returns zeroed metrics for an empty conversation", () => {
    const m = computeContextMetrics([]);
    expect(m.peakTokenCount).toBe(0);
    expect(m.tokenGrowthRate).toBe(0);
    expect(m.contextUtilization).toBe(0);
    expect(m.turnsBeforeSummarization).toBeNull();
  });

  it("computes peak and utilization from token counts", () => {
    const m = computeContextMetrics([
      turn("user", "a", { tokenCount: 50000 }),
      turn("assistant", "b", { tokenCount: 50000 }),
    ]);
    expect(m.peakTokenCount).toBe(100000);
    expect(m.contextUtilization).toBe(0.5); // 100k of ~200k window
    expect(m.tokenGrowthRate).toBe(50000);
  });

  it("estimates tokens from content length when tokenCount is missing", () => {
    const m = computeContextMetrics([turn("user", "x".repeat(400))]);
    expect(m.peakTokenCount).toBe(100); // 400 chars / 4
  });

  it("caps contextUtilization at 1", () => {
    const m = computeContextMetrics([turn("user", "a", { tokenCount: 500000 })]);
    expect(m.contextUtilization).toBe(1);
  });

  it("detects compaction from harness markers in turn content", () => {
    const m = computeContextMetrics([
      turn("user", "implement the feature", { tokenCount: 100 }),
      turn("assistant", "done", { tokenCount: 100 }),
      turn(
        "user",
        "This session is being continued from a previous conversation that ran out of context.",
        { tokenCount: 100 }
      ),
      turn("assistant", "continuing", { tokenCount: 100 }),
    ]);
    expect(m.summarizationEvents).toBe(1);
    expect(m.turnsBeforeSummarization).toBe(2);
  });

  it("reports zero summarization events for a plain conversation", () => {
    const m = computeContextMetrics([
      turn("user", "hello", { tokenCount: 5000 }),
      turn("assistant", "short reply", { tokenCount: 10 }),
    ]);
    expect(m.summarizationEvents).toBe(0);
  });
});

describe("computePromptQuality", () => {
  it("returns 100 efficiency for sessions with no user turns", () => {
    const q = computePromptQuality([turn("assistant", "hello")]);
    expect(q.promptEfficiency).toBe(100);
    expect(q.insights).toEqual([]);
  });

  it("flags a vague prompt followed by heavy back-and-forth", () => {
    const conv = [
      turn("user", "fix it"),
      turn("assistant", "Which file?"),
      turn("user", "the main one"),
      turn("assistant", "Can you clarify?"),
      turn("user", "you know, the bug"),
      turn("assistant", "I need more detail."),
      turn("user", "ugh fine, auth.ts"),
    ];
    const q = computePromptQuality(conv);
    expect(q.insights.some((i) => i.type === "vague-prompt")).toBe(true);
  });

  it("keeps promptEfficiency within [0, 100]", () => {
    const conv = [
      turn("user", "no, that's wrong, try again", { tokenCount: 1000 }),
      turn("assistant", "ok", { tokenCount: 10 }),
    ];
    const q = computePromptQuality(conv);
    expect(q.promptEfficiency).toBeGreaterThanOrEqual(0);
    expect(q.promptEfficiency).toBeLessThanOrEqual(100);
  });
});
