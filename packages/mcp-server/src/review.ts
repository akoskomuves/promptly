import { execFileSync } from "node:child_process";
import {
  buildPrReview,
  formatPrReview,
  parsePrView,
  matchSessionsToPr,
  toOptimizeInput,
  fetchModelPricing,
  type PrMeta,
} from "@getpromptly/shared";
import { readSessionsForReview } from "./session.js";

/**
 * Review the sessions behind a GitHub PR and return a human-readable verdict.
 * Read-only: resolves the PR via `gh`, matches recorded sessions by
 * branch/commit, and reuses the shared optimize engine + renderer. Returns an
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
  return formatPrReview(verdict);
}
