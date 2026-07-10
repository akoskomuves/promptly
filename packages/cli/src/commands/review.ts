import { getSession, listAllSessions } from "../db.js";
import { loadRubric, runJudge, type JudgeResult, type ConversationTurn } from "@getpromptly/shared";
import { getAnalytics, getDistinctId } from "../analytics.js";
import { reviewPrCommand } from "./review-pr.js";

interface ReviewOptions {
  rubric?: string;
  model?: string;
  json?: boolean;
  pr?: string;
  /** PR mode: prompt-quality scoring (on by default; `--no-quality` disables). */
  quality?: boolean;
  /** PR mode: post/update the verdict as a GitHub PR comment. */
  comment?: boolean;
  /** PR mode: set a pass/fail commit status on the PR head. */
  status?: boolean;
  /** PR mode: score threshold (0–10) for `--status` (commander passes a string). */
  statusThreshold?: string;
}

function resolveSession(idOrPrefix: string) {
  const exact = getSession(idOrPrefix);
  if (exact) return exact;
  const matches = listAllSessions().filter((s) => s.id.startsWith(idOrPrefix));
  if (matches.length === 0) {
    throw new Error(`No session found matching id or prefix '${idOrPrefix}'.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous prefix '${idOrPrefix}' — ${matches.length} sessions match. Use a longer prefix.`
    );
  }
  return matches[0];
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

function bar(score: number, max = 5): string {
  const filled = "█".repeat(score * 2);
  const empty = "░".repeat((max - score) * 2);
  return filled + empty;
}

function shortModel(model: string): string {
  if (model.includes("haiku")) return "Haiku";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("opus")) return "Opus";
  return model;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function printVerdict(
  sessionLabel: string,
  rubricTitle: string,
  result: JudgeResult
): void {
  const { verdict, cost, judgeModel } = result;
  const line = "─".repeat(60);

  console.log("");
  console.log(sessionLabel);
  console.log(line);
  console.log(
    `${rubricTitle.padEnd(20)} ${verdict.score}/5  ${bar(verdict.score)}  confidence: ${verdict.confidence}`
  );
  console.log("");
  console.log(verdict.rationale);

  if (verdict.suggestedRewrite) {
    console.log("");
    console.log("Suggested rewrite:");
    for (const ln of verdict.suggestedRewrite.split("\n")) {
      console.log(`  ${ln}`);
    }
  }

  console.log("");
  const usd = cost.totalUsd.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  console.log(
    `Cost: $${usd}  (${shortModel(judgeModel)}, ${formatTokens(cost.inputTokens)} in / ${formatTokens(cost.outputTokens)} out)`
  );
  console.log("");
}

export async function reviewCommand(
  sessionIdOrPrefix: string | undefined,
  options: ReviewOptions = {}
): Promise<void> {
  // PR mode: review every session behind a GitHub PR — prompt quality + spend.
  if (options.pr) {
    const threshold =
      options.statusThreshold != null ? Number(options.statusThreshold) : undefined;
    if (threshold != null && !Number.isFinite(threshold)) {
      console.error(`Invalid --status-threshold: '${options.statusThreshold}'. Expected a number 0–10.`);
      process.exit(1);
    }
    await reviewPrCommand(options.pr, {
      json: options.json,
      quality: options.quality,
      rubric: options.rubric,
      model: options.model,
      comment: options.comment,
      status: options.status,
      statusThreshold: threshold,
    });
    return;
  }

  if (!sessionIdOrPrefix) {
    console.error(
      "Usage: promptly review <session-id-or-prefix> [--rubric <id>]\n       promptly review --pr <number>"
    );
    process.exit(1);
  }

  let session;
  try {
    session = resolveSession(sessionIdOrPrefix);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const turns = parseTurns(session.conversations);
  if (turns.length === 0) {
    console.error(
      `Session ${session.id} has no captured conversation turns — nothing to review.`
    );
    process.exit(1);
  }

  const rubricId = options.rubric ?? "intent-clarity";
  let rubric;
  try {
    rubric = loadRubric(rubricId);
  } catch (err) {
    console.error(`Failed to load rubric '${rubricId}': ${(err as Error).message}`);
    process.exit(1);
  }

  let result: JudgeResult;
  try {
    result = await runJudge({ rubric, turns, model: options.model });
  } catch (err) {
    getAnalytics().captureException(err, getDistinctId(), { rubric_id: rubricId });
    await getAnalytics().shutdown();
    console.error(`Judge failed: ${(err as Error).message}`);
    process.exit(1);
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          sessionId: session.id,
          ticketId: session.ticket_id,
          ...result,
        },
        null,
        2
      )
    );
    return;
  }

  getAnalytics().capture({
    distinctId: getDistinctId(),
    event: "review run",
    properties: {
      rubric_id: result.rubricId,
      score: result.verdict.score,
      confidence: result.verdict.confidence,
      judge_model: result.judgeModel,
      cost_usd: result.cost.totalUsd,
      turn_count: turns.length,
    },
  });
  await getAnalytics().shutdown();

  const dateStr = session.started_at.slice(0, 10);
  const sessionLabel = `Session ${session.id.slice(0, 8)} · ${session.ticket_id || "(no ticket)"} · ${dateStr}`;
  printVerdict(sessionLabel, rubric.title, result);
}
