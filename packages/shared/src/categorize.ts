import type { SessionCategory, GitActivity } from "./types.js";

interface CategorizeInput {
  ticketId: string;
  gitActivity?: GitActivity | null;
  conversations?: { role: string; content: string }[] | null;
}

/**
 * Classify a session by goal using a priority-based heuristic:
 * 1. Ticket ID prefix patterns
 * 2. Git commit message prefixes (conventional commits, majority vote)
 * 3. First user message keywords
 * 4. Fallback to "other"
 */
export function categorizeSession(input: CategorizeInput): SessionCategory {
  const { ticketId, gitActivity, conversations } = input;

  // 1. Ticket ID prefix patterns
  if (ticketId) {
    const fromTicket = categorizeByTicketId(ticketId);
    if (fromTicket) return fromTicket;
  }

  // 2. Git commit message prefixes (conventional commits, majority vote)
  if (gitActivity?.commits?.length) {
    const fromGit = categorizeByCommits(gitActivity.commits);
    if (fromGit) return fromGit;
  }

  // 3. First user message keywords
  if (conversations?.length) {
    const firstUserMessage = conversations.find((c) => c.role === "user");
    if (firstUserMessage) {
      const fromMessage = categorizeByMessage(firstUserMessage.content);
      if (fromMessage) return fromMessage;
    }
  }

  // 4. Fallback
  return "other";
}

function categorizeByTicketId(ticketId: string): SessionCategory | null {
  const patterns: [RegExp, SessionCategory][] = [
    [/^(fix|bug|hotfix)[/-]/i, "bug-fix"],
    [/^bug-\d/i, "bug-fix"],
    [/^(feat|feature)[/-]/i, "feature"],
    [/^feat-\d/i, "feature"],
    [/^(refactor|cleanup)[/-]/i, "refactor"],
    [/^(test|spec)[/-]/i, "testing"],
    [/^(doc|docs)[/-]/i, "docs"],
    [/^(investigate|explore|spike|research)[/-]/i, "investigation"],
  ];

  for (const [pattern, category] of patterns) {
    if (pattern.test(ticketId)) return category;
  }
  return null;
}

const commitPrefixMap: Record<string, SessionCategory> = {
  fix: "bug-fix",
  feat: "feature",
  refactor: "refactor",
  test: "testing",
  docs: "docs",
};

function categorizeByCommits(
  commits: { message: string }[]
): SessionCategory | null {
  const counts: Record<string, number> = {};
  let classifiable = 0;

  for (const commit of commits) {
    const match = commit.message.match(/^(\w+):/);
    if (match) {
      const prefix = match[1].toLowerCase();
      const category = commitPrefixMap[prefix];
      if (category) {
        counts[category] = (counts[category] || 0) + 1;
        classifiable++;
      }
    }
  }

  if (classifiable === 0) return null;

  // Find category with majority (>= 50% of classifiable commits)
  for (const [category, count] of Object.entries(counts)) {
    if (count / classifiable >= 0.5) {
      return category as SessionCategory;
    }
  }
  return null;
}

function categorizeByMessage(content: string): SessionCategory | null {
  const lower = content.toLowerCase();
  const patterns: [RegExp, SessionCategory][] = [
    [/\b(fix|bug|broken|error|crash)\b/, "bug-fix"],
    [/\b(add|implement|create|build|new feature)\b/, "feature"],
    [/\b(refactor|clean up|reorganize|restructure)\b/, "refactor"],
    [/\b(test|spec|coverage)\b/, "testing"],
    [/\b(investigate|explore|debug|figure out|understand)\b/, "investigation"],
    [/\b(doc|readme|documentation)\b/, "docs"],
  ];

  for (const [pattern, category] of patterns) {
    if (pattern.test(lower)) return category;
  }
  return null;
}

/**
 * Extract project prefix from a ticket ID.
 * e.g., "AUTH-123" -> "AUTH", "UI-REDESIGN-45" -> "UI-REDESIGN"
 * Returns null if no numeric suffix pattern found.
 */
export function extractProject(ticketId: string): string | null {
  const match = ticketId.match(/^(.+)-\d+$/);
  return match ? match[1] : null;
}
