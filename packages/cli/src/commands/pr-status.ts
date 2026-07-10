import type { PrCommitStatus } from "@getpromptly/shared";
import { gh, ghError, resolveRepo } from "./gh.js";

export interface SetStatusResult {
  state: string;
  sha: string;
}

/**
 * Post a commit status on the PR head SHA via the GitHub Statuses API, so the
 * prompt-review verdict shows up in the PR's checks list. Uses a personal token
 * (no GitHub App needed). Throws a friendly Error on failure.
 */
export function setPrStatus(sha: string, status: PrCommitStatus): SetStatusResult {
  const repo = resolveRepo();
  const payload = JSON.stringify({
    state: status.state,
    description: status.description,
    context: status.context,
  });
  try {
    gh(
      ["api", `repos/${repo}/statuses/${sha}`, "-X", "POST", "--input", "-", "--jq", ".state"],
      payload
    );
    return { state: status.state, sha };
  } catch (err) {
    throw ghError(
      err,
      "Couldn't set the PR status (does your gh auth have repo:status write access?)."
    );
  }
}
