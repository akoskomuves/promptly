import { execSync } from "node:child_process";
import type { GitActivity, GitCommit } from "@getpromptly/shared";

const SEPARATOR = "---PROMPTLY_SEP---";
const EXEC_OPTS = { timeout: 10000, stdio: "pipe" as const };

/**
 * Capture git activity (commits, branch, diff stats) that occurred
 * during the session window (from startedAt to now).
 * Returns null if not in a git repo or on any error.
 */
export function captureGitActivity(startedAt: string): GitActivity | null {
  try {
    // Check if we're inside a git repo
    execSync("git rev-parse --is-inside-work-tree", EXEC_OPTS);
  } catch {
    return null;
  }

  try {
    // Get current branch
    let branch: string;
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", EXEC_OPTS)
        .toString()
        .trim();
      if (!branch || branch === "HEAD") branch = "unknown";
    } catch {
      branch = "unknown";
    }

    // Get commits since session start with stats
    const format = `${SEPARATOR}%n%h%n%s%n%aI`;
    const logOutput = execSync(
      `git log --since="${startedAt}" --format="${format}" --shortstat`,
      EXEC_OPTS
    )
      .toString()
      .trim();

    if (!logOutput) {
      return {
        branch,
        commits: [],
        totalCommits: 0,
        totalInsertions: 0,
        totalDeletions: 0,
        totalFilesChanged: 0,
      };
    }

    // Parse commit blocks
    const blocks = logOutput
      .split(SEPARATOR)
      .filter((b) => b.trim().length > 0);

    const commits: GitCommit[] = [];

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length < 3) continue;

      const hash = lines[0].trim();
      const message = lines[1].trim();
      const timestamp = lines[2].trim();

      // shortstat is on the remaining lines (may be empty for empty commits)
      const statLine = lines.slice(3).join(" ");
      const filesMatch = statLine.match(/(\d+) file/);
      const insertMatch = statLine.match(/(\d+) insertion/);
      const deleteMatch = statLine.match(/(\d+) deletion/);

      commits.push({
        hash,
        message,
        timestamp,
        filesChanged: filesMatch ? parseInt(filesMatch[1]) : 0,
        insertions: insertMatch ? parseInt(insertMatch[1]) : 0,
        deletions: deleteMatch ? parseInt(deleteMatch[1]) : 0,
      });
    }

    const totalInsertions = commits.reduce((s, c) => s + c.insertions, 0);
    const totalDeletions = commits.reduce((s, c) => s + c.deletions, 0);
    const totalFilesChanged = commits.reduce((s, c) => s + c.filesChanged, 0);

    return {
      branch,
      commits,
      totalCommits: commits.length,
      totalInsertions,
      totalDeletions,
      totalFilesChanged,
    };
  } catch {
    return null;
  }
}
