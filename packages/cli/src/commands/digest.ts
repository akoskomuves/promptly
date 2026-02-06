import { listAllSessions } from "../db.js";
import type { DbSession } from "../db.js";
import { computeWeeklyDigest } from "@getpromptly/shared";
import type { DigestSessionInput, WeeklyDigest } from "@getpromptly/shared";

function convertDbSession(s: DbSession): DigestSessionInput {
  let models: string[] = [];
  try {
    models = JSON.parse(s.models || "[]");
  } catch {
    // ignore
  }

  let gitActivity: DigestSessionInput["gitActivity"] = null;
  if (s.git_activity) {
    try {
      const ga = JSON.parse(s.git_activity);
      gitActivity = {
        totalCommits: ga.totalCommits ?? 0,
        totalInsertions: ga.totalInsertions ?? 0,
        totalDeletions: ga.totalDeletions ?? 0,
      };
    } catch {
      // ignore
    }
  }

  let intelligence: DigestSessionInput["intelligence"] = null;
  if (s.intelligence) {
    try {
      const intel = JSON.parse(s.intelligence);
      if (intel.qualityScore?.overall != null) {
        intelligence = { qualityScore: { overall: intel.qualityScore.overall } };
      }
    } catch {
      // ignore
    }
  }

  return {
    ticketId: s.ticket_id,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    status: s.status,
    totalTokens: s.total_tokens,
    promptTokens: s.prompt_tokens,
    responseTokens: s.response_tokens,
    messageCount: s.message_count,
    models,
    category: s.category,
    gitActivity,
    intelligence,
  };
}

function changeIndicator(val: number | null): string {
  if (val == null) return "";
  if (val > 0) return `\u25B2 ${val}% vs last period`;
  if (val < 0) return `\u25BC ${Math.abs(val)}% vs last period`;
  return "\u2500 same";
}

function printDigest(digest: WeeklyDigest): void {
  const { comparison, topProjects, topCategories, highlights } = digest;
  const { current, changes } = comparison;

  console.log(`\n  Promptly Weekly Digest \u2014 ${digest.periodLabel}\n`);
  console.log("  \u2500\u2500 This Period \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(
    `  Sessions:       ${current.totalSessions.toString().padEnd(12)} ${changeIndicator(changes.sessions)}`
  );
  console.log(
    `  Tokens:         ${current.totalTokens.toLocaleString().padEnd(12)} ${changeIndicator(changes.tokens)}`
  );
  console.log(
    `  Messages:       ${current.totalMessages.toLocaleString().padEnd(12)} ${changeIndicator(changes.messages)}`
  );
  console.log(
    `  Avg duration:   ${(current.avgDuration + "m").padEnd(12)} `
  );
  if (current.avgQuality != null) {
    console.log(
      `  Avg quality:    ${(current.avgQuality + "/5").padEnd(12)} ${changes.quality != null ? (changes.quality > 0 ? "\u25B2 improved" : changes.quality < 0 ? "\u25BC declined" : "\u2500 same") : ""}`
    );
  }
  if (current.totalCommits > 0) {
    console.log(
      `  Git:            ${current.totalCommits} commit${current.totalCommits !== 1 ? "s" : ""} (+${current.totalInsertions}/-${current.totalDeletions} lines)`
    );
  }

  if (topProjects.length > 0) {
    console.log(
      "\n  \u2500\u2500 Top Projects \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
    );
    for (const p of topProjects) {
      console.log(
        `  ${p.project.padEnd(16)} ${p.sessions} session${p.sessions !== 1 ? "s" : ""}, ${p.tokens.toLocaleString()} tokens`
      );
    }
  }

  if (topCategories.length > 0) {
    console.log(
      "\n  \u2500\u2500 By Category \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
    );
    const cats = topCategories
      .map((c) => `${c.category} (${c.sessions})`)
      .join(", ");
    console.log(`  ${cats}`);
  }

  if (highlights.length > 0) {
    console.log(
      "\n  \u2500\u2500 Highlights \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500"
    );
    for (const h of highlights) {
      console.log(`  \u2022 ${h}`);
    }
  }

  console.log();
}

export async function digestCommand(options: {
  from?: string;
  to?: string;
}) {
  const sessions = listAllSessions();

  if (sessions.length === 0) {
    console.log("No sessions found. Start a session with: promptly start <ticket-id>");
    return;
  }

  const inputs = sessions.map(convertDbSession);

  let digest: WeeklyDigest;
  if (options.from || options.to) {
    const from = options.from ? new Date(options.from) : new Date(0);
    const to = options.to ? new Date(options.to) : new Date();
    // Ensure 'to' is end of day
    to.setHours(23, 59, 59, 999);
    digest = computeWeeklyDigest(inputs, undefined, { from, to });
  } else {
    digest = computeWeeklyDigest(inputs);
  }

  printDigest(digest);
}
