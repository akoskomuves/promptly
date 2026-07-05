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
  type PrMeta,
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

/**
 * Review the sessions behind a GitHub PR and return a human-readable verdict.
 * Read-only: resolves the PR via `gh`, matches recorded sessions by
 * branch/commit, and reuses the shared optimize engine + renderer. Scores prompt
 * quality (LLM-as-judge) alongside spend — at parity with `promptly review --pr`
 * — degrading cleanly to spend-only when ANTHROPIC_API_KEY is unset. Returns an
 * actionable message (never throws) so the MCP handler can relay it directly.
 */
export async function reviewPr(prNumber: number): Promise<string> {
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
      return "GitHub CLI (gh) is not installed/available, so I can't resolve the PR. Install it from https://cli.github.com and run `gh auth login`, then ask me to review the PR again.";
    }
    const stderr = (e.stderr ?? "").toString().trim();
    return stderr
      ? `Couldn't load PR #${prNumber}: ${stderr}`
      : `Couldn't load PR #${prNumber} via the GitHub CLI.`;
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

  return formatPrReview(verdict);
}
