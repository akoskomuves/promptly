import { execFileSync } from "node:child_process";
import { PROMPTLY_REVIEW_MARKER } from "@getpromptly/shared";

// Thin `gh` wrapper. `input` (when given) is fed to stdin; we capture stderr so
// failures surface a friendly message rather than a raw child-process error.
function gh(args: string[], input?: string): string {
  return execFileSync("gh", args, {
    encoding: "utf-8",
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function ghError(err: unknown, fallback: string): Error {
  const e = err as { code?: string; stderr?: Buffer | string };
  if (e.code === "ENOENT") {
    return new Error(
      "GitHub CLI (gh) not found. Install it from https://cli.github.com, then run 'gh auth login'."
    );
  }
  const stderr = (e.stderr ?? "").toString().trim();
  return new Error(stderr || fallback);
}

/** Resolve "owner/repo" for the current directory's default remote via gh. */
function resolveRepo(): string {
  try {
    return gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
  } catch (err) {
    throw ghError(err, "Couldn't resolve the GitHub repo for this directory.");
  }
}

/**
 * REST id of an existing Promptly review comment on the PR, matched by the
 * hidden marker in its body. Filters server-side with `--jq` so we don't pull
 * every comment body into memory. Returns the first match (there should only
 * ever be one), or null when none exists yet.
 */
function findExistingCommentId(repo: string, prNumber: number): string | null {
  let out: string;
  try {
    out = gh([
      "api",
      `repos/${repo}/issues/${prNumber}/comments`,
      "--paginate",
      "--jq",
      `.[] | select(.body | contains("${PROMPTLY_REVIEW_MARKER}")) | .id`,
    ]);
  } catch (err) {
    throw ghError(err, `Couldn't list comments on PR #${prNumber}.`);
  }
  const first = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0];
  return first ?? null;
}

export interface UpsertResult {
  url: string;
  /** true when an existing comment was edited in place; false when created. */
  updated: boolean;
}

/**
 * Post (or update in place) the Promptly review comment on a PR. Idempotent via
 * the hidden marker in the body: a re-run edits the same comment instead of
 * adding a new one. The body is sent over stdin as a JSON payload, so arbitrary
 * markdown needs no shell escaping. Shells out to `gh`; throws a friendly Error
 * on any failure (missing gh, no repo, no write access, network).
 */
export function upsertPrComment(prNumber: number, body: string): UpsertResult {
  const repo = resolveRepo();
  const existingId = findExistingCommentId(repo, prNumber);
  const payload = JSON.stringify({ body });

  if (existingId) {
    try {
      const url = gh(
        ["api", `repos/${repo}/issues/comments/${existingId}`, "-X", "PATCH", "--input", "-", "--jq", ".html_url"],
        payload
      );
      return { url: url.trim(), updated: true };
    } catch (err) {
      throw ghError(err, "Couldn't update the existing review comment.");
    }
  }

  try {
    const url = gh(
      ["api", `repos/${repo}/issues/${prNumber}/comments`, "-X", "POST", "--input", "-", "--jq", ".html_url"],
      payload
    );
    return { url: url.trim(), updated: false };
  } catch (err) {
    throw ghError(err, "Couldn't post the review comment (does your gh auth have write access to the repo?).");
  }
}
