import { describe, it, expect } from "vitest";
import {
  buildPrReview,
  formatPrReview,
  recAvoidableUsd,
  parsePrView,
  matchSessionsToPr,
} from "../src/pr-review";
import type { PrDetails, PrMeta } from "../src/pr-review";
import type { OptimizeSessionInput, ModelPricing } from "../src/optimize";

const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4": { input_price_per_million: 15, output_price_per_million: 75 },
  "claude-sonnet-4": { input_price_per_million: 3, output_price_per_million: 15 },
};

const PR: PrMeta = {
  number: 42,
  title: "Add receipt capture",
  headRefName: "feature/receipt-capture",
};

// An opus session that qualifies for model-misuse (premium model, high quality,
// few turns, no corrections) — 1M in / 1M out → $90 on opus vs $18 on sonnet.
function opusSession(overrides: Partial<OptimizeSessionInput> = {}): OptimizeSessionInput {
  return {
    id: "sess1234abcd",
    ticketId: "AUTH-42",
    startedAt: "2026-06-24T10:00:00.000Z",
    finishedAt: "2026-06-24T10:30:00.000Z",
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

describe("buildPrReview", () => {
  it("returns an empty verdict when no sessions match the PR", () => {
    const v = buildPrReview({ pr: PR, sessions: [], pricing: PRICING });
    expect(v.sessionCount).toBe(0);
    expect(v.totalCostUsd).toBe(0);
    expect(v.recommendations).toEqual([]);
    expect(formatPrReview(v)).toContain("No recorded Promptly sessions matched");
  });

  it("computes PR cost, avoidable spend, and a spend-efficiency score", () => {
    const v = buildPrReview({ pr: PR, sessions: [opusSession()], pricing: PRICING });
    expect(v.sessionCount).toBe(1);
    expect(v.pricingAvailable).toBe(true);
    // opus: 15 + 75 = $90 for 1M/1M
    expect(v.totalCostUsd).toBeCloseTo(90, 5);
    // avoidable = opus 90 - sonnet 18 = $72
    expect(v.avoidableUsd).toBeCloseTo(72, 5);
    // efficiency = round((1 - 72/90) * 10) = 2
    expect(v.spendEfficiency).toBe(2);
    expect(v.recommendations.some((r) => r.type === "model-misuse")).toBe(true);

    const out = formatPrReview(v);
    expect(out).toContain('PR #42 "Add receipt capture"');
    expect(out).toContain("avoidable");
    expect(out).toContain("AUTH-42");
  });

  it("aggregates avoidable dollars only from $-bearing evidence", () => {
    const v = buildPrReview({ pr: PR, sessions: [opusSession()], pricing: PRICING });
    const fromRecs = v.recommendations.reduce((n, r) => n + recAvoidableUsd(r), 0);
    expect(v.avoidableUsd).toBeCloseTo(fromRecs, 5);
  });

  it("skips spend analysis (no false 'clean') when pricing is unavailable", () => {
    const v = buildPrReview({ pr: PR, sessions: [opusSession()], pricing: null });
    expect(v.sessionCount).toBe(1);
    expect(v.pricingAvailable).toBe(false);
    expect(v.spendEfficiency).toBeNull();
    expect(v.recommendations).toEqual([]);
    expect(formatPrReview(v)).toContain("pricing unavailable");
  });

  it("scores a leak-free PR (cheaper model) as fully efficient", () => {
    const v = buildPrReview({
      pr: PR,
      sessions: [opusSession({ models: ["claude-sonnet-4"] })],
      pricing: PRICING,
    });
    expect(v.avoidableUsd).toBe(0);
    expect(v.spendEfficiency).toBe(10);
    expect(v.recommendations).toEqual([]);
    expect(formatPrReview(v)).toContain("No spend leaks detected");
  });
});

describe("parsePrView", () => {
  it("extracts PR metadata and 7-char commit SHAs from gh JSON", () => {
    const raw = JSON.stringify({
      number: 7,
      title: "Fix receipt bug",
      headRefName: "fix/receipt",
      baseRefName: "main",
      commits: [{ oid: "abcdef1234567890" }, { oid: "1234567aaaaaaaa" }],
    });
    const pr = parsePrView(raw);
    expect(pr.number).toBe(7);
    expect(pr.title).toBe("Fix receipt bug");
    expect(pr.headRefName).toBe("fix/receipt");
    expect(pr.shortShas.has("abcdef1")).toBe(true);
    expect(pr.shortShas.has("1234567")).toBe(true);
  });
});

describe("matchSessionsToPr", () => {
  const pr: PrDetails = {
    number: 7,
    title: "Fix",
    headRefName: "fix/receipt",
    shortShas: new Set(["abcdef1"]),
  };

  it("matches by branch or commit and ignores unmatched/malformed rows", () => {
    const rows = [
      { id: "byBranch", git_activity: JSON.stringify({ branch: "fix/receipt", commits: [] }) },
      { id: "byCommit", git_activity: JSON.stringify({ branch: "other", commits: [{ hash: "abcdef1zz" }] }) },
      { id: "noMatch", git_activity: JSON.stringify({ branch: "other", commits: [{ hash: "9999999" }] }) },
      { id: "noGit", git_activity: null },
      { id: "bad", git_activity: "{not json" },
    ];
    const matched = matchSessionsToPr(rows, pr).map((r) => r.id);
    expect(matched).toEqual(["byBranch", "byCommit"]);
  });
});
