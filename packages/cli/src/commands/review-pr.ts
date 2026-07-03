import { execFileSync } from "node:child_process";
import { listAllSessions } from "../db.js";
import {
  buildPrReview,
  formatPrReview,
  parsePrView,
  matchSessionsToPr,
  toOptimizeInput,
  type PrDetails,
  type PrMeta,
} from "@getpromptly/shared";
import { fetchPricing } from "./optimize.js";
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

export async function reviewPrCommand(
  prArg: string,
  options: { json?: boolean } = {}
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

  if (options.json) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    console.log(formatPrReview(verdict));
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
    },
  });
  await getAnalytics().shutdown();
}
