import type { ConversationTurn, SessionRubricVerdict } from "@getpromptly/shared";
import { loadRubric, type Rubric } from "./rubric.js";
import { runJudge } from "./judge.js";

/** Rubrics scored for a PR by default. Kept small so a PR review stays cheap. */
export const DEFAULT_PR_RUBRICS = ["intent-clarity", "scope-discipline"];

/** Cap on sessions judged per PR — bounds cost/latency; disclosed when it bites. */
export const MAX_JUDGE_SESSIONS = 8;

export interface JudgeableSession {
  id: string;
  ticketId: string;
  turns: ConversationTurn[];
  /** Spend cost, used only to pick the most-expensive sessions when capping. */
  costUsd: number;
}

export interface JudgePrResult {
  verdicts: SessionRubricVerdict[];
  judgeModel: string;
  sessionsJudged: number;
  /** Set when quality scoring couldn't run (and verdicts is therefore empty). */
  skippedReason?: string;
}

/**
 * Judge every eligible session behind a PR on the configured rubric set. Never
 * throws: a missing API key, an unloadable rubric, or a failed judge call
 * downgrades to a spend-only review (skippedReason set, verdicts empty), so the
 * PR review always renders.
 */
export async function judgePrSessions(
  sessions: JudgeableSession[],
  opts: { rubricIds?: string[]; model?: string; apiKey?: string } = {}
): Promise<JudgePrResult> {
  const empty = (skippedReason: string): JudgePrResult => ({
    verdicts: [],
    judgeModel: "",
    sessionsJudged: 0,
    skippedReason,
  });

  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return empty("ANTHROPIC_API_KEY not set");

  const rubricIds = opts.rubricIds ?? DEFAULT_PR_RUBRICS;
  let rubrics: Rubric[];
  try {
    rubrics = rubricIds.map((id) => loadRubric(id));
  } catch (err) {
    return empty(`rubric load failed: ${(err as Error).message}`);
  }

  // Only sessions with captured turns are judgeable; take the most expensive up
  // to the cap so a big PR doesn't fan out into a large eval bill.
  const judgeable = sessions
    .filter((s) => s.turns.length > 0)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, MAX_JUDGE_SESSIONS);

  const verdicts: SessionRubricVerdict[] = [];
  let judgeModel = "";
  for (const s of judgeable) {
    for (const rubric of rubrics) {
      try {
        const res = await runJudge({ rubric, turns: s.turns, model: opts.model, apiKey });
        judgeModel = res.judgeModel;
        verdicts.push({
          sessionId: s.id,
          ticketId: s.ticketId,
          rubricId: res.rubricId,
          rubricTitle: rubric.title,
          score: res.verdict.score,
          rationale: res.verdict.rationale,
          costUsd: res.cost.totalUsd,
        });
      } catch {
        // One bad judge call shouldn't sink the review — skip this pair, keep going.
      }
    }
  }

  if (verdicts.length === 0) return empty("all judge calls failed");
  return {
    verdicts,
    judgeModel,
    sessionsJudged: new Set(verdicts.map((v) => v.sessionId)).size,
  };
}
