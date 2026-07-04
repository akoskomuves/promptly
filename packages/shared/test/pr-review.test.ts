import { describe, it, expect } from "vitest";
import {
  buildPrReview,
  formatPrReview,
  formatPrReviewMarkdown,
  PROMPTLY_REVIEW_MARKER,
  recAvoidableUsd,
  parsePrView,
  matchSessionsToPr,
  summarizeQuality,
} from "../src/pr-review";
import type { PrDetails, PrMeta, SessionRubricVerdict } from "../src/pr-review";
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

describe("summarizeQuality", () => {
  const verdicts: SessionRubricVerdict[] = [
    { sessionId: "s1", ticketId: "AUTH-42", rubricId: "intent-clarity", rubricTitle: "Intent Clarity", score: 4, rationale: "Clear ask.", costUsd: 0.001 },
    { sessionId: "s1", ticketId: "AUTH-42", rubricId: "scope-discipline", rubricTitle: "Scope Discipline", score: 2, rationale: "AUTH-42 spent 4 turns re-scoping the table. More detail here.", costUsd: 0.001 },
    { sessionId: "s2", ticketId: "AUTH-9", rubricId: "intent-clarity", rubricTitle: "Intent Clarity", score: 5, rationale: "Excellent.", costUsd: 0.002 },
    { sessionId: "s2", ticketId: "AUTH-9", rubricId: "scope-discipline", rubricTitle: "Scope Discipline", score: 3, rationale: "One change.", costUsd: 0.002 },
  ];

  it("returns null when there are no verdicts", () => {
    expect(summarizeQuality([], { sessionsTotal: 3, judgeModel: "claude-haiku-4-5" })).toBeNull();
  });

  it("aggregates per-rubric and overall scores, cost, and sessions judged", () => {
    const q = summarizeQuality(verdicts, { sessionsTotal: 2, judgeModel: "claude-haiku-4-5" });
    expect(q).not.toBeNull();
    if (!q) return;
    // overall avg = (4+2+5+3)/4 = 3.5 → 7/10
    expect(q.overall10).toBe(7);
    const intent = q.rubrics.find((r) => r.rubricId === "intent-clarity");
    const scope = q.rubrics.find((r) => r.rubricId === "scope-discipline");
    expect(intent?.score10).toBe(9); // avg 4.5 → 9
    expect(scope?.score10).toBe(5); // avg 2.5 → 5
    expect(q.evalCostUsd).toBeCloseTo(0.006, 6);
    expect(q.sessionsJudged).toBe(2);
    expect(q.sessionsTotal).toBe(2);
  });

  it("identifies the worst rubric and its worst session with a one-line note", () => {
    const q = summarizeQuality(verdicts, { sessionsTotal: 2, judgeModel: "claude-haiku-4-5" });
    expect(q?.worst?.rubricId).toBe("scope-discipline");
    expect(q?.worst?.score10).toBe(5);
    expect(q?.worst?.worst?.ticketId).toBe("AUTH-42");
    expect(q?.worst?.worst?.note).toBe("AUTH-42 spent 4 turns re-scoping the table.");
  });

  it("renders the quality bar, worst-rubric callout, and eval footer", () => {
    const v = buildPrReview({ pr: PR, sessions: [opusSession()], pricing: PRICING });
    v.quality = summarizeQuality(verdicts, { sessionsTotal: 2, judgeModel: "claude-haiku-4-5" });
    const out = formatPrReview(v);
    expect(out).toContain("Prompt quality");
    expect(out).toContain("7/10");
    expect(out).toContain("(judge · intent-clarity, scope-discipline)");
    expect(out).toContain("⚠ scope-discipline 5/10 — AUTH-42");
    expect(out).toContain("re-scoping");
    expect(out).toContain("Prompt-quality eval:");
  });

  it("omits the worst-rubric callout when the weakest rubric still scores well", () => {
    const strong: SessionRubricVerdict[] = [
      { sessionId: "s1", ticketId: "AUTH-1", rubricId: "intent-clarity", rubricTitle: "Intent Clarity", score: 5, rationale: "Great.", costUsd: 0.001 },
      { sessionId: "s1", ticketId: "AUTH-1", rubricId: "scope-discipline", rubricTitle: "Scope Discipline", score: 4, rationale: "Solid.", costUsd: 0.001 },
    ];
    const v = buildPrReview({ pr: PR, sessions: [opusSession()], pricing: PRICING });
    v.quality = summarizeQuality(strong, { sessionsTotal: 1, judgeModel: "claude-haiku-4-5" });
    expect(formatPrReview(v)).not.toContain("⚠");
  });
});

