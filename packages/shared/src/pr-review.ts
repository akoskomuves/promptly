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
}

/** Parse the JSON from `gh pr view <n> --json number,title,headRefName,baseRefName,commits`. */
export function parsePrView(raw: string): PrDetails {
  const json = JSON.parse(raw) as {
    number: number;
    title: string;
    headRefName: string;
    baseRefName?: string;
    commits?: { oid: string }[];
  };
  return {
    number: json.number,
    title: json.title,
    headRefName: json.headRefName,
    baseRefName: json.baseRefName,
    shortShas: new Set((json.commits ?? []).map((c) => c.oid.slice(0, 7))),
  };
}

interface GitActivityLike {
  branch?: string;
  commits?: { hash: string }[];
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
    return (git.commits ?? []).some((c) => pr.shortShas.has(c.hash.slice(0, 7)));
  });
}

export interface PrSessionCost {
  id: string;
  ticketId: string;
  startedAt: string;
  model: string | null;
  costUsd: number;
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

// ---- rendering -------------------------------------------------------------

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
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

  if (!v.pricingAvailable) {
    out.push("  Model pricing unavailable — spend analysis skipped (offline?).");
    out.push("");
  } else {
    if (v.spendEfficiency != null) {
      const tail = v.avoidableUsd > 0.005 ? `   ← ${fmtUsd(v.avoidableUsd)} avoidable` : "   ✓ clean";
      out.push(`  Spend efficiency   ${bar10(v.spendEfficiency)}  ${v.spendEfficiency}/10${tail}`);
      out.push("");
    }

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
    out.push(
      `    ${(s.ticketId || "(no ticket)").padEnd(12)} ${s.id.slice(0, 8)}  ${date}  ${shortModel(s.model).padEnd(7)} ${cost}`
    );
  }
  out.push("");

  return out.join("\n");
}
