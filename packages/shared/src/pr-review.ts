// PR-scoped prompt review: link a set of recorded sessions to a GitHub PR and
// produce a single verdict (spend efficiency + avoidable-cost leaks) by reusing
// the optimization engine. Pure data + a plain-text renderer, so the CLI command
// and the MCP `promptly_review` trigger present identical output.

import {
  runOptimizationDetectors,
  findPricing,
  costFor,
  type OptimizeSessionInput,
  type ModelPricing,
  type OptimizationRecommendation,
  type OptimizationEvidence,
} from "./optimize.js";

export interface PrMeta {
  number: number;
  title: string;
  headRefName: string;
  baseRefName?: string;
}

/** PR metadata plus the set of short (7-char) commit SHAs used for matching. */
export interface PrDetails extends PrMeta {
  shortShas: Set<string>;
  /** Full head commit SHA — the target for a commit status. */
  headRefOid?: string;
}

/** Parse the JSON from `gh pr view <n> --json number,title,headRefName,baseRefName,headRefOid,commits`. */
export function parsePrView(raw: string): PrDetails {
  const json = JSON.parse(raw) as {
    number: number;
    title: string;
    headRefName: string;
    baseRefName?: string;
    headRefOid?: string;
    commits?: { oid?: string }[];
  };
  return {
    number: json.number,
    title: json.title,
    headRefName: json.headRefName,
    baseRefName: json.baseRefName,
    headRefOid: typeof json.headRefOid === "string" ? json.headRefOid : undefined,
    shortShas: new Set(
      (json.commits ?? [])
        .map((c) => c.oid)
        .filter((oid): oid is string => typeof oid === "string")
        .map((oid) => oid.slice(0, 7))
    ),
  };
}

interface GitActivityLike {
  branch?: string;
  commits?: { hash?: string }[];
}

/**
 * A session belongs to a PR if it was recorded on the PR's head branch, or if
 * any of its captured commits is in the PR. Union = higher recall; the commit
 * match catches sessions whose branch was renamed or squashed. Generic over any
 * row carrying a `git_activity` JSON string (CLI DbSession or the MCP read row).
 */
export function matchSessionsToPr<T extends { git_activity: string | null }>(
  rows: T[],
  pr: PrDetails
): T[] {
  return rows.filter((s) => {
    if (!s.git_activity) return false;
    let git: GitActivityLike;
    try {
      git = JSON.parse(s.git_activity) as GitActivityLike;
    } catch {
      return false;
    }
    if (git.branch && git.branch === pr.headRefName) return true;
    // Not every captured commit carries a hash (older/partial git_activity, or
    // demo data), so guard before slicing — one hash-less commit must not sink
    // the whole review.
    return (git.commits ?? []).some(
      (c) => typeof c?.hash === "string" && pr.shortShas.has(c.hash.slice(0, 7))
    );
  });
}

export interface PrSessionCost {
  id: string;
  ticketId: string;
  startedAt: string;
  model: string | null;
  costUsd: number;
  /** Judge (LLM-as-judge) cost for this session, when quality scoring ran. */
  evalCostUsd?: number;
}

/** One judge verdict: a single session scored on a single rubric. */
export interface SessionRubricVerdict {
  sessionId: string;
  ticketId: string;
  rubricId: string;
  rubricTitle: string;
  /** Raw judge score, 1-5. */
  score: number;
  rationale: string;
  costUsd: number;
}

export interface RubricScore {
  rubricId: string;
  title: string;
  /** Mean judge score across sessions, 1-5. */
  avgScore: number;
  /** Display score, 0-10 (round(avgScore * 2)). */
  score10: number;
  /** The single lowest-scoring session for this rubric, for the callout. */
  worst: { sessionId: string; ticketId: string; score: number; note: string } | null;
}

