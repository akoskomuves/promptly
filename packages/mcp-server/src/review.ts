import { execFileSync } from "node:child_process";
import {
  buildPrReview,
  formatPrReview,
  parsePrView,
  matchSessionsToPr,
  toOptimizeInput,
  fetchModelPricing,
  judgePrSessions,
  DEFAULT_PR_RUBRICS,
  summarizeQuality,
  computeReviewStatus,
  type PrMeta,
  type PrReviewVerdict,
  type PrCommitStatusState,
  type JudgeableSession,
  type ConversationTurn,
} from "@getpromptly/shared";
import { readSessionsForReview } from "./session.js";

function parseTurns(conversationsJson: string | null): ConversationTurn[] {
  if (!conversationsJson) return [];
  try {
    const parsed = JSON.parse(conversationsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Machine-readable shape of a PR review, mirrored into the tool's structuredContent. */
export interface PrReviewSummary {
  prNumber: number;
  prTitle: string | null;
  sessionCount: number;
  totalTokens: number;
  totalCostUsd: number;
  avoidableUsd: number;
  /** 0–10 spend efficiency; null when model pricing was unavailable. */
  spendEfficiency: number | null;
  /** 0–10 prompt quality; null when the LLM judge didn't run (no ANTHROPIC_API_KEY). */
  qualityScore: number | null;
  /** Pass/fail gate from computeReviewStatus; null when there's nothing to gate on. */
  status: PrCommitStatusState | null;
  recommendations: { id: string; severity: string; title: string }[];
  /** Per-rubric judge scores; empty when the judge didn't run. */
  rubrics: {
    id: string;
    title: string;
    /** 0–10. */
    score10: number;
    /** Lowest-scoring session for this rubric, for the callout. */
    worst: { ticketId: string; score: number; note: string } | null;
  }[];
  /** The sessions that produced the PR, for the cost table. `costUsd` is null when unpriced. */
  sessions: { id: string; ticketId: string; model: string | null; costUsd: number | null }[];
  /** Sessions whose model wasn't in the pricing table — totalCostUsd is a floor when non-zero. */
  unpricedSessions: number;
  /** Rubric id with the lowest score — the thing to fix first. */
  weakestRubricId: string | null;
}

/** A review that ran, or a reason it couldn't. Both carry prose for the model to relay. */
export type PrReviewResult =
  | { ok: true; text: string; summary: PrReviewSummary }
  | { ok: false; text: string };

function toSummary(prNumber: number, v: PrReviewVerdict): PrReviewSummary {
  return {
    prNumber,
    prTitle: v.pr.title ?? null,
    sessionCount: v.sessionCount,
    totalTokens: v.totalTokens,
    totalCostUsd: v.totalCostUsd,
    avoidableUsd: v.avoidableUsd,
    spendEfficiency: v.spendEfficiency,
    qualityScore: v.quality?.overall10 ?? null,
    status: computeReviewStatus(v)?.state ?? null,
    recommendations: v.recommendations.map((r) => ({
      id: r.id,
      severity: r.severity,
      title: r.title,
    })),
    rubrics: (v.quality?.rubrics ?? []).map((r) => ({
      id: r.rubricId,
      title: r.title,
      score10: r.score10,
      worst: r.worst
        ? { ticketId: r.worst.ticketId, score: r.worst.score, note: r.worst.note }
        : null,
    })),
    sessions: v.sessions.map((s) => ({
      id: s.id,
      ticketId: s.ticketId,
      model: s.model,
      costUsd: s.costUsd,
    })),
    weakestRubricId: v.quality?.worst?.rubricId ?? null,
    unpricedSessions: v.unpricedSessions,
  };
}

/**
 * Review the sessions behind a GitHub PR and return a verdict in both prose and
 * machine-readable form. Read-only: resolves the PR via `gh`, matches recorded
 * sessions by branch/commit, and reuses the shared optimize engine + renderer.
 * Scores prompt quality (LLM-as-judge) alongside spend — at parity with
 * `promptly review --pr` — degrading cleanly to spend-only when
 * ANTHROPIC_API_KEY is unset. Never throws: failures come back as
 * `{ ok: false }` with an actionable message the MCP handler relays directly.
 */
export async function reviewPr(prNumber: number): Promise<PrReviewResult> {
  let raw: string;
  try {
    raw = execFileSync(
      "gh",
      ["pr", "view", String(prNumber), "--json", "number,title,headRefName,baseRefName,commits"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (err) {
    const e = err as { code?: string; stderr?: Buffer | string };
    if (e.code === "ENOENT") {
      return {
        ok: false,
        text: "GitHub CLI (gh) is not installed/available, so I can't resolve the PR. Install it from https://cli.github.com and run `gh auth login`, then ask me to review the PR again.",
      };
    }
    const stderr = (e.stderr ?? "").toString().trim();
    return {
      ok: false,
      text: stderr
        ? `Couldn't load PR #${prNumber}: ${stderr}`
        : `Couldn't load PR #${prNumber} via the GitHub CLI.`,
    };
  }

  const pr = parsePrView(raw);
  const rows = matchSessionsToPr(readSessionsForReview(), pr);
  const prMeta: PrMeta = {
    number: pr.number,
    title: pr.title,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
  };
  const pricing = rows.length > 0 ? await fetchModelPricing() : null;
  const verdict = buildPrReview({ pr: prMeta, sessions: toOptimizeInput(rows), pricing });

  // Prompt-quality pass (LLM-as-judge), at parity with the CLI. Never throws:
  // a missing API key or a failed judge call leaves the review spend-only.
  if (rows.length > 0) {
    const costById = new Map(verdict.sessions.map((s) => [s.id, s.costUsd]));
    const judgeable: JudgeableSession[] = rows.map((r) => ({
      id: r.id,
      ticketId: r.ticket_id ?? "",
      turns: parseTurns(r.conversations),
      costUsd: costById.get(r.id) ?? 0,
    }));
    const judged = await judgePrSessions(judgeable, { rubricIds: DEFAULT_PR_RUBRICS });
    if (judged.verdicts.length > 0) {
      verdict.quality = summarizeQuality(judged.verdicts, {
        sessionsTotal: rows.length,
        judgeModel: judged.judgeModel,
      });
      const evalById = new Map<string, number>();
      for (const v of judged.verdicts) {
        evalById.set(v.sessionId, (evalById.get(v.sessionId) ?? 0) + v.costUsd);
      }
      for (const s of verdict.sessions) {
        const e = evalById.get(s.id);
        if (e) s.evalCostUsd = e;
      }
    }
  }

  return { ok: true, text: formatPrReview(verdict), summary: toSummary(prNumber, verdict) };
}
