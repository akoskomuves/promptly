import { describe, it, expect } from "vitest";
import {
  getWeekBoundaries,
  getCustomBoundaries,
  computePeriodMetrics,
} from "../src/digest";
import type { DigestSessionInput } from "../src/types";

function session(overrides: Partial<DigestSessionInput> = {}): DigestSessionInput {
  return {
    ticketId: "TICKET-1",
    startedAt: "2026-06-01T10:00:00.000Z",
    finishedAt: "2026-06-01T10:30:00.000Z",
    status: "COMPLETED",
    totalTokens: 1000,
    promptTokens: 400,
    responseTokens: 600,
    messageCount: 10,
    models: ["claude-sonnet-4-6"],
    ...overrides,
  };
}

describe("getWeekBoundaries", () => {
  it("returns Monday-to-Monday boundaries with previous week adjacent", () => {
    // 2026-06-10 is a Wednesday
    const b = getWeekBoundaries(new Date(2026, 5, 10, 15, 0, 0));
    expect(b.currentStart.getDay()).toBe(1); // Monday
    expect(b.currentStart.getDate()).toBe(8); // Mon Jun 8
    expect(b.currentEnd.getTime() - b.currentStart.getTime()).toBe(7 * 86400000);
    expect(b.previousEnd.getTime()).toBe(b.currentStart.getTime());
    expect(b.previousStart.getTime()).toBe(b.currentStart.getTime() - 7 * 86400000);
  });

  it("treats Sunday as part of the week starting the previous Monday", () => {
    // 2026-06-14 is a Sunday
    const b = getWeekBoundaries(new Date(2026, 5, 14, 12, 0, 0));
    expect(b.currentStart.getDay()).toBe(1);
    expect(b.currentStart.getDate()).toBe(8);
  });
});

describe("getCustomBoundaries", () => {
  it("creates a previous period of equal length immediately before", () => {
    const from = new Date("2026-06-01T00:00:00.000Z");
    const to = new Date("2026-06-11T00:00:00.000Z");
    const b = getCustomBoundaries(from, to);
    expect(b.previousEnd.getTime()).toBe(from.getTime());
    expect(b.previousStart.getTime()).toBe(from.getTime() - 10 * 86400000);
  });
});

describe("computePeriodMetrics", () => {
  it("returns zeros for an empty period", () => {
    const m = computePeriodMetrics([]);
    expect(m.totalSessions).toBe(0);
    expect(m.totalTokens).toBe(0);
    expect(m.avgDuration).toBe(0);
    expect(m.avgQuality).toBeNull();
  });

  it("aggregates tokens, duration, quality, and git stats", () => {
    const m = computePeriodMetrics([
      session({
        intelligence: { qualityScore: { overall: 4 } },
        gitActivity: { totalCommits: 2, totalInsertions: 100, totalDeletions: 20 },
      }),
      session({
        startedAt: "2026-06-02T10:00:00.000Z",
        finishedAt: "2026-06-02T11:00:00.000Z",
        totalTokens: 3000,
        intelligence: { qualityScore: { overall: 5 } },
      }),
    ]);
    expect(m.totalSessions).toBe(2);
    expect(m.completedSessions).toBe(2);
    expect(m.totalTokens).toBe(4000);
    expect(m.avgDuration).toBe(45); // (30 + 60) / 2
    expect(m.avgQuality).toBe(4.5);
    expect(m.totalCommits).toBe(2);
    expect(m.totalInsertions).toBe(100);
  });

  it("ignores unfinished sessions in duration but counts their tokens", () => {
    const m = computePeriodMetrics([
      session(),
      session({ status: "ACTIVE", finishedAt: null }),
    ]);
    expect(m.completedSessions).toBe(1);
    expect(m.avgDuration).toBe(30);
    expect(m.totalTokens).toBe(2000);
  });
});
