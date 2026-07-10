import { execFileSync } from "node:child_process";

// Thin `gh` wrapper. `input` (when given) is fed to stdin; stderr is captured so
// failures surface a friendly message rather than a raw child-process error.
export function gh(args: string[], input?: string): string {
  return execFileSync("gh", args, {
    encoding: "utf-8",
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function ghError(err: unknown, fallback: string): Error {
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
export function resolveRepo(): string {
  try {
    return gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
  } catch (err) {
    throw ghError(err, "Couldn't resolve the GitHub repo for this directory.");
  }
}