/** Aggregate prompt-quality picture for a PR, from a set of judge verdicts. */
export interface QualitySummary {
  /** Overall quality, 0-10. */
  overall10: number;
  rubrics: RubricScore[];
  /** Lowest-scoring rubric — the thing to fix first. */
  worst: RubricScore | null;
  evalCostUsd: number;
  sessionsJudged: number;
  sessionsTotal: number;
  judgeModel: string;
}

export interface PrReviewVerdict {
  pr: PrMeta;
  sessionCount: number;
  totalTokens: number;
  totalCostUsd: number;
  avoidableUsd: number;
  /** 0-10 spend efficiency; null when pricing is unavailable. */
  spendEfficiency: number | null;
  pricingAvailable: boolean;
  recommendations: OptimizationRecommendation[];
  sessions: PrSessionCost[];
  /** Prompt-quality verdict from the judge; null when quality scoring didn't run. */
  quality?: QualitySummary | null;
}

/**
 * PR-actual avoidable dollars carried by a recommendation's evidence. Only
 * model-misuse and context-bloat carry real per-session dollars; the workflow /
 * correction detectors are time patterns, so they contribute 0 to the $ figure.
 */
export function recAvoidableUsd(rec: OptimizationRecommendation): number {
  let sum = 0;
  for (const e of rec.evidence) {
    if (e.kind === "model-misuse") sum += e.currentCost - e.alternativeCost;
    else if (e.kind === "context-bloat") sum += e.estimatedWaste;
  }
  return sum;
}

export function buildPrReview(args: {
  pr: PrMeta;
  sessions: OptimizeSessionInput[];
  pricing: Record<string, ModelPricing> | null;
  windowDays?: number;
}): PrReviewVerdict {
  const { pr, sessions, pricing } = args;
  const windowDays = Math.max(1, args.windowDays ?? 30);

  const recommendations = pricing
    ? runOptimizationDetectors({ sessions, pricing, windowDays })
    : [];

  const sessionCosts: PrSessionCost[] = sessions.map((s) => {
    const model = s.models[0] ?? null;
    let costUsd = 0;
    if (pricing && model) {
      const price = findPricing(pricing, model);
      if (price) costUsd = costFor(s.promptTokens, s.responseTokens, price);
    }
    return { id: s.id, ticketId: s.ticketId, startedAt: s.startedAt, model, costUsd };
  });
  sessionCosts.sort((a, b) => b.costUsd - a.costUsd);

  const totalTokens = sessions.reduce((n, s) => n + s.totalTokens, 0);
  const totalCostUsd = sessionCosts.reduce((n, s) => n + s.costUsd, 0);
  const avoidableUsd = recommendations.reduce((n, r) => n + recAvoidableUsd(r), 0);

  let spendEfficiency: number | null = null;
  if (pricing && totalCostUsd > 0) {
    const ratio = 1 - avoidableUsd / totalCostUsd;
    spendEfficiency = Math.round(Math.max(0, Math.min(1, ratio)) * 10);
  } else if (pricing) {
    spendEfficiency = 10;
  }

  return {
    pr,
    sessionCount: sessions.length,
    totalTokens,
    totalCostUsd,
    avoidableUsd,
    spendEfficiency,
    pricingAvailable: pricing != null,
    recommendations,
    sessions: sessionCosts,
  };
}

/** 1-5 judge score → 0-10 display score. */
function score10(avg: number): number {
  return Math.round(Math.max(0, Math.min(5, avg)) * 2);
}

