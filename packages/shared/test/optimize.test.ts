import { describe, it, expect } from "vitest";
import { runOptimizationDetectors, detectModelMisuse } from "../src/optimize";
import type { OptimizeSessionInput, ModelPricing } from "../src/optimize";

const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4": { input_price_per_million: 15, output_price_per_million: 75 },
  "claude-sonnet-4": { input_price_per_million: 3, output_price_per_million: 15 },
};

function session(overrides: Partial<OptimizeSessionInput> = {}): OptimizeSessionInput {
  return {
    id: "s1",
    ticketId: "TICKET-1",
    startedAt: "2026-06-01T10:00:00.000Z",
    finishedAt: "2026-06-01T10:30:00.000Z",
    totalTokens: 2_000_000,
    promptTokens: 1_000_000,
    responseTokens: 1_000_000,
    models: ["claude-opus-4"],
    intelligence: {
      qualityScore: { overall: 4.5, turnsToComplete: 4, correctionRate: 0 },
    },
    ...overrides,
  };
}

describe("runOptimizationDetectors", () => {
  it("returns an empty list for no sessions", () => {
    const recs = runOptimizationDetectors({ sessions: [], pricing: PRICING, windowDays: 30 });
    expect(recs).toEqual([]);
  });

  it("works without pricing data (cost detectors disabled, no crash)", () => {
    const recs = runOptimizationDetectors({
      sessions: [session()],
      pricing: null,
      windowDays: 30,
    });
    expect(Array.isArray(recs)).toBe(true);
    expect(recs.every((r) => r.type !== "model-misuse")).toBe(true);
  });

  it("sorts recommendations by estimated monthly savings", () => {
    const recs = runOptimizationDetectors({
      sessions: [session()],
      pricing: PRICING,
      windowDays: 30,
    });
    const savings = recs.map((r) => r.estimatedMonthlySavings);
    expect(savings).toEqual([...savings].sort((a, b) => b - a));
  });
});

describe("detectModelMisuse", () => {
  it("flags a premium model on a short, high-quality session", () => {
    const recs = detectModelMisuse({
      sessions: [session()],
      pricing: PRICING,
      windowDays: 30,
    });
    expect(recs).toHaveLength(1);
    expect(recs[0].type).toBe("model-misuse");
    // opus: 1M*$15 + 1M*$75 = $90; sonnet: $3 + $15 = $18 → $72 saved over 30d
    expect(recs[0].estimatedMonthlySavings).toBeCloseTo(72, 0);
    expect(recs[0].evidence).toHaveLength(1);
  });

  it("does not flag long or low-quality sessions", () => {
    const longSession = session({
      intelligence: { qualityScore: { overall: 4.5, turnsToComplete: 20, correctionRate: 0 } },
    });
    const lowQuality = session({
      intelligence: { qualityScore: { overall: 2, turnsToComplete: 3, correctionRate: 0 } },
    });
    const corrected = session({
      intelligence: { qualityScore: { overall: 4.5, turnsToComplete: 3, correctionRate: 0.5 } },
    });
    for (const s of [longSession, lowQuality, corrected]) {
      expect(detectModelMisuse({ sessions: [s], pricing: PRICING, windowDays: 30 })).toEqual([]);
    }
  });

  it("does not flag non-premium models", () => {
    const recs = detectModelMisuse({
      sessions: [session({ models: ["claude-sonnet-4"] })],
      pricing: PRICING,
      windowDays: 30,
    });
    expect(recs).toEqual([]);
  });
});