describe("formatPrReviewMarkdown", () => {
  const qualityVerdicts: SessionRubricVerdict[] = [
    { sessionId: "s1", ticketId: "AUTH-42", rubricId: "intent-clarity", rubricTitle: "Intent Clarity", score: 4, rationale: "Clear ask.", costUsd: 0.001 },
    { sessionId: "s1", ticketId: "AUTH-42", rubricId: "scope-discipline", rubricTitle: "Scope Discipline", score: 2, rationale: "AUTH-42 spent 4 turns re-scoping the table.", costUsd: 0.001 },
  ];

  it("leads with the hidden idempotency marker on the first line", () => {
    const v = buildPrReview({ pr: PR, sessions: [opusSession()], pricing: PRICING });
    const md = formatPrReviewMarkdown(v);
    expect(md.startsWith(PROMPTLY_REVIEW_MARKER)).toBe(true);
    expect(md).toContain(`PR #${PR.number}`);
  });

  it("renders a zero-match PR without tables, still carrying the marker", () => {
    const v = buildPrReview({ pr: PR, sessions: [], pricing: PRICING });
    const md = formatPrReviewMarkdown(v);
    expect(md.startsWith(PROMPTLY_REVIEW_MARKER)).toBe(true);
    expect(md).toContain("wasn't captured by Promptly");
    expect(md).not.toContain("### Sessions");
  });

  it("renders quality, spend, leak, and sessions sections as markdown", () => {
    const v = buildPrReview({ pr: PR, sessions: [opusSession()], pricing: PRICING });
    v.quality = summarizeQuality(qualityVerdicts, { sessionsTotal: 1, judgeModel: "claude-haiku-4-5" });
    // The CLI sets per-session eval cost after judging; mirror that so the
    // Sessions table shows its Eval column.
    v.sessions[0].evalCostUsd = 0.002;
    const md = formatPrReviewMarkdown(v);
    // Scores table.
    expect(md).toContain("| Signal | Score | | |");
    expect(md).toContain("| Prompt quality |");
    expect(md).toContain("| Spend efficiency |");
    // Worst-rubric callout as a blockquote (scope avg 2 → 4/10 ≤ 6).
    expect(md).toContain("> ⚠️ **scope-discipline 4/10**");
    // Leaks + sessions.
    expect(md).toContain("### Leaks");
    expect(md).toContain("### Sessions");
    expect(md).toContain("| Ticket | Session | Date | Model | Cost | Eval |");
    expect(md).toContain("Prompt-quality eval:");
    // Footer.
    expect(md).toContain("updates in place on re-run");
  });

  it("drops the Eval column when no session was judged", () => {
    const v = buildPrReview({ pr: PR, sessions: [opusSession()], pricing: PRICING });
    const md = formatPrReviewMarkdown(v);
    expect(md).toContain("| Ticket | Session | Date | Model | Cost |");
    expect(md).not.toContain("| Ticket | Session | Date | Model | Cost | Eval |");
  });

  it("notes when pricing is unavailable instead of faking a spend score", () => {
    const v = buildPrReview({ pr: PR, sessions: [opusSession()], pricing: null });
    const md = formatPrReviewMarkdown(v);
    expect(md).toContain("pricing unavailable");
    expect(md).not.toContain("### Leaks");
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

  it("skips commits with no oid instead of throwing", () => {
    const raw = JSON.stringify({
      number: 8,
      title: "Partial",
      headRefName: "x",
      commits: [{ oid: "abcdef1234" }, { message: "no oid" }],
    });
    const pr = parsePrView(raw);
    expect(pr.shortShas.has("abcdef1")).toBe(true);
    expect(pr.shortShas.size).toBe(1);
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

  it("does not throw on commits missing a hash (partial/demo git_activity)", () => {
    const rows = [
      // commits without a `hash` field must be skipped, not crash the scan
      { id: "noHash", git_activity: JSON.stringify({ branch: "other", commits: [{ message: "x", insertions: 1 }] }) },
      { id: "byBranch", git_activity: JSON.stringify({ branch: "fix/receipt", commits: [{ message: "y" }] }) },
    ];
    expect(() => matchSessionsToPr(rows, pr)).not.toThrow();
    expect(matchSessionsToPr(rows, pr).map((r) => r.id)).toEqual(["byBranch"]);
  });
});
