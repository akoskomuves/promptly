import { execFileSync } from "node:child_process";
import { listAllSessions } from "../db.js";
import {
  buildPrReview,
  formatPrReview,
  parsePrView,
  matchSessionsToPr,
  toOptimizeInput,
  summarizeQuality,
  type PrDetails,
  type PrMeta,
  type ConversationTurn,
} from "@getpromptly/shared";
import { fetchPricing } from "./optimize.js";
import { judgePrSessions, DEFAULT_PR_RUBRICS, type JudgeableSession } from "../eval/judge-pr.js";
import { getAnalytics, getDistinctId } from "../analytics.js";
import type { DbSession } from "../db.js";

// Resolve PR metadata (head branch + commit SHAs) via the GitHub CLI. We match
// sessions to a PR by these, so `gh` is the only external dependency.
function getPrDetails(prNumber: number): PrDetails {
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
      throw new Error(
        "GitHub CLI (gh) not found. Install it from https://cli.github.com, then run 'gh auth login'."
      );
    }
    const stderr = (e.stderr ?? "").toString().trim();
    throw new Error(stderr || `'gh pr view ${prNumber}' failed.`);
  }
  return parsePrView(raw);
}

function spanDays(rows: DbSession[]): number {
  const times = rows
    .map((r) => new Date(r.started_at).getTime())
    .filter((t) => !Number.isNaN(t));
  if (times.length === 0) return 1;
  const span = (Math.max(...times) - Math.min(...times)) / 86_400_000;
  return Math.max(1, Math.round(span));
}

function parseTurns(conversationsJson: string): ConversationTurn[] {
  if (!conversationsJson) return [];
  try {
    const parsed = JSON.parse(conversationsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface ReviewPrOptions {
  json?: boolean;
  /** Prompt-quality (LLM-as-judge) scoring; on by default, `--no-quality` disables. */
  quality?: boolean;
  /** Restrict quality scoring to a single rubric (default: the PR rubric set). */
  rubric?: string;
  /** Override the judge model. */
  model?: string;
}

export async function reviewPrCommand(
  prArg: string,
  options: ReviewPrOptions = {}
): Promise<void> {
  const prNumber = parseInt(String(prArg).replace(/^#/, ""), 10);
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    console.error(`Invalid PR number: '${prArg}'. Usage: promptly review --pr <number>`);
    process.exit(1);
  }

  let pr: PrDetails;
  try {
    pr = getPrDetails(prNumber);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const rows: DbSession[] = matchSessionsToPr(listAllSessions(), pr);
  const prMeta: PrMeta = {
    number: pr.number,
    title: pr.title,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
  };

  const pricing = rows.length > 0 ? await fetchPricing() : null;
  const verdict = buildPrReview({
    pr: prMeta,
    sessions: toOptimizeInput(rows),
    pricing,
    windowDays: spanDays(rows),
  });

  // Prompt-quality pass (LLM-as-judge). On by default; skipped cleanly when
  // disabled, when nothing matched, or when no API key / judge failure (the
  // review then renders spend-only).
  let qualitySkip: string | undefined;
  if (options.quality !== false && rows.length > 0) {
    const costById = new Map(verdict.sessions.map((s) => [s.id, s.costUsd]));
    const judgeable: JudgeableSession[] = rows.map((r) => ({
      id: r.id,
      ticketId: r.ticket_id ?? "",
      turns: parseTurns(r.conversations),
      costUsd: costById.get(r.id) ?? 0,
    }));
    const rubricIds = options.rubric ? [options.rubric] : DEFAULT_PR_RUBRICS;
    const judged = await judgePrSessions(judgeable, { rubricIds, model: options.model });

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
    } else {
      qualitySkip = judged.skippedReason;
    }
  }

  if (options.json) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    console.log(formatPrReview(verdict));
    if (qualitySkip) {
      console.log(`  Prompt quality skipped — ${qualitySkip}.\n`);
    }
  }

  getAnalytics().capture({
    distinctId: getDistinctId(),
    event: "pr review run",
    properties: {
      pr_number: pr.number,
      session_count: verdict.sessionCount,
      total_cost_usd: verdict.totalCostUsd,
      avoidable_usd: verdict.avoidableUsd,
      spend_efficiency: verdict.spendEfficiency,
      quality_score: verdict.quality?.overall10 ?? null,
      eval_cost_usd: verdict.quality?.evalCostUsd ?? 0,
      rubrics: verdict.quality?.rubrics.map((r) => r.rubricId) ?? [],
    },
  });
  await getAnalytics().shutdown();
}