/** First sentence of a rationale, collapsed and truncated for a one-line callout. */
function oneLine(text: string, max = 80): string {
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  const t = first.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Aggregate per-session per-rubric judge verdicts into a single PR quality
 * picture. Pure: the CLI (and later the MCP trigger) run the judge, then hand
 * the raw verdicts here. Returns null when there's nothing to summarize.
 */
export function summarizeQuality(
  items: SessionRubricVerdict[],
  meta: { sessionsTotal: number; judgeModel: string }
): QualitySummary | null {
  if (items.length === 0) return null;

  const byRubric = new Map<string, SessionRubricVerdict[]>();
  for (const it of items) {
    const arr = byRubric.get(it.rubricId);
    if (arr) arr.push(it);
    else byRubric.set(it.rubricId, [it]);
  }

  const rubrics: RubricScore[] = [];
  for (const [rubricId, arr] of byRubric) {
    const avg = arr.reduce((n, x) => n + x.score, 0) / arr.length;
    const worstItem = arr.reduce((a, b) => (b.score < a.score ? b : a));
    rubrics.push({
      rubricId,
      title: arr[0].rubricTitle,
      avgScore: avg,
      score10: score10(avg),
      worst: {
        sessionId: worstItem.sessionId,
        ticketId: worstItem.ticketId,
        score: worstItem.score,
        note: oneLine(worstItem.rationale),
      },
    });
  }
  rubrics.sort((a, b) => a.rubricId.localeCompare(b.rubricId));

  const overallAvg = items.reduce((n, x) => n + x.score, 0) / items.length;
  const worst = rubrics.reduce<RubricScore | null>(
    (w, r) => (w == null || r.avgScore < w.avgScore ? r : w),
    null
  );

  return {
    overall10: score10(overallAvg),
    rubrics,
    worst,
    evalCostUsd: items.reduce((n, x) => n + x.costUsd, 0),
    sessionsJudged: new Set(items.map((x) => x.sessionId)).size,
    sessionsTotal: meta.sessionsTotal,
    judgeModel: meta.judgeModel,
  };
}

// ---- rendering -------------------------------------------------------------

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Like fmtUsd but keeps sub-cent precision — eval costs are often < $0.01. */
function fmtUsdFine(n: number): string {
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function bar10(score: number): string {
  const s = Math.max(0, Math.min(10, score));
  return "█".repeat(s) + "░".repeat(10 - s);
}

function shortModel(model: string | null): string {
  if (!model) return "?";
  const l = model.toLowerCase();
  if (l.includes("haiku")) return "haiku";
  if (l.includes("sonnet")) return "sonnet";
  if (l.includes("opus")) return "opus";
  return model;
}

function evidenceLine(e: OptimizationEvidence): string | null {
  if (e.kind === "model-misuse") {
    const saved = e.currentCost - e.alternativeCost;
    return `${e.ticketId.padEnd(12)} ${e.sessionId.slice(0, 8)}  ${shortModel(e.model)}  ${fmtUsd(e.currentCost)} → ${fmtUsd(e.alternativeCost)} (${shortModel(e.alternativeModel)})  saves ${fmtUsd(saved)}`;
  }
  if (e.kind === "context-bloat") {
    return `${e.ticketId.padEnd(12)} ${e.sessionId.slice(0, 8)}  ${shortModel(e.model)}  ${fmtUsd(e.totalCost)} (~${fmtUsd(e.estimatedWaste)} wasted, ${Math.round(e.contextUtilization * 100)}% ctx)`;
  }
  if (e.kind === "repetitive-workflow") {
    return `${e.ticketId.padEnd(12)} ${e.sessionId.slice(0, 8)}  ran the workflow ${e.occurrenceCount}×`;
  }
  if (e.kind === "repeated-correction") {
    return `${e.ticketId.padEnd(12)} ${e.sessionId.slice(0, 8)}  said: "${e.originalPhrase}"`;
  }
  if (e.kind === "pre-post-action") {
    return `${e.ticketId.padEnd(12)} ${e.sessionId.slice(0, 8)}  pair ran ${e.occurrences}×`;
  }
  return null;
}

const APPLIABLE = new Set([
  "repetitive-workflow",
  "repeated-corrections",
  "pre-post-action",
]);

export function formatPrReview(v: PrReviewVerdict): string {
  const out: string[] = [];
  out.push("");
  out.push(`🔍 Promptly — review of PR #${v.pr.number} "${v.pr.title}"`);
  out.push("");

  if (v.sessionCount === 0) {
    out.push(`  No recorded Promptly sessions matched this PR (branch: ${v.pr.headRefName}).`);
    out.push(`  Nothing to review — the work behind this PR wasn't captured by Promptly.`);
    out.push("");
    return out.join("\n");
  }

  const costStr = v.totalCostUsd > 0 ? ` · ${fmtUsd(v.totalCostUsd)}` : "";
  out.push(
    `  Built in ${v.sessionCount} session${v.sessionCount === 1 ? "" : "s"} · ${fmtTokens(v.totalTokens)} tokens${costStr}`
  );
  out.push(`  branch: ${v.pr.headRefName}`);
  out.push("");

  // Prompt quality (LLM-as-judge) — shown independently of pricing.
  if (v.quality) {
    const ids = v.quality.rubrics.map((r) => r.rubricId).join(", ");
    out.push(
      `  Prompt quality     ${bar10(v.quality.overall10)}  ${v.quality.overall10}/10   (judge · ${ids})`
    );
  }

  // Spend efficiency.
  if (!v.pricingAvailable) {
    out.push("  Model pricing unavailable — spend analysis skipped (offline?).");
  } else if (v.spendEfficiency != null) {
    const tail = v.avoidableUsd > 0.005 ? `   ← ${fmtUsd(v.avoidableUsd)} avoidable` : "   ✓ clean";
    out.push(`  Spend efficiency   ${bar10(v.spendEfficiency)}  ${v.spendEfficiency}/10${tail}`);
  }

  // Worst-rubric callout — only when a rubric scored notably low.
  const worst = v.quality?.worst;
  if (worst?.worst && worst.score10 <= 6) {
    const who = worst.worst.ticketId || worst.worst.sessionId.slice(0, 8);
    // Avoid "AUTH-42 AUTH-42 …" when the judge's note already opens with the ticket.
    let note = worst.worst.note;
    if (who && note.toLowerCase().startsWith(who.toLowerCase())) {
      note = note.slice(who.length).replace(/^[\s:—-]+/, "");
    }
    out.push(`  ⚠ ${worst.rubricId} ${worst.score10}/10 — ${who} ${note}`);
  }
  out.push("");

  if (v.pricingAvailable) {
    if (v.recommendations.length === 0) {
      out.push("  No spend leaks detected in the prompts behind this PR. 👍");
      out.push("");
    } else {
      out.push("  Leaks:");
      for (const rec of v.recommendations) {
        const avoid = recAvoidableUsd(rec);
        const tag = rec.severity === "critical" ? "[!!]" : rec.severity === "warning" ? "[!]" : "[i]";
        const dollars = avoid > 0.005 ? ` — ${fmtUsd(avoid)} avoidable on this PR` : "";
        out.push(`  ${tag} ${rec.title}${dollars}`);
        for (const e of rec.evidence.slice(0, 2)) {
          const line = evidenceLine(e);
          if (line) out.push(`      ${line}`);
        }
        if (APPLIABLE.has(rec.type)) {
          out.push(`      fix: promptly optimize --apply "${rec.id}"`);
        }
        out.push("");
      }
    }
  }

  out.push("  Sessions:");
  for (const s of v.sessions) {
    const date = s.startedAt.slice(0, 10);
    const cost = s.costUsd > 0 ? fmtUsd(s.costUsd) : "—";
    const evalStr = s.evalCostUsd && s.evalCostUsd > 0 ? `  eval ${fmtUsdFine(s.evalCostUsd)}` : "";
    out.push(
      `    ${(s.ticketId || "(no ticket)").padEnd(12)} ${s.id.slice(0, 8)}  ${date}  ${shortModel(s.model).padEnd(7)} ${cost}${evalStr}`
    );
  }
  out.push("");

  if (v.quality) {
    const q = v.quality;
    const judged =
      q.sessionsJudged < q.sessionsTotal ? ` · judged ${q.sessionsJudged}/${q.sessionsTotal} sessions` : "";
    out.push(`  Prompt-quality eval: ${fmtUsdFine(q.evalCostUsd)}  (${shortModel(q.judgeModel)}${judged})`);
    out.push("");
  }

  return out.join("\n");
}

// ---- markdown rendering (for GitHub PR comments) ---------------------------

/**
 * Hidden HTML-comment marker embedded as the first line of every posted PR
 * comment. It lets `promptly review --pr --comment` find its own prior comment
 * and edit it in place on re-run, instead of stacking a new one. GitHub renders
 * HTML comments invisibly, so it never shows to readers.
 */
export const PROMPTLY_REVIEW_MARKER = "<!-- promptly-review -->";

function mdFooter(): string {
  return `<sub>🌱 Posted by [Promptly](https://getpromptly.xyz) · updates in place on re-run.</sub>`;
}

/** Collapse whitespace so a padded terminal evidence line sits in inline code. */
function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Render a PR review as GitHub-flavored markdown for posting as a PR comment.
 * Pure sibling of `formatPrReview` (terminal): tables render aligned in a
 * proportional font, block-bars stay in inline code, and the first line is the
 * idempotency marker. Handles the zero-match case for completeness, though the
 * CLI declines to post in that case.
 */
export function formatPrReviewMarkdown(v: PrReviewVerdict): string {
  const out: string[] = [];
  out.push(PROMPTLY_REVIEW_MARKER);
  out.push("");
  out.push(`## 🔍 Promptly — prompt review of PR #${v.pr.number}`);
  out.push("");

  if (v.sessionCount === 0) {
    out.push(
      `No recorded Promptly sessions matched this PR (branch \`${v.pr.headRefName}\`) — the work behind it wasn't captured by Promptly, so there's nothing to review.`
    );
    out.push("");
    out.push(mdFooter());
    return out.join("\n");
  }

  const costStr = v.totalCostUsd > 0 ? ` · ${fmtUsd(v.totalCostUsd)}` : "";
  out.push(
    `Built in **${v.sessionCount} session${v.sessionCount === 1 ? "" : "s"}** · ${fmtTokens(v.totalTokens)} tokens${costStr} · branch \`${v.pr.headRefName}\``
  );
  out.push("");

  // Scores table (quality and/or spend efficiency).
  const scoreRows: string[] = [];
  if (v.quality) {
    const ids = v.quality.rubrics.map((r) => r.rubricId).join(", ");
    scoreRows.push(
      `| Prompt quality | **${v.quality.overall10}/10** | \`${bar10(v.quality.overall10)}\` | judge · ${ids} |`
    );
  }
  if (!v.pricingAvailable) {
    scoreRows.push(`| Spend efficiency | — | | pricing unavailable (offline?) |`);
  } else if (v.spendEfficiency != null) {
    const note = v.avoidableUsd > 0.005 ? `${fmtUsd(v.avoidableUsd)} avoidable` : "clean ✓";
    scoreRows.push(
      `| Spend efficiency | **${v.spendEfficiency}/10** | \`${bar10(v.spendEfficiency)}\` | ${note} |`
    );
  }
  if (scoreRows.length > 0) {
    out.push(`| Signal | Score | | |`);
    out.push(`|---|---|---|---|`);
    out.push(...scoreRows);
    out.push("");
  }

  // Worst-rubric callout — only when a rubric scored notably low.
  const worst = v.quality?.worst;
  if (worst?.worst && worst.score10 <= 6) {
    const who = worst.worst.ticketId || worst.worst.sessionId.slice(0, 8);
    let note = worst.worst.note;
    if (who && note.toLowerCase().startsWith(who.toLowerCase())) {
      note = note.slice(who.length).replace(/^[\s:—-]+/, "");
    }
    out.push(`> ⚠️ **${worst.rubricId} ${worst.score10}/10** — ${who}: ${note}`);
    out.push("");
  }

  // Spend leaks.
  if (v.pricingAvailable) {
    if (v.recommendations.length === 0) {
      out.push("**No spend leaks** detected in the prompts behind this PR. 👍");
      out.push("");
    } else {
      out.push("### Leaks");
      out.push("");
      for (const rec of v.recommendations) {
        const avoid = recAvoidableUsd(rec);
        const tag = rec.severity === "critical" ? "🔴" : rec.severity === "warning" ? "🟠" : "🔵";
        const dollars = avoid > 0.005 ? ` — **${fmtUsd(avoid)} avoidable** on this PR` : "";
        out.push(`- ${tag} **${rec.title}**${dollars}`);
        for (const e of rec.evidence.slice(0, 2)) {
          const line = evidenceLine(e);
          if (line) out.push(`  - \`${collapse(line)}\``);
        }
        if (APPLIABLE.has(rec.type)) {
          out.push(`  - fix: \`promptly optimize --apply "${rec.id}"\``);
        }
      }
      out.push("");
    }
  }

  // Sessions table.
  out.push("### Sessions");
  out.push("");
  const hasEval = v.sessions.some((s) => s.evalCostUsd && s.evalCostUsd > 0);
  out.push(hasEval ? "| Ticket | Session | Date | Model | Cost | Eval |" : "| Ticket | Session | Date | Model | Cost |");
  out.push(hasEval ? "|---|---|---|---|---|---|" : "|---|---|---|---|---|");
  for (const s of v.sessions) {
    const date = s.startedAt.slice(0, 10);
    const cost = s.costUsd > 0 ? fmtUsd(s.costUsd) : "—";
    const cells = [s.ticketId || "(no ticket)", `\`${s.id.slice(0, 8)}\``, date, shortModel(s.model), cost];
    if (hasEval) cells.push(s.evalCostUsd && s.evalCostUsd > 0 ? fmtUsdFine(s.evalCostUsd) : "—");
    out.push(`| ${cells.join(" | ")} |`);
  }
  out.push("");

  if (v.quality) {
    const q = v.quality;
    const judged =
      q.sessionsJudged < q.sessionsTotal ? ` · judged ${q.sessionsJudged}/${q.sessionsTotal} sessions` : "";
    out.push(`Prompt-quality eval: ${fmtUsdFine(q.evalCostUsd)} (${shortModel(q.judgeModel)}${judged})`);
    out.push("");
  }

  out.push(mdFooter());
  return out.join("\n");
}

// ---- PR commit status -------------------------------------------------------

/** GitHub commit-status state. (No "neutral" — that's the Checks API, not Statuses.) */
export type PrCommitStatusState = "success" | "failure" | "pending" | "error";

export interface PrCommitStatus {
  state: PrCommitStatusState;
  /** ≤140 chars for GitHub; carries the numbers, e.g. "Prompt quality 8/10 · $0.42 avoidable". */
  description: string;
  context: string;
}

/** The status context string that shows in the PR's checks list. */
export const REVIEW_STATUS_CONTEXT = "promptly/prompt-review";

/** Default score (0–10) at or above which the review status passes. */
export const DEFAULT_STATUS_THRESHOLD = 7;

/**
 * Map a review verdict to a pass/fail commit status. Gates on prompt quality
 * when available, else falls back to spend efficiency (same 0–10 scale), else
 * returns null — nothing to gate on, so the caller sets no status. Pure.
 */
export function computeReviewStatus(
  v: PrReviewVerdict,
  opts: { threshold?: number } = {}
): PrCommitStatus | null {
  const threshold = opts.threshold ?? DEFAULT_STATUS_THRESHOLD;

  let score: number;
  let label: string;
  if (v.quality) {
    score = v.quality.overall10;
    label = `Prompt quality ${score}/10`;
  } else if (v.spendEfficiency != null) {
    score = v.spendEfficiency;
    label = `Spend efficiency ${score}/10`;
  } else {
    return null;
  }

  const avoid = v.avoidableUsd > 0.005 ? ` · ${fmtUsd(v.avoidableUsd)} avoidable` : "";
  return {
    state: score >= threshold ? "success" : "failure",
    description: `${label}${avoid}`.slice(0, 140),
    context: REVIEW_STATUS_CONTEXT,
  };
}
